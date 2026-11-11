"""Retention for DLP auxiliary tables (focus dedup + activity buckets).

Targets, in order:
  1. ``focus_events``      — app.browser_probe_focus_events older than
     DLP_FOCUS_EVENT_RETENTION_DAYS (default 30). The table is ingest dedup
     only: it has no TTL and grew to ~92k rows/day.
  2. ``activity_buckets``  — app.dlp_activity_buckets older than
     DLP_ACTIVITY_RETENTION_DAYS (default 180).

Deletes are batched (default 5000) and runtime-bounded; dry-run is the default
and performs counts only. Runs inside the dlp-media-retention worker loop
(same PM2 process); ``pg_advisory_lock`` under its own scope keeps a single
owner on PostgreSQL. Feature flag DLP_AUX_CLEANUP_ENABLED defaults to false.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select, text, tuple_

from backend.appdb.db import (
    app_session,
    get_app_database_url,
    get_app_engine,
    is_app_database_configured,
)
from backend.appdb.models import AppBrowserProbeFocusEvent, AppDlpActivityBucket

logger = logging.getLogger("backend.dlp.aux.cleanup")

_ADVISORY_SCOPE = "dlp-aux:cleanup"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_UNAVAILABLE = "lock_unavailable"
_STOP_ERROR = "error"
_STOP_DISABLED = "disabled"
_STOP_DRY_RUN = "dry_run"


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
class AuxCleanupConfig:
    enabled: bool = False
    dry_run: bool = True
    focus_retention_days: int = 30
    activity_retention_days: int = 180
    batch_size: int = 5000
    max_batches: int = 100
    max_runtime_seconds: int = 600
    interval_seconds: int = 86_400
    batch_pause_ms: int = 200

    @classmethod
    def from_env(cls) -> "AuxCleanupConfig":
        return cls(
            enabled=_env_flag("DLP_AUX_CLEANUP_ENABLED", "false"),
            dry_run=_env_flag("DLP_AUX_CLEANUP_DRY_RUN", "true"),
            focus_retention_days=_env_int(
                "DLP_FOCUS_EVENT_RETENTION_DAYS", 30, minimum=1, maximum=3650
            ),
            activity_retention_days=_env_int(
                "DLP_ACTIVITY_RETENTION_DAYS", 180, minimum=1, maximum=3650
            ),
            batch_size=_env_int("DLP_AUX_CLEANUP_BATCH_SIZE", 5000, minimum=1, maximum=50_000),
            max_batches=_env_int("DLP_AUX_CLEANUP_MAX_BATCHES", 100, minimum=1, maximum=100_000),
            max_runtime_seconds=_env_int(
                "DLP_AUX_CLEANUP_MAX_RUNTIME_SECONDS", 600, minimum=1, maximum=14_400
            ),
            interval_seconds=_env_int(
                "DLP_AUX_CLEANUP_INTERVAL_SECONDS", 86_400, minimum=60, maximum=604_800
            ),
            batch_pause_ms=_env_int(
                "DLP_AUX_CLEANUP_BATCH_PAUSE_MS", 200, minimum=0, maximum=60_000
            ),
        )


@dataclass
class AuxCleanupMetrics:
    runs: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    batches: int = 0
    rows_deleted: int = 0
    errors: int = 0
    batch_latencies_ms: list[float] = field(default_factory=list)
    last_stop_reason: str = ""

    def snapshot(self) -> dict[str, Any]:
        lat = sorted(self.batch_latencies_ms)
        p95 = lat[min(len(lat) - 1, int(round((len(lat) - 1) * 0.95)))] if lat else None
        return {
            "runs": self.runs,
            "lock_acquired": self.lock_acquired,
            "lock_skipped": self.lock_skipped,
            "batches": self.batches,
            "rows_deleted": self.rows_deleted,
            "errors": self.errors,
            "batch_p95_ms": round(p95, 2) if p95 is not None else None,
            "stop_reason": self.last_stop_reason,
        }


class DlpAuxCleanupService:
    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = database_url
        self.metrics = AuxCleanupMetrics()

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> AuxCleanupConfig:
        return AuxCleanupConfig.from_env()

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

    @staticmethod
    def _targets(cfg: AuxCleanupConfig, now: datetime) -> list[tuple[str, Any, Any, int]]:
        """(name, model, ts_column, retention_days) — whitelisted, never from input."""
        return [
            (
                "focus_events",
                AppBrowserProbeFocusEvent,
                AppBrowserProbeFocusEvent.received_at,
                cfg.focus_retention_days,
            ),
            (
                "activity_buckets",
                AppDlpActivityBucket,
                AppDlpActivityBucket.bucket_start,
                cfg.activity_retention_days,
            ),
        ]

    def dry_run_report(self, *, config: AuxCleanupConfig | None = None) -> dict[str, Any]:
        cfg = config or self.get_config()
        now = _utc_now()
        started = time.perf_counter()
        self._ensure_schema()
        by_table: list[dict[str, Any]] = []
        total = 0
        for name, model, col, days in self._targets(cfg, now):
            cutoff = now - timedelta(days=days)
            with app_session(**self._session_kwargs()) as session:
                count = int(
                    session.execute(select(func.count()).select_from(model).where(col < cutoff)).scalar()
                    or 0
                )
            total += count
            by_table.append(
                {
                    "table": model.__tablename__,
                    "target": name,
                    "retention_days": days,
                    "cutoff_iso": cutoff.strftime("%Y-%m-%dT%H:%M:%S"),
                    "eligible_exact": count,
                }
            )
        return {
            "mode": "dry_run",
            "enabled": cfg.enabled,
            "dry_run": True,
            "by_table": by_table,
            "eligible_rows_exact": total,
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }

    def _delete_one_batch(self, *, cfg: AuxCleanupConfig, model: Any, col: Any, cutoff: datetime) -> int:
        with app_session(**self._session_kwargs()) as session:
            # Keyset-limited select then delete by full PK: bounded, index-friendly,
            # safe to re-run (a crash between batches just re-picks leftovers).
            # The PK may be composite (activity_buckets) — never delete on a
            # single PK column or sibling rows of the same host die too.
            pk_cols = list(model.__mapper__.primary_key)
            rows = session.execute(
                select(*pk_cols).where(col < cutoff).order_by(col, *pk_cols).limit(cfg.batch_size)
            ).all()
            if not rows:
                return 0
            # Chunk under the sqlite bound-variable ceiling (~999 on old builds).
            per_delete = max(1, 900 // len(pk_cols))
            if len(pk_cols) == 1:
                col0 = pk_cols[0]
                for i in range(0, len(rows), per_delete):
                    session.execute(
                        delete(model).where(col0.in_([r[0] for r in rows[i : i + per_delete]]))
                    )
            else:
                key = tuple_(*pk_cols)
                for i in range(0, len(rows), per_delete):
                    session.execute(delete(model).where(key.in_([tuple(r) for r in rows[i : i + per_delete]])))
            session.commit()
            return len(rows)

    def run_once(
        self,
        *,
        config: AuxCleanupConfig | None = None,
        dry_run: bool | None = None,
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
            result.update(self.dry_run_report(config=cfg))
            result["stop_reason"] = _STOP_DRY_RUN
            self.metrics.last_stop_reason = _STOP_DRY_RUN
            result["metrics"] = self.metrics.snapshot()
            return result

        lock_conn = None
        try:
            if acquire_lock and self._use_postgres():
                engine = get_app_engine(self._database_url or get_app_database_url())
                lock_conn = engine.connect()
                acquired = lock_conn.execute(
                    text("SELECT pg_try_advisory_lock(:lock_key)"),
                    {"lock_key": self.advisory_lock_key()},
                ).scalar()
                lock_conn.commit()
                if not acquired:
                    lock_conn.close()
                    lock_conn = None
                    self.metrics.lock_skipped += 1
                    result["stop_reason"] = _STOP_LOCK_UNAVAILABLE
                    self.metrics.last_stop_reason = _STOP_LOCK_UNAVAILABLE
                    result["metrics"] = self.metrics.snapshot()
                    return result
                self.metrics.lock_acquired += 1

            now = _utc_now()
            targets = self._targets(cfg, now)
            table_cursor = 0
            deadline = started + float(cfg.max_runtime_seconds)
            stop_reason = _STOP_NO_ROWS
            self._ensure_schema()
            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = "shutdown"
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break
                deleted = 0
                batch_started = time.perf_counter()
                try:
                    for offset in range(len(targets)):
                        name, model, col, days = targets[(table_cursor + offset) % len(targets)]
                        deleted = self._delete_one_batch(
                            cfg=cfg,
                            model=model,
                            col=col,
                            cutoff=now - timedelta(days=days),
                        )
                        if deleted:
                            table_cursor = (table_cursor + offset + 1) % len(targets)
                            break
                except Exception as exc:  # noqa: BLE001
                    self.metrics.errors += 1
                    result["errors"].append(str(exc) or exc.__class__.__name__)
                    stop_reason = _STOP_ERROR
                    logger.exception("dlp.aux.cleanup.batch_failed")
                    break
                if not deleted:
                    stop_reason = _STOP_NO_ROWS
                    break
                latency = (time.perf_counter() - batch_started) * 1000.0
                result["batches"] += 1
                result["rows_deleted"] += deleted
                result["batch_latencies_ms"].append(round(latency, 2))
                self.metrics.batches += 1
                self.metrics.rows_deleted += deleted
                self.metrics.batch_latencies_ms.append(latency)
                logger.info("dlp.aux.cleanup.batch deleted=%s batch_ms=%.1f", deleted, latency)
                if cfg.batch_pause_ms:
                    time.sleep(cfg.batch_pause_ms / 1000.0)
            else:
                stop_reason = _STOP_MAX_BATCHES
            result["stop_reason"] = stop_reason
            self.metrics.last_stop_reason = stop_reason
        finally:
            if lock_conn is not None:
                try:
                    lock_conn.execute(
                        text("SELECT pg_advisory_unlock(:lock_key)"),
                        {"lock_key": self.advisory_lock_key()},
                    )
                    lock_conn.commit()
                    lock_conn.close()
                except Exception:
                    logger.warning("dlp.aux.cleanup.lock_release_failed", exc_info=True)
        result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
        result["metrics"] = self.metrics.snapshot()
        return result


dlp_aux_cleanup_service = DlpAuxCleanupService()
