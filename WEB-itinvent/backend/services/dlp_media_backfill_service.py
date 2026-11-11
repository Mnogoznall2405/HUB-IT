"""Backfill existing DLP probe media bytea payloads to filesystem storage.

One-shot operator tool: rows with ``content IS NOT NULL AND storage_path IS NULL``
are written as content-addressed files (same layout as the ingest path), then the
row is switched to ``storage_path`` + ``content=NULL`` per bounded batch.
Dry-run by default; requires ``DLP_MEDIA_STORAGE_DIR``.
"""
from __future__ import annotations

import hashlib
import logging
import os
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select, text

from backend.appdb.db import app_session, get_app_database_url, get_app_engine, is_app_database_configured
from backend.appdb.file_egress_store import _media_storage_write, media_storage_root
from backend.appdb.models import (
    AppBrowserProbeMedia,
    AppMaxProbeMedia,
    AppTelegramProbeMedia,
)

logger = logging.getLogger("backend.dlp.media.backfill")

_ADVISORY_SCOPE = "dlp-media:backfill"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_ROWS = "max_rows"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_UNAVAILABLE = "lock_unavailable"
_STOP_ERROR = "error"
_STOP_DRY_RUN = "dry_run"
_STOP_NO_STORAGE = "storage_dir_not_configured"

_MEDIA_MODELS = {
    "browser_probe_media": AppBrowserProbeMedia,
    "telegram_probe_media": AppTelegramProbeMedia,
    "max_probe_media": AppMaxProbeMedia,
}


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or "").strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    idx = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * q))))
    return ordered[idx]


@dataclass
class BackfillConfig:
    dry_run: bool = True
    batch_size: int = 50
    max_rows: int = 0  # 0 = unlimited
    max_batches: int = 100_000
    max_runtime_seconds: int = 0  # 0 = unlimited
    batch_pause_ms: int = 100

    @classmethod
    def from_env(cls) -> "BackfillConfig":
        return cls(
            dry_run=_env_flag("DLP_MEDIA_BACKFILL_DRY_RUN", "true"),
            batch_size=_env_int("DLP_MEDIA_BACKFILL_BATCH_SIZE", 50, minimum=1, maximum=500),
            max_rows=_env_int("DLP_MEDIA_BACKFILL_MAX_ROWS", 0, minimum=0, maximum=10_000_000),
            max_batches=_env_int("DLP_MEDIA_BACKFILL_MAX_BATCHES", 100_000, minimum=1, maximum=1_000_000),
            max_runtime_seconds=_env_int(
                "DLP_MEDIA_BACKFILL_MAX_RUNTIME_SECONDS", 0, minimum=0, maximum=86_400
            ),
            batch_pause_ms=_env_int(
                "DLP_MEDIA_BACKFILL_BATCH_PAUSE_MS", 100, minimum=0, maximum=60_000
            ),
        )


@dataclass
class BackfillMetrics:
    runs: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    batches: int = 0
    rows_selected: int = 0
    rows_migrated: int = 0
    rows_failed: int = 0
    bytes_migrated: int = 0
    errors: int = 0
    batch_latencies_ms: list[float] = field(default_factory=list)
    last_stop_reason: str = ""

    def snapshot(self) -> dict[str, Any]:
        lat = list(self.batch_latencies_ms)
        return {
            "runs": self.runs,
            "lock_acquired": self.lock_acquired,
            "lock_skipped": self.lock_skipped,
            "batches": self.batches,
            "rows_selected": self.rows_selected,
            "rows_migrated": self.rows_migrated,
            "rows_failed": self.rows_failed,
            "bytes_migrated": self.bytes_migrated,
            "errors": self.errors,
            "batch_p50_ms": round(statistics.median(lat), 2) if lat else None,
            "batch_p95_ms": round(_percentile(lat, 0.95), 2) if lat else None,
            "stop_reason": self.last_stop_reason,
        }


class DlpMediaBackfillService:
    def __init__(self, *, database_url: str | None = None, storage_root: Any | None = None) -> None:
        self._database_url = database_url
        # storage_root: explicit Path (tests); None -> env DLP_MEDIA_STORAGE_DIR
        self._storage_root = storage_root
        self.metrics = BackfillMetrics()

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> BackfillConfig:
        return BackfillConfig.from_env()

    def _root(self) -> Any:
        return self._storage_root if self._storage_root is not None else media_storage_root()

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
    def _eligible_stmt(model: Any):
        return select(model).where(model.storage_path.is_(None), model.content.is_not(None))

    def dry_run_report(self, *, config: BackfillConfig | None = None) -> dict[str, Any]:
        """Exact rows+bytes still stored as bytea (storage_path IS NULL)."""
        cfg = config or self.get_config()
        started = time.perf_counter()
        self._ensure_schema()
        by_table: list[dict[str, Any]] = []
        total_rows = 0
        total_bytes = 0
        db_ms = 0.0
        for table_name, model in _MEDIA_MODELS.items():
            t0 = time.perf_counter()
            with app_session(**self._session_kwargs()) as session:
                row = session.execute(
                    select(
                        func.count(model.id),
                        func.coalesce(func.sum(func.length(model.content)), 0),
                        func.min(model.created_at),
                    ).where(model.storage_path.is_(None), model.content.is_not(None))
                ).one()
            db_ms += (time.perf_counter() - t0) * 1000.0
            count = int(row[0] or 0)
            payload = int(row[1] or 0)
            total_rows += count
            total_bytes += payload
            by_table.append(
                {
                    "table": table_name,
                    "pending_rows": count,
                    "pending_bytes": payload,
                    "oldest_pending_created_at": _iso(row[2]) if row[2] is not None else None,
                }
            )
        report = {
            "mode": "dry_run",
            "storage_root": str(self._root() or ""),
            "batch_size": cfg.batch_size,
            "max_rows": cfg.max_rows,
            "by_table": by_table,
            "pending_rows_exact": total_rows,
            "pending_bytes": total_bytes,
            "expected_batches": (total_rows + cfg.batch_size - 1) // cfg.batch_size if total_rows else 0,
            "db_ms": round(db_ms, 2),
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }
        logger.info(
            "dlp.media.backfill.dry_run pending_rows=%s pending_bytes=%s expected_batches=%s",
            total_rows,
            total_bytes,
            report["expected_batches"],
        )
        return report

    def _migrate_one_batch(
        self,
        *,
        cfg: BackfillConfig,
        table_name: str,
        root: Any,
        row_limit: int,
        use_skip_locked: bool,
    ) -> tuple[int, int, int, dict[str, Any]]:
        """Migrate up to min(batch_size, row_limit) rows in one table.

        Returns (migrated, failed, bytes, stages). File writes happen inside the
        same transaction scope as the row update; a failed write leaves the row
        as bytea (skipped, not counted as migrated).
        """
        model = _MEDIA_MODELS[table_name]
        limit = max(1, min(cfg.batch_size, row_limit))
        stages: dict[str, Any] = {"table": table_name, "rows_migrated": 0, "rows_failed": 0,
                                "bytes_migrated": 0, "batch_total_ms": 0.0}
        batch_started = time.perf_counter()
        with app_session(**self._session_kwargs()) as session:
            stmt = (
                self._eligible_stmt(model)
                .order_by(model.id)
                .limit(limit)
            )
            if use_skip_locked:
                stmt = stmt.with_for_update(skip_locked=True)
            rows = session.execute(stmt).scalars().all()
            if not rows:
                stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
                return 0, 0, 0, stages
            migrated = failed = 0
            migrated_bytes = 0
            for row in rows:
                content = bytes(row.content) if row.content is not None else b""
                if not content:
                    # Empty bytea: mark migrated with NULL content so it stops being selected.
                    row.content = None
                    migrated += 1
                    continue
                try:
                    rel = _media_storage_write(
                        root, table_name, str(row.file_name or ""), content,
                        str(row.content_type or ""),
                    )
                except OSError:
                    rel = None
                if rel:
                    row.storage_path = rel
                    row.content = None
                    migrated += 1
                    migrated_bytes += len(content)
                else:
                    failed += 1
            session.commit()
        stages["rows_migrated"] = migrated
        stages["rows_failed"] = failed
        stages["bytes_migrated"] = migrated_bytes
        stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
        return migrated, failed, migrated_bytes, stages

    def run_once(
        self,
        *,
        config: BackfillConfig | None = None,
        dry_run: bool | None = None,
        acquire_lock: bool = True,
        should_stop: Any | None = None,
    ) -> dict[str, Any]:
        cfg = config or self.get_config()
        is_dry = cfg.dry_run if dry_run is None else bool(dry_run)
        started = time.perf_counter()
        self.metrics.runs += 1
        root = self._root()
        result: dict[str, Any] = {
            "dry_run": is_dry,
            "storage_root": str(root or ""),
            "stop_reason": "",
            "batches": 0,
            "rows_migrated": 0,
            "rows_failed": 0,
            "bytes_migrated": 0,
            "errors": [],
            "batch_latencies_ms": [],
            "metrics": {},
        }

        if is_dry:
            report = self.dry_run_report(config=cfg)
            result.update(report)
            result["stop_reason"] = _STOP_DRY_RUN
            self.metrics.last_stop_reason = _STOP_DRY_RUN
            result["metrics"] = self.metrics.snapshot()
            return result

        if root is None:
            result["stop_reason"] = _STOP_NO_STORAGE
            self.metrics.last_stop_reason = _STOP_NO_STORAGE
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

            self._ensure_schema()
            use_skip_locked = self._use_postgres()
            deadline = started + cfg.max_runtime_seconds if cfg.max_runtime_seconds > 0 else None
            stop_reason = _STOP_NO_ROWS
            rows_done = 0
            tables = list(_MEDIA_MODELS.keys())
            table_cursor = 0

            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = "shutdown"
                    break
                if deadline is not None and time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break
                remaining = (cfg.max_rows - rows_done) if cfg.max_rows > 0 else cfg.batch_size
                if cfg.max_rows > 0 and remaining <= 0:
                    stop_reason = _STOP_MAX_ROWS
                    break

                migrated = failed = migrated_bytes = 0
                stages: dict[str, Any] = {}
                batch_started = time.perf_counter()
                try:
                    for offset in range(len(tables)):
                        table_name = tables[(table_cursor + offset) % len(tables)]
                        migrated, failed, migrated_bytes, stages = self._migrate_one_batch(
                            cfg=cfg,
                            table_name=table_name,
                            root=root,
                            row_limit=remaining,
                            use_skip_locked=use_skip_locked,
                        )
                        if migrated or failed:
                            table_cursor = (table_cursor + offset + 1) % len(tables)
                            break
                except Exception as exc:  # noqa: BLE001
                    self.metrics.errors += 1
                    result["errors"].append(str(exc) or exc.__class__.__name__)
                    stop_reason = _STOP_ERROR
                    logger.exception("dlp.media.backfill.batch_failed")
                    break

                if not migrated and not failed:
                    stop_reason = _STOP_NO_ROWS
                    break

                latency = (time.perf_counter() - batch_started) * 1000.0
                result["batches"] += 1
                result["rows_migrated"] += migrated
                result["rows_failed"] += failed
                result["bytes_migrated"] += migrated_bytes
                result["batch_latencies_ms"].append(round(latency, 2))
                rows_done += migrated + failed
                self.metrics.batches += 1
                self.metrics.rows_selected += migrated + failed
                self.metrics.rows_migrated += migrated
                self.metrics.rows_failed += failed
                self.metrics.bytes_migrated += migrated_bytes
                self.metrics.batch_latencies_ms.append(latency)
                logger.info(
                    "dlp.media.backfill.batch table=%s migrated=%s failed=%s bytes=%s "
                    "batch_total_ms=%.1f batch=%s",
                    stages.get("table"),
                    migrated,
                    failed,
                    migrated_bytes,
                    float(stages.get("batch_total_ms") or latency),
                    result["batches"],
                )
                stop_reason = _STOP_MAX_BATCHES
                if cfg.batch_pause_ms > 0:
                    time.sleep(cfg.batch_pause_ms / 1000.0)
        finally:
            if lock_conn is not None:
                try:
                    lock_conn.execute(
                        text("SELECT pg_advisory_unlock(:lock_key)"),
                        {"lock_key": self.advisory_lock_key()},
                    )
                    lock_conn.commit()
                except Exception:
                    pass
                lock_conn.close()

        result["stop_reason"] = stop_reason
        self.metrics.last_stop_reason = stop_reason
        result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
        result["metrics"] = self.metrics.snapshot()
        logger.info(
            "dlp.media.backfill.done stop=%s batches=%s migrated=%s failed=%s bytes=%s elapsed_ms=%.1f",
            stop_reason,
            result["batches"],
            result["rows_migrated"],
            result["rows_failed"],
            result["bytes_migrated"],
            result["elapsed_ms"],
        )
        return result


_dlp_media_backfill_service: DlpMediaBackfillService | None = None


def get_dlp_media_backfill_service() -> DlpMediaBackfillService:
    global _dlp_media_backfill_service
    if _dlp_media_backfill_service is None:
        _dlp_media_backfill_service = DlpMediaBackfillService()
    return _dlp_media_backfill_service
