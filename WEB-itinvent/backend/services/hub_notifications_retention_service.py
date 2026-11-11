"""Retention / cleanup for Hub notifications (batch worker, not request-path)."""
from __future__ import annotations

import hashlib
import logging
import os
import statistics
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text

from backend.appdb.db import get_app_database_url, get_app_engine, is_app_database_configured

logger = logging.getLogger("backend.hub.notifications.retention")

_ADVISORY_SCOPE = "hub-notifications:retention"
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
    # Defaults tuned for write-path safety (PR3c), not max cleanup throughput.
    batch_size: int = 50
    max_batches: int = 40
    max_runtime_seconds: int = 60
    interval_seconds: int = 86_400
    batch_pause_ms: int = 750
    startup_delay_seconds: int = 120
    http_max_batch_size: int = 25
    allow_unread: bool = False
    chat_read_retention_days: int = 90
    task_read_retention_days: int = 180
    announcement_read_retention_days: int = 180

    @classmethod
    def from_env(cls) -> "RetentionConfig":
        return cls(
            enabled=_env_flag("HUB_NOTIFICATIONS_CLEANUP_ENABLED", "false"),
            dry_run=_env_flag("HUB_NOTIFICATIONS_CLEANUP_DRY_RUN", "true"),
            batch_size=_env_int("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", 50, minimum=1, maximum=500),
            max_batches=_env_int("HUB_NOTIFICATIONS_CLEANUP_MAX_BATCHES", 40, minimum=1, maximum=10_000),
            max_runtime_seconds=_env_int(
                "HUB_NOTIFICATIONS_CLEANUP_MAX_RUNTIME_SECONDS", 60, minimum=1, maximum=3600
            ),
            interval_seconds=_env_int(
                "HUB_NOTIFICATIONS_CLEANUP_INTERVAL_SECONDS", 86_400, minimum=5, maximum=604_800
            ),
            batch_pause_ms=_env_int(
                "HUB_NOTIFICATIONS_CLEANUP_BATCH_PAUSE_MS", 750, minimum=0, maximum=60_000
            ),
            startup_delay_seconds=_env_int(
                "HUB_NOTIFICATIONS_CLEANUP_STARTUP_DELAY_SECONDS", 120, minimum=0, maximum=3600
            ),
            http_max_batch_size=_env_int(
                "HUB_NOTIFICATIONS_CLEANUP_HTTP_MAX_BATCH_SIZE", 25, minimum=1, maximum=100
            ),
            allow_unread=_env_flag("HUB_NOTIFICATIONS_CLEANUP_ALLOW_UNREAD", "false"),
            chat_read_retention_days=_env_int(
                "HUB_NOTIFICATIONS_RETENTION_CHAT_READ_DAYS", 90, minimum=1, maximum=3650
            ),
            task_read_retention_days=_env_int(
                "HUB_NOTIFICATIONS_RETENTION_TASK_READ_DAYS", 180, minimum=1, maximum=3650
            ),
            announcement_read_retention_days=_env_int(
                "HUB_NOTIFICATIONS_RETENTION_ANNOUNCEMENT_READ_DAYS", 180, minimum=1, maximum=3650
            ),
        )

    def policies(self, *, now: datetime | None = None) -> list[dict[str, Any]]:
        moment = now or _utc_now()
        return [
            {
                "entity_type": "chat",
                "retention_days": self.chat_read_retention_days,
                "cutoff_iso": _iso(moment - timedelta(days=self.chat_read_retention_days)),
            },
            {
                "entity_type": "task",
                "retention_days": self.task_read_retention_days,
                "cutoff_iso": _iso(moment - timedelta(days=self.task_read_retention_days)),
            },
            {
                "entity_type": "announcement",
                "retention_days": self.announcement_read_retention_days,
                "cutoff_iso": _iso(moment - timedelta(days=self.announcement_read_retention_days)),
            },
        ]


@dataclass
class RetentionMetrics:
    cleanup_runs: int = 0
    lock_acquired: int = 0
    lock_skipped: int = 0
    batches: int = 0
    rows_selected: int = 0
    rows_deleted: int = 0
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


class HubNotificationsRetentionService:
    def __init__(self, hub: Any | None = None) -> None:
        self._hub = hub
        self.metrics = RetentionMetrics()

    @property
    def hub(self) -> Any:
        if self._hub is not None:
            return self._hub
        from backend.services.hub_service import hub_service

        return hub_service

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
            return str(get_app_engine(get_app_database_url()).dialect.name).lower() == "postgresql"
        except Exception:
            return False

    @staticmethod
    def _eligible_where_sql(*, allow_unread: bool, reads_table: str) -> str:
        clauses = [
            "n.entity_type = ?",
            "n.created_at < ?",
            "n.recipient_user_id IS NOT NULL",
        ]
        if not allow_unread:
            clauses.append(
                f"""EXISTS (
                  SELECT 1 FROM {reads_table} r
                  WHERE r.notification_id = n.id
                    AND r.user_id = n.recipient_user_id
                )"""
            )
        return " AND ".join(clauses)

    def dry_run_report(self, *, config: RetentionConfig | None = None) -> dict[str, Any]:
        """Estimate eligible rows without loading all IDs into memory."""
        cfg = config or self.get_config()
        hub = self.hub
        policies = cfg.policies()
        by_entity: list[dict[str, Any]] = []
        total_exact = 0
        oldest: str | None = None
        newest: str | None = None
        plan: Any = None
        started = time.perf_counter()
        db_ms = 0.0
        where_sql = self._eligible_where_sql(
            allow_unread=cfg.allow_unread,
            reads_table=hub._NOTIF_READS_TABLE,
        )

        for policy in policies:
            params = (policy["entity_type"], policy["cutoff_iso"])
            t0 = time.perf_counter()
            with hub._db_conn(write=False) as conn:
                count_row = conn.execute(
                    f"""
                    SELECT COUNT(*) AS c,
                           MIN(n.created_at) AS oldest_created_at,
                           MAX(n.created_at) AS newest_created_at
                    FROM {hub._NOTIF_TABLE} n
                    WHERE {where_sql}
                    """,
                    params,
                ).fetchone()
                count = int(count_row["c"] if hasattr(count_row, "keys") else count_row[0])
                entity_oldest = count_row["oldest_created_at"] if hasattr(count_row, "keys") else count_row[1]
                entity_newest = count_row["newest_created_at"] if hasattr(count_row, "keys") else count_row[2]
                unread_protected = 0
                if not cfg.allow_unread:
                    unread_row = conn.execute(
                        f"""
                        SELECT COUNT(*) AS c
                        FROM {hub._NOTIF_TABLE} n
                        WHERE n.entity_type = ?
                          AND n.created_at < ?
                          AND n.recipient_user_id IS NOT NULL
                          AND NOT EXISTS (
                            SELECT 1 FROM {hub._NOTIF_READS_TABLE} r
                            WHERE r.notification_id = n.id
                              AND r.user_id = n.recipient_user_id
                          )
                        """,
                        params,
                    ).fetchone()
                    unread_protected = int(
                        unread_row["c"] if hasattr(unread_row, "keys") else unread_row[0]
                    )
            db_ms += (time.perf_counter() - t0) * 1000.0
            total_exact += count
            if entity_oldest and (oldest is None or str(entity_oldest) < oldest):
                oldest = str(entity_oldest)
            if entity_newest and (newest is None or str(entity_newest) > newest):
                newest = str(entity_newest)
            by_entity.append(
                {
                    "entity_type": policy["entity_type"],
                    "retention_days": policy["retention_days"],
                    "cutoff_iso": policy["cutoff_iso"],
                    "eligible_exact": count,
                    "unread_protected_exact": unread_protected,
                }
            )

        chat_policy = next((p for p in policies if p["entity_type"] == "chat"), policies[0])
        if self._use_postgres():
            t0 = time.perf_counter()
            engine = get_app_engine(get_app_database_url())
            read_clause = ""
            if not cfg.allow_unread:
                read_clause = """
                  AND EXISTS (
                    SELECT 1 FROM app.hub_notification_reads r
                    WHERE r.notification_id = n.id
                      AND r.user_id = n.recipient_user_id
                  )
                """
            with engine.connect() as conn:
                plan = conn.execute(
                    text(
                        f"""
                        EXPLAIN (FORMAT JSON)
                        SELECT n.id
                        FROM app.hub_notifications n
                        WHERE n.entity_type = :entity_type
                          AND n.created_at < :cutoff
                          AND n.recipient_user_id IS NOT NULL
                          {read_clause}
                        ORDER BY n.created_at, n.id
                        LIMIT :limit
                        """
                    ),
                    {
                        "entity_type": chat_policy["entity_type"],
                        "cutoff": chat_policy["cutoff_iso"],
                        "limit": cfg.batch_size,
                    },
                ).scalar()
            db_ms += (time.perf_counter() - t0) * 1000.0

        expected_batches = (total_exact + cfg.batch_size - 1) // cfg.batch_size if total_exact else 0
        approx_bytes = None
        if self._use_postgres():
            with get_app_engine(get_app_database_url()).connect() as conn:
                size_row = conn.execute(
                    text(
                        """
                        SELECT pg_relation_size('app.hub_notifications') AS heap_bytes,
                               GREATEST(c.reltuples, 1)::bigint AS est_rows
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'app' AND c.relname = 'hub_notifications'
                        """
                    )
                ).mappings().one()
                heap = int(size_row["heap_bytes"] or 0)
                est_rows = max(int(size_row["est_rows"] or 1), 1)
                approx_bytes = int(heap * (total_exact / est_rows))

        oldest_age = self._age_seconds(oldest)
        self.metrics.dry_run_eligible_rows = total_exact
        self.metrics.oldest_eligible_age_seconds = oldest_age
        report = {
            "mode": "dry_run",
            "count_mode": "exact",
            "enabled": cfg.enabled,
            "dry_run": True,
            "allow_unread": cfg.allow_unread,
            "batch_size": cfg.batch_size,
            "max_batches": cfg.max_batches,
            "max_runtime_seconds": cfg.max_runtime_seconds,
            "policies": policies,
            "eligible_rows_exact": total_exact,
            "by_entity_type": by_entity,
            "oldest_eligible_created_at": oldest,
            "newest_eligible_created_at": newest,
            "oldest_eligible_age_seconds": oldest_age,
            "expected_batches": expected_batches,
            "approx_delete_heap_bytes": approx_bytes,
            "sql_plan": plan,
            "db_ms": round(db_ms, 2),
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }
        logger.info(
            "hub.notifications.retention.dry_run eligible_exact=%s expected_batches=%s db_ms=%.1f",
            total_exact,
            expected_batches,
            db_ms,
        )
        return report

    def _delete_one_batch(
        self,
        *,
        cfg: RetentionConfig,
        policy: dict[str, Any],
        use_skip_locked: bool,
    ) -> tuple[list[str], dict[str, Any]]:
        """Delete one entity_type batch. Returns (ids, stage_timings)."""
        hub = self.hub
        where_sql = self._eligible_where_sql(
            allow_unread=cfg.allow_unread,
            reads_table=hub._NOTIF_READS_TABLE,
        )
        params: list[Any] = [policy["entity_type"], policy["cutoff_iso"], cfg.batch_size]
        # ORDER BY created_at, id matches idx_hub_notifications_retention.
        select_sql = f"""
            SELECT n.id
            FROM {hub._NOTIF_TABLE} n
            WHERE {where_sql}
            ORDER BY n.created_at, n.id
            LIMIT ?
        """
        if use_skip_locked:
            select_sql = f"""
                SELECT n.id
                FROM {hub._NOTIF_TABLE} n
                WHERE {where_sql}
                ORDER BY n.created_at, n.id
                LIMIT ?
                FOR UPDATE OF n SKIP LOCKED
            """
        stages: dict[str, Any] = {
            "entity_type": policy["entity_type"],
            "select_candidates_ms": 0.0,
            "lock_candidates_ms": 0.0,
            "delete_ms": 0.0,
            "commit_ms": 0.0,
            "batch_total_ms": 0.0,
            "rows_deleted": 0,
            "wal_bytes": None,
        }
        batch_started = time.perf_counter()
        with hub._db_conn(write=True) as conn:
            t_select = time.perf_counter()
            rows = conn.execute(select_sql, tuple(params)).fetchall()
            # Combined select+lock when FOR UPDATE is used.
            select_ms = (time.perf_counter() - t_select) * 1000.0
            if use_skip_locked:
                stages["lock_candidates_ms"] = round(select_ms, 2)
            else:
                stages["select_candidates_ms"] = round(select_ms, 2)
            notification_ids = [
                str(item["id"] if hasattr(item, "keys") else item[0]).strip()
                for item in rows
                if str(item["id"] if hasattr(item, "keys") else item[0]).strip()
            ]
            if not notification_ids:
                stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
                return [], stages

            placeholders = ", ".join(["?"] * len(notification_ids))
            wal_before = None
            if use_skip_locked:
                try:
                    wal_before = conn.execute("SELECT pg_current_wal_lsn()").fetchone()
                    wal_before = wal_before[0] if wal_before else None
                except Exception:
                    wal_before = None
            t_del = time.perf_counter()
            conn.execute(
                f"DELETE FROM {hub._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                tuple(notification_ids),
            )
            conn.execute(
                f"DELETE FROM {hub._NOTIF_TABLE} WHERE id IN ({placeholders})",
                tuple(notification_ids),
            )
            stages["delete_ms"] = round((time.perf_counter() - t_del) * 1000.0, 2)
            if wal_before is not None:
                try:
                    wal_after = conn.execute("SELECT pg_current_wal_lsn()").fetchone()
                    wal_after = wal_after[0] if wal_after else None
                    if wal_after is not None:
                        diff = conn.execute(
                            "SELECT pg_wal_lsn_diff(?, ?)",
                            (str(wal_after), str(wal_before)),
                        ).fetchone()
                        stages["wal_bytes"] = int(diff[0] if diff else 0)
                except Exception:
                    stages["wal_bytes"] = None
            t_commit = time.perf_counter()
            conn.commit()
            stages["commit_ms"] = round((time.perf_counter() - t_commit) * 1000.0, 2)
        stages["rows_deleted"] = len(notification_ids)
        stages["batch_total_ms"] = round((time.perf_counter() - batch_started) * 1000.0, 2)
        return notification_ids, stages

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
        result: dict[str, Any] = {
            "enabled": cfg.enabled,
            "dry_run": is_dry,
            "stop_reason": "",
            "batches": 0,
            "rows_selected": 0,
            "rows_deleted": 0,
            "errors": [],
            "batch_latencies_ms": [],
            "batch_stages": [],
            "policies": cfg.policies(),
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
                engine = get_app_engine(get_app_database_url())
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
            use_skip_locked = self._use_postgres()
            policies = cfg.policies()
            policy_cursor = 0

            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = "shutdown"
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break

                deleted_ids: list[str] = []
                stages: dict[str, Any] = {}
                batch_started = time.perf_counter()
                try:
                    for offset in range(len(policies)):
                        policy = policies[(policy_cursor + offset) % len(policies)]
                        ids, stages = self._delete_one_batch(
                            cfg=cfg,
                            policy=policy,
                            use_skip_locked=use_skip_locked,
                        )
                        if ids:
                            deleted_ids = ids
                            policy_cursor = (policy_cursor + offset + 1) % len(policies)
                            break
                    db_ms += float(stages.get("batch_total_ms") or 0.0)
                except Exception as exc:  # noqa: BLE001
                    self.metrics.errors += 1
                    result["errors"].append(str(exc) or exc.__class__.__name__)
                    stop_reason = _STOP_ERROR
                    logger.exception("hub.notifications.retention.batch_failed")
                    break

                if not deleted_ids:
                    stop_reason = _STOP_NO_ROWS
                    break

                latency = (time.perf_counter() - batch_started) * 1000.0
                result["batches"] += 1
                result["rows_selected"] += len(deleted_ids)
                result["rows_deleted"] += len(deleted_ids)
                result["batch_latencies_ms"].append(round(latency, 2))
                result["batch_stages"].append(stages)
                self.metrics.batches += 1
                self.metrics.rows_selected += len(deleted_ids)
                self.metrics.rows_deleted += len(deleted_ids)
                self.metrics.batch_latencies_ms.append(latency)
                logger.info(
                    "hub.notifications.retention.batch deleted=%s batch_total_ms=%.1f "
                    "select_ms=%.1f lock_ms=%.1f delete_ms=%.1f commit_ms=%.1f wal_bytes=%s batch=%s",
                    len(deleted_ids),
                    float(stages.get("batch_total_ms") or latency),
                    float(stages.get("select_candidates_ms") or 0.0),
                    float(stages.get("lock_candidates_ms") or 0.0),
                    float(stages.get("delete_ms") or 0.0),
                    float(stages.get("commit_ms") or 0.0),
                    stages.get("wal_bytes"),
                    result["batches"],
                )
                stop_reason = _STOP_MAX_BATCHES
                if cfg.batch_pause_ms > 0:
                    # Pause in small slices so shutdown can interrupt between batches.
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
                        "Failed to release hub notifications retention advisory lock",
                        exc_info=True,
                    )
                lock_conn.close()

    def _oldest_remaining_age_seconds(self, cfg: RetentionConfig) -> Optional[float]:
        hub = self.hub
        where_sql = self._eligible_where_sql(
            allow_unread=cfg.allow_unread,
            reads_table=hub._NOTIF_READS_TABLE,
        )
        # Across all policies: oldest still-eligible row under the loosest (max) cutoff.
        max_days = max(
            cfg.chat_read_retention_days,
            cfg.task_read_retention_days,
            cfg.announcement_read_retention_days,
        )
        # Use per-type cutoffs via UNION of mins.
        oldest: str | None = None
        try:
            with hub._db_conn(write=False) as conn:
                for policy in cfg.policies():
                    row = conn.execute(
                        f"""
                        SELECT MIN(n.created_at) AS oldest
                        FROM {hub._NOTIF_TABLE} n
                        WHERE {where_sql}
                        """,
                        (policy["entity_type"], policy["cutoff_iso"]),
                    ).fetchone()
                    value = row["oldest"] if row is not None and hasattr(row, "keys") else (row[0] if row else None)
                    if value and (oldest is None or str(value) < oldest):
                        oldest = str(value)
            _ = max_days  # retained for readability / future metric labels
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


hub_notifications_retention_service = HubNotificationsRetentionService()
