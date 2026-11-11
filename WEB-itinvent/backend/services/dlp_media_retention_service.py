"""Retention / cleanup for DLP probe media (bytea screenshots+files, batch worker)."""
from __future__ import annotations

import hashlib
import logging
import os
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import delete, func, select, text, tuple_, update

from backend.appdb.db import app_session, get_app_database_url, get_app_engine, is_app_database_configured
from backend.appdb.file_egress_store import media_storage_ready, media_storage_root
from backend.appdb.models import (
    AppBrowserProbeMedia,
    AppBrowserProbeVisit,
    AppMaxProbeMedia,
    AppTelegramProbeMedia,
)

logger = logging.getLogger("backend.dlp.media.retention")

_ADVISORY_SCOPE = "dlp-media:retention"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_UNAVAILABLE = "lock_unavailable"
_STOP_ERROR = "error"
_STOP_DISABLED = "disabled"
_STOP_DRY_RUN = "dry_run"

# Whitelisted targets: table name is interpolated into SQL, never taken from input.
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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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
class RetentionConfig:
    enabled: bool = False
    dry_run: bool = True
    retention_days: int = 14
    batch_size: int = 25
    max_batches: int = 200
    max_runtime_seconds: int = 300
    interval_seconds: int = 86_400
    batch_pause_ms: int = 500
    startup_delay_seconds: int = 120

    @classmethod
    def from_env(cls) -> "RetentionConfig":
        return cls(
            enabled=_env_flag("DLP_MEDIA_CLEANUP_ENABLED", "false"),
            dry_run=_env_flag("DLP_MEDIA_CLEANUP_DRY_RUN", "true"),
            retention_days=_env_int("DLP_MEDIA_RETENTION_DAYS", 14, minimum=1, maximum=3650),
            batch_size=_env_int("DLP_MEDIA_CLEANUP_BATCH_SIZE", 25, minimum=1, maximum=200),
            max_batches=_env_int("DLP_MEDIA_CLEANUP_MAX_BATCHES", 200, minimum=1, maximum=100_000),
            max_runtime_seconds=_env_int(
                "DLP_MEDIA_CLEANUP_MAX_RUNTIME_SECONDS", 300, minimum=1, maximum=14_400
            ),
            interval_seconds=_env_int(
                "DLP_MEDIA_CLEANUP_INTERVAL_SECONDS", 86_400, minimum=60, maximum=604_800
            ),
            batch_pause_ms=_env_int(
                "DLP_MEDIA_CLEANUP_BATCH_PAUSE_MS", 500, minimum=0, maximum=60_000
            ),
            startup_delay_seconds=_env_int(
                "DLP_MEDIA_CLEANUP_STARTUP_DELAY_SECONDS", 120, minimum=0, maximum=3600
            ),
        )

    def cutoff(self, *, now: datetime | None = None) -> datetime:
        return (now or _utc_now()) - timedelta(days=self.retention_days)


@dataclass
class RetentionMetrics:
    cleanup_runs: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    batches: int = 0
    rows_selected: int = 0
    rows_deleted: int = 0
    bytes_deleted: int = 0
    errors: int = 0
    dry_run_eligible_rows: int = 0
    batch_latencies_ms: list[float] = field(default_factory=list)
    last_stop_reason: str = ""
    last_elapsed_ms: float = 0.0
    last_db_ms: float = 0.0
    oldest_eligible_age_seconds: Optional[float] = None
    oldest_remaining_age_seconds: Optional[float] = None

    def snapshot(self) -> dict[str, Any]:
        lat = list(self.batch_latencies_ms)
        return {
            "cleanup_runs": self.cleanup_runs,
            "lock_acquired": self.lock_acquired,
            "lock_skipped": self.lock_skipped,
            "batches": self.batches,
            "rows_selected": self.rows_selected,
            "rows_deleted": self.rows_deleted,
            "bytes_deleted": self.bytes_deleted,
            "errors": self.errors,
            "dry_run_eligible_rows": self.dry_run_eligible_rows,
            "elapsed_total_ms": self.last_elapsed_ms,
            "db_time_ms": self.last_db_ms,
            "batch_p50_ms": round(statistics.median(lat), 2) if lat else None,
            "batch_p95_ms": round(_percentile(lat, 0.95), 2) if lat else None,
            "batch_max_ms": round(max(lat), 2) if lat else None,
            "oldest_eligible_age_seconds": self.oldest_eligible_age_seconds,
            "oldest_remaining_age_seconds": self.oldest_remaining_age_seconds,
            "stop_reason": self.last_stop_reason,
        }


class DlpMediaRetentionService:
    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = database_url
        self.metrics = RetentionMetrics()

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> RetentionConfig:
        return RetentionConfig.from_env()

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

    def dry_run_report(self, *, config: RetentionConfig | None = None) -> dict[str, Any]:
        """Exact eligible counts + payload bytes per media table."""
        cfg = config or self.get_config()
        cutoff = cfg.cutoff()
        started = time.perf_counter()
        self._ensure_schema()
        by_table: list[dict[str, Any]] = []
        total_rows = 0
        total_bytes = 0
        oldest: str | None = None
        db_ms = 0.0
        for table_name, model in _MEDIA_MODELS.items():
            t0 = time.perf_counter()
            with app_session(**self._session_kwargs()) as session:
                row = session.execute(
                    select(
                        func.count(model.id),
                        func.min(model.created_at),
                        func.max(model.created_at),
                        func.coalesce(func.sum(func.length(model.content)), 0),
                    ).where(model.created_at < cutoff)
                ).one()
            db_ms += (time.perf_counter() - t0) * 1000.0
            count = int(row[0] or 0)
            payload = int(row[3] or 0)
            total_rows += count
            total_bytes += payload
            if row[1] is not None and (oldest is None or _iso(row[1]) < oldest):
                oldest = _iso(row[1])
            by_table.append(
                {
                    "table": table_name,
                    "retention_days": cfg.retention_days,
                    "cutoff_iso": _iso(cutoff),
                    "eligible_exact": count,
                    "eligible_bytes": payload,
                    "oldest_eligible_created_at": _iso(row[1]) if row[1] is not None else None,
                    "newest_eligible_created_at": _iso(row[2]) if row[2] is not None else None,
                }
            )
        self.metrics.dry_run_eligible_rows = total_rows
        self.metrics.oldest_eligible_age_seconds = self._age_seconds(oldest)
        report = {
            "mode": "dry_run",
            "count_mode": "exact",
            "enabled": cfg.enabled,
            "dry_run": True,
            "retention_days": cfg.retention_days,
            "cutoff_iso": _iso(cutoff),
            "batch_size": cfg.batch_size,
            "max_batches": cfg.max_batches,
            "max_runtime_seconds": cfg.max_runtime_seconds,
            "by_table": by_table,
            "eligible_rows_exact": total_rows,
            "eligible_bytes": total_bytes,
            "oldest_eligible_age_seconds": self.metrics.oldest_eligible_age_seconds,
            "expected_batches": (total_rows + cfg.batch_size - 1) // cfg.batch_size if total_rows else 0,
            "db_ms": round(db_ms, 2),
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }
        logger.info(
            "dlp.media.retention.dry_run eligible_exact=%s eligible_bytes=%s expected_batches=%s db_ms=%.1f",
            total_rows,
            total_bytes,
            report["expected_batches"],
            db_ms,
        )
        return report

    def _delete_one_batch(
        self,
        *,
        cfg: RetentionConfig,
        table_name: str,
        cutoff: datetime,
        use_skip_locked: bool,
    ) -> tuple[int, int, dict[str, Any]]:
        """Delete one bounded batch in one table. Returns (rows, bytes, stages)."""
        model = _MEDIA_MODELS[table_name]
        stages: dict[str, Any] = {
            "table": table_name,
            "select_candidates_ms": 0.0,
            "lock_candidates_ms": 0.0,
            "delete_ms": 0.0,
            "commit_ms": 0.0,
            "batch_total_ms": 0.0,
            "rows_deleted": 0,
            "bytes_deleted": 0,
            "files_deleted": 0,
            "files_unlink_failed": 0,
        }
        batch_started = time.perf_counter()
        storage_paths: list[str] = []
        with app_session(**self._session_kwargs()) as session:
            t_select = time.perf_counter()
            stmt = (
                select(model.id, func.length(model.content), model.storage_path, model.file_name, model.computer_name)
                .where(model.created_at < cutoff)
                .order_by(model.created_at, model.id)
                .limit(cfg.batch_size)
            )
            if use_skip_locked:
                stmt = stmt.with_for_update(skip_locked=True)
            rows = session.execute(stmt).all()
            select_ms = (time.perf_counter() - t_select) * 1000.0
            if use_skip_locked:
                stages["lock_candidates_ms"] = round(select_ms, 2)
            else:
                stages["select_candidates_ms"] = round(select_ms, 2)
            if not rows:
                stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
                return 0, 0, stages

            ids = [row[0] for row in rows]
            batch_bytes = sum(int(row[1] or 0) for row in rows)
            storage_paths = [str(row[2]) for row in rows if row[2]]
            t_del = time.perf_counter()
            session.execute(delete(model).where(model.id.in_(ids)))
            if model is AppBrowserProbeMedia:
                # Visits keep pointing at a file that is gone; drop the dead ref so the
                # UI does not offer a screenshot that no longer exists.
                ref_pairs = {(str(row[4] or ""), str(row[3] or "")) for row in rows if row[3]}
                if ref_pairs:
                    session.execute(
                        update(AppBrowserProbeVisit)
                        .where(
                            tuple_(
                                AppBrowserProbeVisit.computer_name,
                                AppBrowserProbeVisit.screenshot_file,
                            ).in_(ref_pairs)
                        )
                        .values(screenshot_file="")
                    )
            stages["delete_ms"] = round((time.perf_counter() - t_del) * 1000.0, 2)
            t_commit = time.perf_counter()
            session.commit()
            stages["commit_ms"] = round((time.perf_counter() - t_commit) * 1000.0, 2)
        if storage_paths:
            files_deleted, files_failed, files_bytes = self._unlink_media_files(storage_paths)
            stages["files_deleted"] = files_deleted
            stages["files_unlink_failed"] = files_failed
            batch_bytes += files_bytes
        stages["rows_deleted"] = len(ids)
        stages["bytes_deleted"] = batch_bytes
        stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
        return len(ids), batch_bytes, stages

    @staticmethod
    def _unlink_media_files(storage_paths: list[str]) -> tuple[int, int, int]:
        """Best-effort file cleanup after rows are committed as deleted."""
        root = media_storage_root()
        if root is None or not media_storage_ready(root):
            return 0, len(storage_paths), 0
        try:
            base = root.resolve()
        except OSError:
            return 0, len(storage_paths), 0
        deleted = failed = 0
        freed = 0
        for rel in storage_paths:
            try:
                target = (base / rel).resolve()
                if base not in target.parents:
                    failed += 1
                    continue
                try:
                    freed += target.stat().st_size
                except OSError:
                    pass
                target.unlink(missing_ok=True)
                deleted += 1
            except OSError:
                failed += 1
        return deleted, failed, freed

    def run_once(
        self,
        *,
        config: RetentionConfig | None = None,
        dry_run: bool | None = None,
        acquire_lock: bool = True,
        force_enabled: bool = False,
        should_stop: Any | None = None,
    ) -> dict[str, Any]:
        cfg = config or self.get_config()
        is_dry = cfg.dry_run if dry_run is None else bool(dry_run)
        started = time.perf_counter()
        self.metrics.cleanup_runs += 1
        cutoff = cfg.cutoff()
        result: dict[str, Any] = {
            "enabled": cfg.enabled,
            "dry_run": is_dry,
            "retention_days": cfg.retention_days,
            "cutoff_iso": _iso(cutoff),
            "stop_reason": "",
            "batches": 0,
            "rows_selected": 0,
            "rows_deleted": 0,
            "bytes_deleted": 0,
            "errors": [],
            "batch_latencies_ms": [],
            "batch_stages": [],
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
            use_skip_locked = self._use_postgres()
            tables = list(_MEDIA_MODELS.keys())
            table_cursor = 0

            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = "shutdown"
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break

                deleted_rows = 0
                deleted_bytes = 0
                stages: dict[str, Any] = {}
                batch_started = time.perf_counter()
                try:
                    for offset in range(len(tables)):
                        table_name = tables[(table_cursor + offset) % len(tables)]
                        deleted_rows, deleted_bytes, stages = self._delete_one_batch(
                            cfg=cfg,
                            table_name=table_name,
                            cutoff=cutoff,
                            use_skip_locked=use_skip_locked,
                        )
                        if deleted_rows:
                            table_cursor = (table_cursor + offset + 1) % len(tables)
                            break
                    db_ms += float(stages.get("batch_total_ms") or 0.0)
                except Exception as exc:  # noqa: BLE001
                    self.metrics.errors += 1
                    result["errors"].append(str(exc) or exc.__class__.__name__)
                    stop_reason = _STOP_ERROR
                    logger.exception("dlp.media.retention.batch_failed")
                    break

                if not deleted_rows:
                    stop_reason = _STOP_NO_ROWS
                    break

                latency = (time.perf_counter() - batch_started) * 1000.0
                result["batches"] += 1
                result["rows_selected"] += deleted_rows
                result["rows_deleted"] += deleted_rows
                result["bytes_deleted"] += deleted_bytes
                result["batch_latencies_ms"].append(round(latency, 2))
                result["batch_stages"].append(stages)
                self.metrics.batches += 1
                self.metrics.rows_selected += deleted_rows
                self.metrics.rows_deleted += deleted_rows
                self.metrics.bytes_deleted += deleted_bytes
                self.metrics.batch_latencies_ms.append(latency)
                logger.info(
                    "dlp.media.retention.batch table=%s deleted=%s bytes=%s batch_total_ms=%.1f "
                    "select_ms=%.1f lock_ms=%.1f delete_ms=%.1f commit_ms=%.1f batch=%s",
                    stages.get("table"),
                    deleted_rows,
                    deleted_bytes,
                    float(stages.get("batch_total_ms") or latency),
                    float(stages.get("select_candidates_ms") or 0.0),
                    float(stages.get("lock_candidates_ms") or 0.0),
                    float(stages.get("delete_ms") or 0.0),
                    float(stages.get("commit_ms") or 0.0),
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

            remaining_age = self._oldest_remaining_age_seconds(cfg)
            self.metrics.oldest_remaining_age_seconds = remaining_age
            result["oldest_remaining_age_seconds"] = remaining_age
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
                        "Failed to release dlp media retention advisory lock",
                        exc_info=True,
                    )
                lock_conn.close()

    def _oldest_remaining_age_seconds(self, cfg: RetentionConfig) -> Optional[float]:
        oldest: str | None = None
        cutoff = cfg.cutoff()
        try:
            for model in _MEDIA_MODELS.values():
                with app_session(**self._session_kwargs()) as session:
                    value = session.execute(
                        select(func.min(model.created_at)).where(model.created_at < cutoff)
                    ).scalar()
                if value is not None and (oldest is None or _iso(value) < oldest):
                    oldest = _iso(value)
            return self._age_seconds(oldest)
        except Exception:
            return None

    @staticmethod
    def _age_seconds(created_at: str | None) -> Optional[float]:
        if not created_at:
            return None
        try:
            parsed = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return max(0.0, (_utc_now() - parsed).total_seconds())
        except Exception:
            return None


dlp_media_retention_service = DlpMediaRetentionService()
