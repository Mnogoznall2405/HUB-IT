"""Dedicated retention for scan.scan_task_system_metrics only.

Independent of SCAN_RETENTION_DAYS / cleanup_retention (incidents/jobs/tasks).
Policy: delete by captured_at age (HOURS preferred over DAYS). Defaults fail-closed.
"""
from __future__ import annotations

import hashlib
import logging
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

logger = logging.getLogger("scan_server.system_metrics.retention")

_ADVISORY_SCOPE = "scan:system_metrics:retention:24h"
_EPOCH_MIN = 1_000_000_000  # ~2001-09-09
_EPOCH_MAX_EXCL = 4_102_444_800  # 2100-01-01 UTC

_STOP_DISABLED = "disabled"
_STOP_DRY_RUN = "dry_run_complete"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_SKIPPED = "lock_skipped"
_STOP_LOCK_TIMEOUT = "lock_timeout"
_STOP_WAITING_LOCKS = "waiting_locks"
_STOP_ERROR_BUDGET = "error_budget"
_STOP_DISK = "disk_low"
_STOP_SLOW_BATCH = "slow_batch_p95"
_STOP_SHUTDOWN = "shutdown"
_STOP_ERROR = "error"
_STOP_HEALTH = "health_failed"


class SystemMetricsRetentionConfigError(ValueError):
    pass


def _env_raw(name: str, default: str | None = None) -> str | None:
    if name not in os.environ:
        return default
    return os.environ.get(name)


def _env_present(name: str) -> bool:
    return name in os.environ and str(os.environ.get(name) or "").strip() != ""


def _parse_bool(name: str, default: str) -> bool:
    raw = _env_raw(name, default)
    if raw is None:
        raise SystemMetricsRetentionConfigError(f"{name} is required")
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise SystemMetricsRetentionConfigError(f"{name} must be boolean, got {raw!r}")


def _parse_int(name: str, default: str, *, minimum: int, maximum: int) -> int:
    raw = _env_raw(name, default)
    if raw is None or str(raw).strip() == "":
        raise SystemMetricsRetentionConfigError(f"{name} is required")
    try:
        value = int(str(raw).strip())
    except Exception as exc:  # noqa: BLE001
        raise SystemMetricsRetentionConfigError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise SystemMetricsRetentionConfigError(
            f"{name} must be between {minimum} and {maximum}, got {value}"
        )
    return value


def _utc_now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


@dataclass
class SystemMetricsRetentionConfig:
    enabled: bool = False
    dry_run: bool = True
    retention_hours: int | None = 24
    retention_days: int = 3
    batch_size: int = 5000
    batch_pause_ms: int = 500
    max_batches: int = 100_000
    max_runtime_seconds: int = 300
    interval_seconds: int = 3600
    lock_timeout_ms: int = 1000
    statement_timeout_ms: int = 15_000
    error_budget: int = 3
    min_disk_free_gb: float = 5.0
    slow_batch_p95_ms: float = 3000.0
    startup_delay_seconds: int = 15
    hours_wins_over_days: bool = True

    @classmethod
    def from_env(cls) -> "SystemMetricsRetentionConfig":
        hours_set = _env_present("SCAN_SYSTEM_METRICS_RETENTION_HOURS")
        days_set = _env_present("SCAN_SYSTEM_METRICS_RETENTION_DAYS")
        retention_hours: int | None = None
        if hours_set:
            retention_hours = _parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_HOURS", "24", minimum=1, maximum=24 * 3650
            )
        elif not days_set:
            # Default policy: 24 hours when neither is set.
            retention_hours = 24
        retention_days = _parse_int(
            "SCAN_SYSTEM_METRICS_RETENTION_DAYS", "3", minimum=1, maximum=3650
        )
        hours_wins = bool(retention_hours is not None)
        if hours_set and days_set:
            logger.warning(
                "SCAN_SYSTEM_METRICS_RETENTION_HOURS=%s and DAYS=%s both set; HOURS wins",
                retention_hours,
                retention_days,
            )
        return cls(
            enabled=_parse_bool("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "false"),
            dry_run=_parse_bool("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "true"),
            retention_hours=retention_hours,
            retention_days=retention_days,
            hours_wins_over_days=hours_wins,
            batch_size=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_BATCH_SIZE", "5000", minimum=1, maximum=50_000
            ),
            batch_pause_ms=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS", "500", minimum=0, maximum=60_000
            ),
            max_batches=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_MAX_BATCHES", "100000", minimum=1, maximum=1_000_000
            ),
            max_runtime_seconds=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_MAX_RUNTIME_SECONDS",
                "300",
                minimum=1,
                maximum=3600,
            ),
            interval_seconds=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_INTERVAL_SECONDS",
                "3600",
                minimum=5,
                maximum=604_800,
            ),
            lock_timeout_ms=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_LOCK_TIMEOUT_MS",
                "1000",
                minimum=100,
                maximum=60_000,
            ),
            statement_timeout_ms=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_STATEMENT_TIMEOUT_MS",
                "15000",
                minimum=500,
                maximum=120_000,
            ),
            error_budget=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_ERROR_BUDGET", "3", minimum=1, maximum=100
            ),
            startup_delay_seconds=_parse_int(
                "SCAN_SYSTEM_METRICS_RETENTION_STARTUP_DELAY_SECONDS",
                "15",
                minimum=0,
                maximum=3600,
            ),
        )

    def cutoff_epoch(self, *, now_ts: int | None = None) -> int:
        now = int(now_ts if now_ts is not None else _utc_now_ts())
        if self.retention_hours is not None and self.hours_wins_over_days:
            return now - int(self.retention_hours) * 3600
        return now - int(self.retention_days) * 24 * 3600

    @property
    def retention_window_label(self) -> str:
        if self.retention_hours is not None and self.hours_wins_over_days:
            return f"{int(self.retention_hours)}h"
        return f"{int(self.retention_days)}d"


@dataclass
class SystemMetricsRetentionMetrics:
    cleanup_runs: int = 0
    batches: int = 0
    rows_deleted: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    errors: int = 0
    batch_latencies_ms: list[float] = field(default_factory=list)
    last_stop_reason: str = ""
    last_elapsed_ms: float = 0.0

    def snapshot(self) -> dict[str, Any]:
        lats = list(self.batch_latencies_ms)
        return {
            "cleanup_runs": self.cleanup_runs,
            "batches": self.batches,
            "rows_deleted": self.rows_deleted,
            "lock_acquired": self.lock_acquired,
            "lock_skipped": self.lock_skipped,
            "errors": self.errors,
            "last_stop_reason": self.last_stop_reason,
            "last_elapsed_ms": self.last_elapsed_ms,
            "batch_latency_p50_ms": statistics.median(lats) if lats else 0.0,
            "batch_latency_p95_ms": (
                sorted(lats)[min(len(lats) - 1, max(0, int(round((len(lats) - 1) * 0.95))))]
                if lats
                else 0.0
            ),
        }


class SystemMetricsRetentionService:
    def __init__(self) -> None:
        self.metrics = SystemMetricsRetentionMetrics()
        self.last_lock_connection_id: int | None = None
        self.last_batch_connection_ids: list[int] = []

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> SystemMetricsRetentionConfig:
        return SystemMetricsRetentionConfig.from_env()

    def _dsn(self) -> str:
        raw = (
            os.environ.get("SCAN_DATABASE_URL")
            or os.environ.get("APP_DATABASE_URL")
            or ""
        ).replace("postgresql+psycopg://", "postgresql://", 1)
        if not raw:
            raise SystemMetricsRetentionConfigError("SCAN_DATABASE_URL/APP_DATABASE_URL required")
        return raw

    def _connect(self):
        import psycopg

        return psycopg.connect(self._dsn(), autocommit=False)

    @staticmethod
    def _eligible_where_sql(*, table_alias: str = "m") -> str:
        # Age-only policy: no JOIN to scan_tasks / completed_at.
        return f"""
            {table_alias}.captured_at < %(cutoff)s
            AND {table_alias}.captured_at >= {_EPOCH_MIN}
            AND {table_alias}.captured_at < {_EPOCH_MAX_EXCL}
        """

    def dry_run_report(self, *, config: SystemMetricsRetentionConfig | None = None) -> dict[str, Any]:
        cfg = config or self.get_config()
        cutoff = cfg.cutoff_epoch()
        started = time.perf_counter()
        with self._connect() as conn:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT current_database()")
                db = cur.fetchone()[0]
                cur.execute("SELECT count(*) FROM scan.scan_task_system_metrics")
                total = int(cur.fetchone()[0])
                cur.execute(
                    f"""
                    SELECT count(*) FROM scan.scan_task_system_metrics m
                    WHERE {self._eligible_where_sql()}
                    """,
                    {"cutoff": cutoff},
                )
                eligible = int(cur.fetchone()[0])
        return {
            "mode": "dry_run",
            "database": db,
            "timestamp_column": "captured_at",
            "cutoff_epoch": cutoff,
            "retention_hours": cfg.retention_hours,
            "retention_days": cfg.retention_days,
            "hours_wins_over_days": cfg.hours_wins_over_days,
            "retention_window": cfg.retention_window_label,
            "total_rows": total,
            "eligible_rows_exact": eligible,
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }

    def _disk_free_gb(self) -> float:
        import shutil

        return shutil.disk_usage("C:\\").free / (1024**3)

    def _waiting_locks(self, cur) -> int:
        cur.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
        return int(cur.fetchone()[0] or 0)

    def _delete_one_batch(self, *, conn, cfg: SystemMetricsRetentionConfig, cutoff: int) -> tuple[int, float]:
        started = time.perf_counter()
        self.last_batch_connection_ids.append(id(conn))
        with conn.cursor() as cur:
            cur.execute(f"SET LOCAL lock_timeout = '{int(cfg.lock_timeout_ms)}ms'")
            cur.execute(f"SET LOCAL statement_timeout = '{int(cfg.statement_timeout_ms)}ms'")
            if self._waiting_locks(cur) > 0:
                raise RuntimeError("waiting_locks_detected")
            cur.execute(
                f"""
                WITH victims AS (
                  SELECT m.ctid
                  FROM scan.scan_task_system_metrics m
                  WHERE {self._eligible_where_sql()}
                  ORDER BY m.captured_at
                  FOR UPDATE OF m SKIP LOCKED
                  LIMIT %(batch_size)s
                )
                DELETE FROM scan.scan_task_system_metrics AS outbox
                USING victims v
                WHERE outbox.ctid = v.ctid
                RETURNING outbox.scan_task_id
                """,
                {"cutoff": cutoff, "batch_size": cfg.batch_size},
            )
            deleted = len(cur.fetchall())
        conn.commit()
        return deleted, (time.perf_counter() - started) * 1000.0

    def run_once(
        self,
        *,
        config: SystemMetricsRetentionConfig | None = None,
        dry_run: bool | None = None,
        acquire_lock: bool = True,
        force_enabled: bool = False,
        should_stop: Callable[[], bool] | None = None,
        health_check: Callable[[], bool] | None = None,
        run_id: str | None = None,
        cutoff_epoch: int | None = None,
        max_runtime_seconds: int | None = None,
        batch_size_override: int | None = None,
        max_batches_override: int | None = None,
        batch_pause_ms_override: int | None = None,
    ) -> dict[str, Any]:
        run_id = run_id or str(uuid.uuid4())
        started = time.perf_counter()
        self.metrics.cleanup_runs += 1
        self.last_lock_connection_id = None
        self.last_batch_connection_ids = []

        try:
            cfg = config or self.get_config()
        except SystemMetricsRetentionConfigError as exc:
            self.metrics.errors += 1
            self.metrics.last_stop_reason = _STOP_ERROR
            return {
                "run_id": run_id,
                "mode": "error",
                "stop_reason": _STOP_ERROR,
                "errors": [str(exc)],
                "rows_deleted": 0,
                "batches": 0,
                "metrics": self.metrics.snapshot(),
            }

        if batch_size_override is not None:
            cfg.batch_size = int(batch_size_override)
        if max_batches_override is not None:
            cfg.max_batches = int(max_batches_override)
        if batch_pause_ms_override is not None:
            cfg.batch_pause_ms = int(batch_pause_ms_override)
        if max_runtime_seconds is not None:
            cfg.max_runtime_seconds = int(max_runtime_seconds)

        is_dry = cfg.dry_run if dry_run is None else bool(dry_run)
        result: dict[str, Any] = {
            "run_id": run_id,
            "mode": "dry-run" if is_dry else ("execute" if (cfg.enabled or force_enabled) else "disabled"),
            "enabled": cfg.enabled,
            "dry_run": is_dry,
            "retention_hours": cfg.retention_hours,
            "retention_days": cfg.retention_days,
            "hours_wins_over_days": cfg.hours_wins_over_days,
            "retention_window": cfg.retention_window_label,
            "cutoff_epoch": cutoff_epoch if cutoff_epoch is not None else cfg.cutoff_epoch(),
            "batches": 0,
            "rows_deleted": 0,
            "batch_latencies_ms": [],
            "errors": [],
            "stop_reason": "",
            "lock_connection_id": None,
            "batch_connection_ids": [],
            "metrics": {},
        }
        cutoff = int(result["cutoff_epoch"])

        if not force_enabled and not cfg.enabled and not is_dry:
            result["stop_reason"] = _STOP_DISABLED
            self.metrics.last_stop_reason = _STOP_DISABLED
            result["metrics"] = self.metrics.snapshot()
            return result

        if is_dry:
            report = self.dry_run_report(config=cfg)
            result.update(report)
            result["run_id"] = run_id
            result["stop_reason"] = _STOP_DRY_RUN
            self.metrics.last_stop_reason = _STOP_DRY_RUN
            result["metrics"] = self.metrics.snapshot()
            return result

        lock_conn = None
        consecutive_errors = 0
        lock_timeout_streak = 0
        try:
            lock_conn = self._connect()
            self.last_lock_connection_id = id(lock_conn)
            result["lock_connection_id"] = self.last_lock_connection_id
            if acquire_lock:
                with lock_conn.cursor() as cur:
                    cur.execute(
                        "SELECT pg_try_advisory_lock(%s)",
                        (self.advisory_lock_key(),),
                    )
                    acquired = bool(cur.fetchone()[0])
                lock_conn.commit()
                if not acquired:
                    lock_conn.close()
                    lock_conn = None
                    self.metrics.lock_skipped += 1
                    result["stop_reason"] = _STOP_LOCK_SKIPPED
                    self.metrics.last_stop_reason = _STOP_LOCK_SKIPPED
                    result["metrics"] = self.metrics.snapshot()
                    return result
                self.metrics.lock_acquired += 1

            stop_reason = _STOP_NO_ROWS
            deadline = started + float(cfg.max_runtime_seconds)

            for batch_idx in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = _STOP_SHUTDOWN
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break
                if self._disk_free_gb() < float(cfg.min_disk_free_gb):
                    stop_reason = _STOP_DISK
                    break
                if batch_idx > 0 and batch_idx % 20 == 0:
                    if callable(health_check) and not health_check():
                        stop_reason = _STOP_HEALTH
                        break
                    lats = result["batch_latencies_ms"]
                    if len(lats) >= 5:
                        p95 = sorted(lats)[min(len(lats) - 1, int(round((len(lats) - 1) * 0.95)))]
                        if p95 > cfg.slow_batch_p95_ms:
                            stop_reason = _STOP_SLOW_BATCH
                            break

                try:
                    deleted, latency = self._delete_one_batch(conn=lock_conn, cfg=cfg, cutoff=cutoff)
                    consecutive_errors = 0
                    lock_timeout_streak = 0
                except Exception as exc:  # noqa: BLE001
                    try:
                        lock_conn.rollback()
                    except Exception:
                        pass
                    msg = str(exc) or exc.__class__.__name__
                    consecutive_errors += 1
                    self.metrics.errors += 1
                    result["errors"].append(msg)
                    lower = msg.lower()
                    if "waiting_locks" in lower:
                        stop_reason = _STOP_WAITING_LOCKS
                        break
                    if "lock timeout" in lower or "55p03" in lower or "таймаут" in lower:
                        lock_timeout_streak += 1
                        if lock_timeout_streak >= 3:
                            stop_reason = _STOP_LOCK_TIMEOUT
                            break
                        continue
                    if consecutive_errors >= cfg.error_budget:
                        stop_reason = _STOP_ERROR_BUDGET
                        break
                    continue

                if deleted <= 0:
                    stop_reason = _STOP_NO_ROWS
                    break

                result["batches"] += 1
                result["rows_deleted"] += deleted
                result["batch_latencies_ms"].append(round(latency, 2))
                self.metrics.batches += 1
                self.metrics.rows_deleted += deleted
                self.metrics.batch_latencies_ms.append(latency)
                stop_reason = _STOP_MAX_BATCHES
                logger.info(
                    "scan.system_metrics.retention.batch run_id=%s deleted=%s batch_ms=%.1f batch=%s",
                    run_id,
                    deleted,
                    latency,
                    result["batches"],
                )

                if cfg.batch_pause_ms > 0:
                    pause_deadline = time.perf_counter() + (cfg.batch_pause_ms / 1000.0)
                    while time.perf_counter() < pause_deadline:
                        if callable(should_stop) and should_stop():
                            stop_reason = _STOP_SHUTDOWN
                            break
                        time.sleep(min(0.1, max(0.0, pause_deadline - time.perf_counter())))
                    if stop_reason == _STOP_SHUTDOWN:
                        break

            result["batch_connection_ids"] = list(self.last_batch_connection_ids)
            result["stop_reason"] = stop_reason
            result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
            self.metrics.last_stop_reason = stop_reason
            self.metrics.last_elapsed_ms = result["elapsed_ms"]
            result["metrics"] = self.metrics.snapshot()
            return result
        finally:
            if lock_conn is not None:
                try:
                    lock_conn.rollback()
                except Exception:
                    pass
                if acquire_lock:
                    try:
                        with lock_conn.cursor() as cur:
                            cur.execute(
                                "SELECT pg_advisory_unlock(%s)",
                                (self.advisory_lock_key(),),
                            )
                        lock_conn.commit()
                    except Exception:
                        logger.warning("scan.system_metrics.retention.unlock_failed", exc_info=True)
                try:
                    lock_conn.close()
                except Exception:
                    pass


system_metrics_retention_service = SystemMetricsRetentionService()
