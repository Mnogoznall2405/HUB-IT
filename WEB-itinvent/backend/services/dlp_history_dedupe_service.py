"""History dedupe + deleted-noise cleanup for DLP tables (batched worker).

Targets, in order:
  1. ``visit_dupes``    — browser visits duplicated by
     (computer_name, url, date_trunc('minute', visited_at)); keeps earliest created_at.
  2. ``noise_deleted``  — ``channel='deleted'`` rows whose file_name matches the
     shared service-file regex (``dlp_categories.SERVICE_FILE_NAME_SQL_RE``).

Deletes are batched (default 500) and runtime-bounded; dry-run is the default and
performs counts only. Runs inside the itinvent-dlp-media-retention-worker loop
(same PM2 process); ``pg_advisory_lock`` keeps a single owner on PostgreSQL.
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import os
import signal
import statistics
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, func, select, text

from backend.appdb.db import app_session, get_app_database_url, get_app_engine, is_app_database_configured
from backend.appdb.models import AppBrowserProbeVisit, AppFileLeftEvent
from backend.services.dlp_categories import SERVICE_FILE_NAME_SQL_RE

logger = logging.getLogger("backend.dlp.history.dedupe")

_ADVISORY_SCOPE = "dlp-history:dedupe"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_UNAVAILABLE = "lock_unavailable"
_STOP_ERROR = "error"
_STOP_DISABLED = "disabled"
_STOP_DRY_RUN = "dry_run"

_TARGETS = ("visit_dupes", "noise_deleted")


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or "").strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class DedupeConfig:
    enabled: bool = False
    dry_run: bool = True
    batch_size: int = 500
    max_batches: int = 200
    max_runtime_seconds: int = 600
    interval_seconds: int = 86_400
    batch_pause_ms: int = 500

    @classmethod
    def from_env(cls) -> "DedupeConfig":
        return cls(
            enabled=_env_flag("DLP_DEDUPE_ENABLED", "false"),
            dry_run=_env_flag("DLP_DEDUPE_DRY_RUN", "true"),
            batch_size=_env_int("DLP_DEDUPE_BATCH_SIZE", 500, minimum=1, maximum=20_000),
            max_batches=_env_int("DLP_DEDUPE_MAX_BATCHES", 200, minimum=1, maximum=100_000),
            max_runtime_seconds=_env_int(
                "DLP_DEDUPE_MAX_RUNTIME_SECONDS", 600, minimum=1, maximum=14_400
            ),
            interval_seconds=_env_int(
                "DLP_DEDUPE_INTERVAL_SECONDS", 86_400, minimum=60, maximum=604_800
            ),
            batch_pause_ms=_env_int(
                "DLP_DEDUPE_BATCH_PAUSE_MS", 500, minimum=0, maximum=60_000
            ),
        )


@dataclass
class DedupeMetrics:
    runs: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    batches: int = 0
    rows_deleted: int = 0
    errors: int = 0
    batch_latencies_ms: list[float] = field(default_factory=list)
    last_stop_reason: str = ""
    last_elapsed_ms: float = 0.0
    last_db_ms: float = 0.0

    def snapshot(self) -> dict[str, Any]:
        lat = list(self.batch_latencies_ms)
        ordered = sorted(lat)
        p95 = ordered[min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))] if ordered else None
        return {
            "runs": self.runs,
            "lock_acquired": self.lock_acquired,
            "lock_skipped": self.lock_skipped,
            "batches": self.batches,
            "rows_deleted": self.rows_deleted,
            "errors": self.errors,
            "elapsed_total_ms": self.last_elapsed_ms,
            "db_time_ms": self.last_db_ms,
            "batch_p50_ms": round(statistics.median(lat), 2) if lat else None,
            "batch_p95_ms": round(p95, 2) if p95 is not None else None,
            "batch_max_ms": round(max(lat), 2) if lat else None,
            "stop_reason": self.last_stop_reason,
        }


def _visit_minute_bucket(dialect_name: str) -> Any:
    if str(dialect_name).lower() == "postgresql":
        return func.date_trunc("minute", AppBrowserProbeVisit.visited_at)
    return func.strftime("%Y-%m-%d %H:%M", AppBrowserProbeVisit.visited_at)


def _noise_condition(dialect_name: str) -> Any:
    op = "~" if str(dialect_name).lower() == "postgresql" else "REGEXP"
    return func.lower(AppFileLeftEvent.file_name).op(op)(SERVICE_FILE_NAME_SQL_RE)


class DlpHistoryDedupeService:
    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = database_url
        self.metrics = DedupeMetrics()

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> DedupeConfig:
        return DedupeConfig.from_env()

    def _use_postgres(self) -> bool:
        if not is_app_database_configured():
            return False
        try:
            url = self._database_url or get_app_database_url()
            return str(get_app_engine(url).dialect.name).lower() == "postgresql"
        except Exception:
            return False

    def _session_kwargs(self) -> dict[str, Any]:
        return {"database_url": self._database_url} if self._database_url else {}

    def _ensure_schema(self) -> None:
        from backend.appdb.db import ensure_app_schema_initialized

        ensure_app_schema_initialized(self._database_url)

    # --- candidate selection -------------------------------------------------

    @staticmethod
    def _dup_ids_stmt(
        model: Any, partition_cols: tuple, *, where: Any = None, limit: int
    ) -> Any:
        rn = func.row_number().over(
            partition_by=partition_cols,
            order_by=(model.created_at, model.id),
        ).label("rn")
        inner = select(model.id.label("id"), rn)
        if where is not None:
            inner = inner.where(where)
        sub = inner.subquery()
        return select(sub.c.id).where(sub.c.rn > 1).limit(limit)

    def _delete_ids(self, target: str, dialect_name: str, limit: int) -> Any:
        """SELECT of ids to remove for one batch of one target."""
        if target == "visit_dupes":
            bucket = _visit_minute_bucket(dialect_name)
            return self._dup_ids_stmt(
                AppBrowserProbeVisit,
                (AppBrowserProbeVisit.computer_name, AppBrowserProbeVisit.url, bucket),
                limit=limit,
            )
        if target == "noise_deleted":
            return (
                select(AppFileLeftEvent.id)
                .where(
                    AppFileLeftEvent.channel == "deleted",
                    _noise_condition(dialect_name),
                )
                .limit(limit)
            )
        raise ValueError(f"unknown dedupe target: {target}")

    @staticmethod
    def _model_for(target: str) -> Any:
        return AppBrowserProbeVisit if target == "visit_dupes" else AppFileLeftEvent

    def _delete_batch(self, target: str, batch_size: int) -> tuple[int, float]:
        """One bounded batch for one target. Returns (rows_deleted, db_ms)."""
        t0 = time.perf_counter()
        with app_session(**self._session_kwargs()) as session:
            dialect = session.connection().dialect.name
            ids_stmt = self._delete_ids(target, dialect, batch_size)
            ids = list(session.execute(ids_stmt).scalars())
            if not ids:
                return 0, (time.perf_counter() - t0) * 1000.0
            model = self._model_for(target)
            session.execute(delete(model).where(model.id.in_(ids)))
            session.commit()
        return len(ids), (time.perf_counter() - t0) * 1000.0

    # --- dry run --------------------------------------------------------------

    def _count_eligible(self, target: str) -> int:
        with app_session(**self._session_kwargs()) as session:
            dialect = session.connection().dialect.name
            if target == "visit_dupes":
                bucket = _visit_minute_bucket(dialect)
                grouped = (
                    select(func.count().label("cnt"))
                    .select_from(AppBrowserProbeVisit)
                    .group_by(
                        AppBrowserProbeVisit.computer_name,
                        AppBrowserProbeVisit.url,
                        bucket,
                    )
                    .having(func.count() > 1)
                    .subquery()
                )
                value = session.execute(
                    select(func.coalesce(func.sum(grouped.c.cnt - 1), 0))
                ).scalar()
                return int(value or 0)
            if target == "noise_deleted":
                value = session.execute(
                    select(func.count())
                    .select_from(AppFileLeftEvent)
                    .where(
                        AppFileLeftEvent.channel == "deleted",
                        _noise_condition(dialect),
                    )
                ).scalar()
                return int(value or 0)
        raise ValueError(f"unknown dedupe target: {target}")

    def dry_run_report(self, *, config: Optional[DedupeConfig] = None) -> dict[str, Any]:
        """Exact duplicate/noise counts per target; performs no deletes."""
        cfg = config or self.get_config()
        started = time.perf_counter()
        self._ensure_schema()
        by_target: list[dict[str, Any]] = []
        total = 0
        db_ms = 0.0
        for target in _TARGETS:
            t0 = time.perf_counter()
            count = self._count_eligible(target)
            db_ms += (time.perf_counter() - t0) * 1000.0
            total += count
            by_target.append({"target": target, "eligible_exact": count})
        report = {
            "mode": "dry_run",
            "enabled": cfg.enabled,
            "dry_run": True,
            "batch_size": cfg.batch_size,
            "max_batches": cfg.max_batches,
            "max_runtime_seconds": cfg.max_runtime_seconds,
            "by_target": by_target,
            "eligible_rows_exact": total,
            "db_ms": round(db_ms, 2),
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }
        logger.info(
            "dlp.history.dedupe.dry_run eligible_exact=%s by_target=%s db_ms=%.1f",
            total,
            {row["target"]: row["eligible_exact"] for row in by_target},
            db_ms,
        )
        return report

    # --- execute ---------------------------------------------------------------

    def run_once(
        self,
        *,
        config: Optional[DedupeConfig] = None,
        dry_run: Optional[bool] = None,
        acquire_lock: bool = True,
        force_enabled: bool = False,
        should_stop: Any | None = None,
    ) -> dict[str, Any]:
        cfg = config or self.get_config()
        is_dry = cfg.dry_run if dry_run is None else bool(dry_run)
        started = time.perf_counter()
        self.metrics.runs += 1
        result: dict[str, Any] = {
            "enabled": cfg.enabled,
            "dry_run": is_dry,
            "stop_reason": "",
            "batches": 0,
            "rows_deleted": 0,
            "deleted_by_target": {name: 0 for name in _TARGETS},
            "errors": [],
            "batch_latencies_ms": [],
            "metrics": {},
        }

        if not force_enabled and not cfg.enabled and not is_dry:
            result["stop_reason"] = _STOP_DISABLED
            self.metrics.last_stop_reason = _STOP_DISABLED
            result["metrics"] = self.metrics.snapshot()
            return result

        if is_dry:
            report = self.dry_run_report(config=cfg)
            result.update(report)
            result["stop_reason"] = _STOP_DRY_RUN
            self.metrics.last_stop_reason = _STOP_DRY_RUN
            self.metrics.last_elapsed_ms = float(result.get("elapsed_ms") or 0.0)
            self.metrics.last_db_ms = float(result.get("db_ms") or 0.0)
            result["metrics"] = self.metrics.snapshot()
            return result

        lock_conn = None
        lock_wait_ms = 0.0
        try:
            if acquire_lock and self._use_postgres():
                engine = get_app_engine(self._database_url or get_app_database_url())
                t_lock = time.perf_counter()
                lock_conn = engine.connect()
                acquired = lock_conn.execute(
                    text("SELECT pg_try_advisory_lock(:lock_key)"),
                    {"lock_key": self.advisory_lock_key()},
                ).scalar()
                lock_conn.commit()
                lock_wait_ms = (time.perf_counter() - t_lock) * 1000.0
                if not acquired:
                    lock_conn.close()
                    lock_conn = None
                    self.metrics.lock_skipped += 1
                    result["stop_reason"] = _STOP_LOCK_UNAVAILABLE
                    result["advisory_lock_wait_ms"] = round(lock_wait_ms, 2)
                    self.metrics.last_stop_reason = _STOP_LOCK_UNAVAILABLE
                    result["metrics"] = self.metrics.snapshot()
                    return result
                self.metrics.lock_acquired += 1
            result["advisory_lock_wait_ms"] = round(lock_wait_ms, 2)

            stop_reason = _STOP_NO_ROWS
            db_ms = 0.0
            deadline = started + float(cfg.max_runtime_seconds)
            self._ensure_schema()

            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = "shutdown"
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break

                batch_deleted = 0
                batch_started = time.perf_counter()
                try:
                    # Round-robin across targets inside one batch window so a huge
                    # visit_dupes backlog cannot starve the file targets.
                    for target in _TARGETS:
                        deleted, target_ms = self._delete_batch(target, cfg.batch_size)
                        db_ms += target_ms
                        batch_deleted += deleted
                        result["deleted_by_target"][target] += deleted
                except Exception as exc:  # noqa: BLE001
                    self.metrics.errors += 1
                    result["errors"].append(str(exc) or exc.__class__.__name__)
                    stop_reason = _STOP_ERROR
                    logger.exception("dlp.history.dedupe.batch_failed")
                    break

                if not batch_deleted:
                    stop_reason = _STOP_NO_ROWS
                    break

                latency = (time.perf_counter() - batch_started) * 1000.0
                result["batches"] += 1
                result["rows_deleted"] += batch_deleted
                result["batch_latencies_ms"].append(round(latency, 2))
                self.metrics.batches += 1
                self.metrics.rows_deleted += batch_deleted
                self.metrics.batch_latencies_ms.append(latency)
                logger.info(
                    "dlp.history.dedupe.batch deleted=%s by_target=%s batch_total_ms=%.1f batch=%s",
                    batch_deleted,
                    dict(result["deleted_by_target"]),
                    latency,
                    result["batches"],
                )
                stop_reason = _STOP_MAX_BATCHES
                if cfg.batch_pause_ms > 0:
                    pause_deadline = time.perf_counter() + (cfg.batch_pause_ms / 1000.0)
                    while time.perf_counter() < pause_deadline:
                        if callable(should_stop) and should_stop():
                            stop_reason = "shutdown"
                            break
                        time.sleep(min(0.1, max(0.0, pause_deadline - time.perf_counter())))
                    if stop_reason == "shutdown":
                        break

            result["stop_reason"] = stop_reason
            result["db_ms"] = round(db_ms, 2)
            result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
            self.metrics.last_stop_reason = stop_reason
            self.metrics.last_elapsed_ms = result["elapsed_ms"]
            self.metrics.last_db_ms = result["db_ms"]
            result["metrics"] = self.metrics.snapshot()
            return result
        finally:
            if lock_conn is not None:
                try:
                    lock_conn.execute(
                        text("SELECT pg_advisory_unlock(:lock_key)"),
                        {"lock_key": self.advisory_lock_key()},
                    )
                    lock_conn.commit()
                except Exception:
                    logger.warning(
                        "Failed to release dlp history dedupe advisory lock",
                        exc_info=True,
                    )
                lock_conn.close()


dlp_history_dedupe_service = DlpHistoryDedupeService()


def run_once(**kwargs: Any) -> dict[str, Any]:
    return dlp_history_dedupe_service.run_once(**kwargs)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DLP history dedupe cycle")
    parser.add_argument("--once", action="store_true", help="Run a single cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run (no deletes)")
    parser.add_argument("--execute", action="store_true", help="Force execute deletes")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow execute even when DLP_DEDUPE_ENABLED=false (ops only)",
    )
    return parser.parse_args()


def run_forever(*, args: Optional[argparse.Namespace] = None, stop_event: Any = None) -> int:
    """Loop mirroring the media retention worker; runs inside the same PM2 process."""
    args = args or _parse_args()
    stop = stop_event or threading.Event()
    cfg = DedupeConfig.from_env()
    while not stop.is_set():
        cfg = DedupeConfig.from_env()
        if args.execute:
            dry = False
        elif args.dry_run:
            dry = True
        else:
            dry = cfg.dry_run
        if not args.once and not cfg.enabled and not args.dry_run and not args.execute:
            logger.info("dlp.history.dedupe.idle enabled=false interval_s=%s", cfg.interval_seconds)
            stop.wait(cfg.interval_seconds)
            continue
        result = dlp_history_dedupe_service.run_once(
            config=cfg,
            dry_run=dry,
            force_enabled=bool(args.force or args.execute),
            should_stop=stop.is_set,
        )
        logger.info(
            "dlp.history.dedupe.cycle stop_reason=%s deleted=%s batches=%s elapsed_ms=%s",
            result.get("stop_reason"),
            result.get("rows_deleted") or result.get("eligible_rows_exact"),
            result.get("batches"),
            result.get("elapsed_ms"),
        )
        if args.once:
            import json as _json

            print(_json.dumps(result, ensure_ascii=False, indent=2, default=str))
            return 0
        stop.wait(cfg.interval_seconds)
    return 0


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    if not is_app_database_configured():
        logger.warning("APP_DATABASE_URL not configured; dedupe needs the app database")
        return 1
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except Exception:
        pass
    return run_forever(args=args, stop_event=stop_event)


if __name__ == "__main__":
    raise SystemExit(main())
