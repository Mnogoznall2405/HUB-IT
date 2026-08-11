"""Retention / cleanup for public.chat_push_outbox (batch worker, not request-path).

Stage 1.1 hardening:
- thresholds use updated_at (completion time), not created_at
- per-status indexable predicates with fair rotation
- failed attempts aligned with CHAT_PUSH_OUTBOX_MAX_ATTEMPTS
- session advisory lock held on one physical connection for the whole execute run

Defaults are fail-closed: cleanup disabled, dry-run enabled.
"""
from __future__ import annotations

import hashlib
import logging
import os
import statistics
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text

logger = logging.getLogger("backend.chat.push_outbox.retention")

_ADVISORY_SCOPE = "chat-push-outbox:retention"

_STOP_DISABLED = "disabled"
_STOP_DRY_RUN = "dry_run_complete"
_STOP_NO_ROWS = "no_rows"
_STOP_MAX_BATCHES = "max_batches"
_STOP_MAX_RUNTIME = "max_runtime"
_STOP_LOCK_SKIPPED = "lock_skipped"
_STOP_LOCK_TIMEOUT = "lock_timeout"
_STOP_WAITING_LOCKS = "waiting_locks"
_STOP_ERROR_BUDGET = "error_budget"
_STOP_SHUTDOWN = "shutdown"
_STOP_ERROR = "error"

_STATUS_NO_SUBSCRIPTIONS = "no_subscriptions"
_STATUS_SUPPRESSED = "suppressed"
_STATUS_SENT = "sent"
_STATUS_FAILED = "failed"
_ACTIVE_STATUSES = frozenset({"pending", "queued", "processing"})
_WHITELIST_ORDER = (
    _STATUS_NO_SUBSCRIPTIONS,
    _STATUS_SUPPRESSED,
    _STATUS_SENT,
    _STATUS_FAILED,
)
_WHITELIST_STATUSES = frozenset(_WHITELIST_ORDER)

# Same env var as delivery worker (push_outbox_service.max_attempts).
_DELIVERY_MAX_ATTEMPTS_ENV = "CHAT_PUSH_OUTBOX_MAX_ATTEMPTS"
_RETENTION_MIN_ATTEMPTS_ENV = "CHAT_PUSH_OUTBOX_FAILED_MIN_ATTEMPTS"


class PushOutboxRetentionConfigError(ValueError):
    """Invalid retention configuration (fail-closed)."""


def _env_raw(name: str, default: str | None = None) -> str | None:
    if name not in os.environ:
        return default
    return os.environ.get(name)


def _parse_bool(name: str, default: str) -> bool:
    raw = _env_raw(name, default)
    if raw is None:
        raise PushOutboxRetentionConfigError(f"{name} is required")
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise PushOutboxRetentionConfigError(f"{name} must be a boolean, got {raw!r}")


def _parse_int(name: str, default: str, *, minimum: int, maximum: int) -> int:
    raw = _env_raw(name, default)
    if raw is None or str(raw).strip() == "":
        raise PushOutboxRetentionConfigError(f"{name} is required")
    try:
        value = int(str(raw).strip())
    except Exception as exc:  # noqa: BLE001
        raise PushOutboxRetentionConfigError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise PushOutboxRetentionConfigError(
            f"{name} must be between {minimum} and {maximum}, got {value}"
        )
    return value


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    idx = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * q))))
    return ordered[idx]


def _resolve_failed_min_attempts() -> int:
    """Align with delivery worker; fail-closed on conflicting override."""
    delivery_max = _parse_int(_DELIVERY_MAX_ATTEMPTS_ENV, "8", minimum=1, maximum=20)
    # Optional legacy/override key: if present and differs from delivery max → fail-closed.
    if _RETENTION_MIN_ATTEMPTS_ENV in os.environ:
        override = _parse_int(_RETENTION_MIN_ATTEMPTS_ENV, str(delivery_max), minimum=1, maximum=100)
        if override != delivery_max:
            raise PushOutboxRetentionConfigError(
                f"{_RETENTION_MIN_ATTEMPTS_ENV}={override} disagrees with "
                f"{_DELIVERY_MAX_ATTEMPTS_ENV}={delivery_max}; fail-closed"
            )
    return delivery_max


@dataclass
class PushOutboxRetentionConfig:
    enabled: bool = False
    dry_run: bool = True
    no_subscriptions_days: int = 7
    suppressed_days: int = 14
    sent_days: int = 30
    failed_days: int = 30
    failed_min_attempts: int = 8
    delivery_max_attempts: int = 8
    batch_size: int = 200
    batch_pause_ms: int = 500
    max_batches: int = 100
    max_runtime_seconds: int = 120
    interval_seconds: int = 3600
    lock_timeout_ms: int = 2000
    statement_timeout_ms: int = 15000
    error_budget: int = 3
    startup_delay_seconds: int = 30

    @classmethod
    def from_env(cls) -> "PushOutboxRetentionConfig":
        failed_min = _resolve_failed_min_attempts()
        return cls(
            enabled=_parse_bool("CHAT_PUSH_OUTBOX_CLEANUP_ENABLED", "false"),
            dry_run=_parse_bool("CHAT_PUSH_OUTBOX_CLEANUP_DRY_RUN", "true"),
            no_subscriptions_days=_parse_int(
                "CHAT_PUSH_OUTBOX_NO_SUBSCRIPTIONS_DAYS", "7", minimum=1, maximum=3650
            ),
            suppressed_days=_parse_int(
                "CHAT_PUSH_OUTBOX_SUPPRESSED_DAYS", "14", minimum=1, maximum=3650
            ),
            sent_days=_parse_int("CHAT_PUSH_OUTBOX_SENT_DAYS", "30", minimum=1, maximum=3650),
            failed_days=_parse_int("CHAT_PUSH_OUTBOX_FAILED_DAYS", "30", minimum=1, maximum=3650),
            failed_min_attempts=failed_min,
            delivery_max_attempts=failed_min,
            batch_size=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_BATCH_SIZE", "200", minimum=1, maximum=5000
            ),
            batch_pause_ms=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_BATCH_PAUSE_MS", "500", minimum=0, maximum=60_000
            ),
            max_batches=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_MAX_BATCHES", "100", minimum=1, maximum=100_000
            ),
            max_runtime_seconds=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_MAX_RUNTIME_SECONDS", "120", minimum=1, maximum=3600
            ),
            interval_seconds=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_INTERVAL_SECONDS", "3600", minimum=5, maximum=604_800
            ),
            lock_timeout_ms=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_LOCK_TIMEOUT_MS", "2000", minimum=100, maximum=60_000
            ),
            statement_timeout_ms=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_STATEMENT_TIMEOUT_MS",
                "15000",
                minimum=1000,
                maximum=300_000,
            ),
            error_budget=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_ERROR_BUDGET", "3", minimum=1, maximum=100
            ),
            startup_delay_seconds=_parse_int(
                "CHAT_PUSH_OUTBOX_CLEANUP_STARTUP_DELAY_SECONDS", "30", minimum=0, maximum=3600
            ),
        )

    def thresholds(self, *, now: datetime | None = None) -> dict[str, Any]:
        moment = now or _utc_now()
        return {
            _STATUS_NO_SUBSCRIPTIONS: {
                "status": _STATUS_NO_SUBSCRIPTIONS,
                "retention_days": self.no_subscriptions_days,
                "cutoff": moment - timedelta(days=self.no_subscriptions_days),
                "cutoff_iso": _iso(moment - timedelta(days=self.no_subscriptions_days)),
                "min_attempts": None,
            },
            _STATUS_SUPPRESSED: {
                "status": _STATUS_SUPPRESSED,
                "retention_days": self.suppressed_days,
                "cutoff": moment - timedelta(days=self.suppressed_days),
                "cutoff_iso": _iso(moment - timedelta(days=self.suppressed_days)),
                "min_attempts": None,
            },
            _STATUS_SENT: {
                "status": _STATUS_SENT,
                "retention_days": self.sent_days,
                "cutoff": moment - timedelta(days=self.sent_days),
                "cutoff_iso": _iso(moment - timedelta(days=self.sent_days)),
                "min_attempts": None,
            },
            _STATUS_FAILED: {
                "status": _STATUS_FAILED,
                "retention_days": self.failed_days,
                "cutoff": moment - timedelta(days=self.failed_days),
                "cutoff_iso": _iso(moment - timedelta(days=self.failed_days)),
                "min_attempts": self.failed_min_attempts,
            },
        }

    def status_rotation_order(self) -> tuple[str, ...]:
        return _WHITELIST_ORDER


@dataclass
class PushOutboxRetentionMetrics:
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


class ChatPushOutboxRetentionService:
    def __init__(self) -> None:
        self.metrics = PushOutboxRetentionMetrics()
        self._status_cursor = 0
        # Test/observability: last lock connection identity held during execute.
        self.last_lock_connection_id: int | None = None
        self.last_batch_connection_ids: list[int] = []

    @staticmethod
    def advisory_lock_key(scope: str = _ADVISORY_SCOPE) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def get_config(self) -> PushOutboxRetentionConfig:
        return PushOutboxRetentionConfig.from_env()

    def _engine(self):
        from backend.chat.db import get_chat_engine

        return get_chat_engine()

    def _dialect_name(self) -> str:
        try:
            return str(self._engine().dialect.name or "").lower()
        except Exception:
            return ""

    def _use_postgres(self) -> bool:
        return self._dialect_name() == "postgresql"

    def _resolve_table_name(self, conn) -> str:
        if self._dialect_name() != "postgresql":
            return "chat_push_outbox"
        row = conn.execute(
            text(
                """
                SELECT table_schema
                FROM information_schema.tables
                WHERE table_name = 'chat_push_outbox'
                  AND table_schema IN ('public', 'chat')
                ORDER BY CASE table_schema WHEN 'public' THEN 0 ELSE 1 END
                LIMIT 1
                """
            )
        ).scalar()
        schema = str(row or "public")
        return f"{schema}.chat_push_outbox"

    @staticmethod
    def _status_where_sql(status: str, *, table_alias: str = "o") -> str:
        a = table_alias
        if status == _STATUS_FAILED:
            return f"{a}.status = :status AND {a}.updated_at < :cutoff AND {a}.attempt_count >= :min_attempts"
        return f"{a}.status = :status AND {a}.updated_at < :cutoff"

    def _status_params(self, cfg: PushOutboxRetentionConfig, status: str) -> dict[str, Any]:
        th = cfg.thresholds()[status]
        params: dict[str, Any] = {"status": status, "cutoff": th["cutoff"], "batch_size": cfg.batch_size}
        if status == _STATUS_FAILED:
            params["min_attempts"] = cfg.failed_min_attempts
        return params

    def _apply_session_timeouts(self, conn, cfg: PushOutboxRetentionConfig) -> None:
        if not self._use_postgres():
            return
        conn.execute(text(f"SET LOCAL lock_timeout = '{int(cfg.lock_timeout_ms)}ms'"))
        conn.execute(text(f"SET LOCAL statement_timeout = '{int(cfg.statement_timeout_ms)}ms'"))

    def _waiting_locks_count(self, conn) -> int:
        if not self._use_postgres():
            return 0
        return int(conn.execute(text("SELECT count(*) FROM pg_locks WHERE NOT granted")).scalar() or 0)

    def _age_seconds(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except Exception:
                return None
        if not isinstance(value, datetime):
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return max(0.0, (_utc_now() - value.astimezone(timezone.utc)).total_seconds())

    def snapshot_table_stats(self) -> dict[str, Any]:
        engine = self._engine()
        cfg = self.get_config()
        with engine.connect() as conn:
            table = self._resolve_table_name(conn)
            total = int(conn.execute(text(f"SELECT count(*) FROM {table}")).scalar() or 0)
            status_expr = "CAST(status AS TEXT)" if self._dialect_name() == "sqlite" else "status::text"
            by_status_rows = conn.execute(
                text(f"SELECT {status_expr} AS status, count(*) AS cnt FROM {table} GROUP BY 1 ORDER BY 2 DESC")
            ).mappings().all()
            by_status = {str(r["status"]): int(r["cnt"]) for r in by_status_rows}
            n_tup_del = None
            if self._use_postgres():
                schema, _, name = table.partition(".")
                if not name:
                    schema, name = "public", table
                n_tup_del = conn.execute(
                    text(
                        """
                        SELECT n_tup_del
                        FROM pg_stat_user_tables
                        WHERE schemaname = :schema AND relname = :name
                        """
                    ),
                    {"schema": schema, "name": name},
                ).scalar()
            # Sample eligible IDs using updated_at policy (content-free)
            sample_ids: list[int] = []
            for status in _WHITELIST_ORDER:
                params = self._status_params(cfg, status)
                where_sql = self._status_where_sql(status)
                rows = conn.execute(
                    text(
                        f"""
                        SELECT id FROM {table} o
                        WHERE {where_sql}
                        ORDER BY updated_at, id
                        LIMIT 5
                        """
                    ),
                    params,
                ).scalars().all()
                sample_ids.extend(int(x) for x in rows)
            return {
                "total_rows": total,
                "by_status": by_status,
                "n_tup_del": int(n_tup_del) if n_tup_del is not None else None,
                "eligible_id_sample": sample_ids[:20],
            }

    def dry_run_report(self, *, config: PushOutboxRetentionConfig | None = None) -> dict[str, Any]:
        cfg = config or self.get_config()
        started = time.perf_counter()
        db_ms = 0.0
        thresholds = cfg.thresholds()
        engine = self._engine()
        plans: dict[str, Any] = {}

        t0 = time.perf_counter()
        with engine.connect() as conn:
            table = self._resolve_table_name(conn)
            by_status: list[dict[str, Any]] = []
            total_eligible = 0
            oldest_any = None
            newest_any = None
            for status_key in _WHITELIST_ORDER:
                th = thresholds[status_key]
                params = self._status_params(cfg, status_key)
                # status_where without alias for bare table
                if status_key == _STATUS_FAILED:
                    status_where = "status = :status AND updated_at < :cutoff AND attempt_count >= :min_attempts"
                else:
                    status_where = "status = :status AND updated_at < :cutoff"
                row = conn.execute(
                    text(
                        f"""
                        SELECT count(*) AS cnt,
                               min(updated_at) AS oldest,
                               max(updated_at) AS newest
                        FROM {table}
                        WHERE {status_where}
                        """
                    ),
                    params,
                ).mappings().one()
                cnt = int(row["cnt"] or 0)
                total_eligible += cnt
                oldest = row["oldest"]
                newest = row["newest"]
                if oldest is not None and (oldest_any is None or oldest < oldest_any):
                    oldest_any = oldest
                if newest is not None and (newest_any is None or newest > newest_any):
                    newest_any = newest
                by_status.append(
                    {
                        "status": status_key,
                        "retention_days": th["retention_days"],
                        "cutoff_iso": th["cutoff_iso"],
                        "min_attempts": th["min_attempts"],
                        "eligible_exact": cnt,
                        "oldest_updated_at": _iso(oldest) if isinstance(oldest, datetime) else (
                            str(oldest) if oldest is not None else None
                        ),
                        "newest_updated_at": _iso(newest) if isinstance(newest, datetime) else (
                            str(newest) if newest is not None else None
                        ),
                        "oldest_age_seconds": self._age_seconds(oldest),
                        "newest_age_seconds": self._age_seconds(newest),
                    }
                )
                if self._use_postgres():
                    plans[status_key] = conn.execute(
                        text(
                            f"""
                            EXPLAIN (FORMAT JSON)
                            SELECT o.id
                            FROM {table} o
                            WHERE {self._status_where_sql(status_key)}
                            ORDER BY o.updated_at, o.id
                            LIMIT :batch_size
                            """
                        ),
                        params,
                    ).scalar()

            status_expr = "CAST(status AS TEXT)" if self._dialect_name() == "sqlite" else "status::text"
            active_rows = conn.execute(
                text(
                    f"""
                    SELECT {status_expr} AS status, count(*) AS cnt
                    FROM {table}
                    WHERE status IN ('pending', 'queued', 'processing')
                    GROUP BY 1
                    """
                )
            ).mappings().all()
            active_by_status = {str(r["status"]): int(r["cnt"]) for r in active_rows}
            active_total = sum(active_by_status.values())

            unknown_rows = conn.execute(
                text(
                    f"""
                    SELECT {status_expr} AS status, count(*) AS cnt
                    FROM {table}
                    WHERE status NOT IN (
                      'pending','queued','processing',
                      'no_subscriptions','suppressed','sent','failed'
                    )
                    GROUP BY 1 ORDER BY 2 DESC
                    """
                )
            ).mappings().all()
            unknown_by_status = {str(r["status"]): int(r["cnt"]) for r in unknown_rows}
            unknown_total = sum(unknown_by_status.values())
        db_ms += (time.perf_counter() - t0) * 1000.0

        expected_batches = (
            (total_eligible + cfg.batch_size - 1) // cfg.batch_size if total_eligible else 0
        )
        est_seconds = None
        if expected_batches:
            per_batch = (cfg.batch_pause_ms / 1000.0) + 0.05
            est_seconds = round(min(expected_batches, cfg.max_batches) * per_batch, 2)

        oldest_age = self._age_seconds(oldest_any)
        self.metrics.dry_run_eligible_rows = total_eligible
        self.metrics.oldest_eligible_age_seconds = oldest_age

        report = {
            "mode": "dry_run",
            "count_mode": "exact",
            "timestamp_column": "updated_at",
            "enabled": cfg.enabled,
            "dry_run": True,
            "batch_size": cfg.batch_size,
            "max_batches": cfg.max_batches,
            "max_runtime_seconds": cfg.max_runtime_seconds,
            "batch_pause_ms": cfg.batch_pause_ms,
            "delivery_max_attempts": cfg.delivery_max_attempts,
            "failed_min_attempts": cfg.failed_min_attempts,
            "thresholds": {
                k: {
                    "status": v["status"],
                    "retention_days": v["retention_days"],
                    "cutoff_iso": v["cutoff_iso"],
                    "min_attempts": v["min_attempts"],
                    "timestamp_column": "updated_at",
                }
                for k, v in thresholds.items()
            },
            "eligible_rows_exact": total_eligible,
            "by_status": by_status,
            "active_excluded_total": active_total,
            "active_excluded_by_status": active_by_status,
            "unknown_status_total": unknown_total,
            "unknown_status_by_status": unknown_by_status,
            "oldest_eligible_updated_at": _iso(oldest_any)
            if isinstance(oldest_any, datetime)
            else (str(oldest_any) if oldest_any is not None else None),
            "newest_eligible_updated_at": _iso(newest_any)
            if isinstance(newest_any, datetime)
            else (str(newest_any) if newest_any is not None else None),
            "oldest_eligible_age_seconds": oldest_age,
            "expected_batches": expected_batches,
            "estimated_runtime_seconds": est_seconds,
            "sql_plans_by_status": plans,
            "recommended_index": (
                "CREATE INDEX CONCURRENTLY ix_chat_push_outbox_retention_status_updated_at_id "
                "ON public.chat_push_outbox (status, updated_at, id);"
            ),
            "db_ms": round(db_ms, 2),
            "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
        }
        logger.info(
            "chat.push_outbox.retention.dry_run eligible_exact=%s expected_batches=%s "
            "active_excluded=%s unknown=%s ts=updated_at db_ms=%.1f",
            total_eligible,
            expected_batches,
            active_total,
            unknown_total,
            db_ms,
        )
        return report

    def _delete_one_batch_postgres_for_status(
        self,
        *,
        cfg: PushOutboxRetentionConfig,
        status: str,
        lock_conn: Any,
    ) -> tuple[dict[str, int], float]:
        """One short TX on the lock connection: single-status range + SKIP LOCKED."""
        if lock_conn is None:
            raise RuntimeError("lock_connection_required")
        params = self._status_params(cfg, status)
        where_sql = self._status_where_sql(status)
        started = time.perf_counter()
        deleted_by_status: dict[str, int] = {}
        self.last_batch_connection_ids.append(id(lock_conn))

        with lock_conn.begin():
            self._apply_session_timeouts(lock_conn, cfg)
            if self._waiting_locks_count(lock_conn) > 0:
                raise RuntimeError("waiting_locks_detected")
            table = self._resolve_table_name(lock_conn)
            rows = lock_conn.execute(
                text(
                    f"""
                    WITH victims AS (
                      SELECT o.id, o.status
                      FROM {table} o
                      WHERE {where_sql}
                      ORDER BY o.updated_at, o.id
                      FOR UPDATE OF o SKIP LOCKED
                      LIMIT :batch_size
                    )
                    DELETE FROM {table} AS outbox
                    USING victims
                    WHERE outbox.id = victims.id
                    RETURNING outbox.id, outbox.status
                    """
                ),
                params,
            ).mappings().all()
            for row in rows:
                st = str(row["status"])
                if st != status or st in _ACTIVE_STATUSES or st not in _WHITELIST_STATUSES:
                    raise RuntimeError(f"refusing_delete_unexpected_status:{st}")
                deleted_by_status[st] = deleted_by_status.get(st, 0) + 1
        return deleted_by_status, (time.perf_counter() - started) * 1000.0

    def _delete_one_batch_sqlite_for_status(
        self,
        *,
        cfg: PushOutboxRetentionConfig,
        status: str,
    ) -> tuple[dict[str, int], float]:
        from backend.chat.db import chat_session
        from backend.chat.models import ChatPushOutbox
        from sqlalchemy import and_, delete, select

        started = time.perf_counter()
        th = cfg.thresholds()[status]
        deleted_by_status: dict[str, int] = {}
        with chat_session() as session:
            predicates = [
                ChatPushOutbox.status == status,
                ChatPushOutbox.updated_at < th["cutoff"],
            ]
            if status == _STATUS_FAILED:
                predicates.append(ChatPushOutbox.attempt_count >= cfg.failed_min_attempts)
            rows = list(
                session.execute(
                    select(ChatPushOutbox.id, ChatPushOutbox.status)
                    .where(and_(*predicates))
                    .order_by(ChatPushOutbox.updated_at.asc(), ChatPushOutbox.id.asc())
                    .limit(cfg.batch_size)
                ).all()
            )
            if not rows:
                return {}, (time.perf_counter() - started) * 1000.0
            ids = []
            for row in rows:
                st = str(row.status)
                if st != status or st in _ACTIVE_STATUSES or st not in _WHITELIST_STATUSES:
                    raise RuntimeError(f"refusing_delete_unexpected_status:{st}")
                ids.append(int(row.id))
                deleted_by_status[st] = deleted_by_status.get(st, 0) + 1
            session.execute(delete(ChatPushOutbox).where(ChatPushOutbox.id.in_(ids)))
        return deleted_by_status, (time.perf_counter() - started) * 1000.0

    def _delete_one_fair_batch(
        self,
        *,
        cfg: PushOutboxRetentionConfig,
        lock_conn: Any | None,
    ) -> tuple[dict[str, int], float]:
        """Rotate across whitelist statuses so one status cannot starve others."""
        order = cfg.status_rotation_order()
        n = len(order)
        use_pg = self._use_postgres()
        for offset in range(n):
            status = order[(self._status_cursor + offset) % n]
            if use_pg:
                deleted, latency = self._delete_one_batch_postgres_for_status(
                    cfg=cfg, status=status, lock_conn=lock_conn
                )
            else:
                deleted, latency = self._delete_one_batch_sqlite_for_status(cfg=cfg, status=status)
            if sum(deleted.values()) > 0:
                self._status_cursor = (self._status_cursor + offset + 1) % n
                return deleted, latency
        # Advance cursor even on empty full rotation.
        self._status_cursor = (self._status_cursor + 1) % n
        return {}, 0.0

    def _oldest_remaining_age_seconds(
        self, cfg: PushOutboxRetentionConfig, *, conn: Any | None = None
    ) -> Optional[float]:
        owns = False
        if conn is None:
            conn = self._engine().connect()
            owns = True
        try:
            table = self._resolve_table_name(conn)
            oldest_any = None
            for status in _WHITELIST_ORDER:
                params = self._status_params(cfg, status)
                where_sql = self._status_where_sql(status)
                oldest = conn.execute(
                    text(f"SELECT min(updated_at) FROM {table} o WHERE {where_sql}"),
                    params,
                ).scalar()
                if oldest is not None and (oldest_any is None or oldest < oldest_any):
                    oldest_any = oldest
            return self._age_seconds(oldest_any)
        finally:
            if owns:
                conn.close()

    def run_once(
        self,
        *,
        config: PushOutboxRetentionConfig | None = None,
        dry_run: bool | None = None,
        acquire_lock: bool = True,
        force_enabled: bool = False,
        should_stop: Callable[[], bool] | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        run_id = run_id or str(uuid.uuid4())
        started = time.perf_counter()
        self.metrics.cleanup_runs += 1
        self.last_lock_connection_id = None
        self.last_batch_connection_ids = []

        try:
            cfg = config or self.get_config()
        except PushOutboxRetentionConfigError as exc:
            self.metrics.errors += 1
            self.metrics.last_stop_reason = _STOP_ERROR
            logger.error("chat.push_outbox.retention.config_invalid error=%s", str(exc))
            return {
                "run_id": run_id,
                "mode": "error",
                "stop_reason": _STOP_ERROR,
                "errors": [str(exc)],
                "enabled": False,
                "dry_run": True,
                "rows_deleted": 0,
                "batches": 0,
                "deleted_by_status": {},
                "metrics": self.metrics.snapshot(),
            }

        is_dry = cfg.dry_run if dry_run is None else bool(dry_run)
        mode = "dry-run" if is_dry else ("execute" if (cfg.enabled or force_enabled) else "disabled")
        result: dict[str, Any] = {
            "run_id": run_id,
            "mode": mode,
            "enabled": cfg.enabled,
            "dry_run": is_dry,
            "timestamp_column": "updated_at",
            "stop_reason": "",
            "batches": 0,
            "rows_selected": 0,
            "rows_deleted": 0,
            "deleted_by_status": {},
            "errors": [],
            "batch_latencies_ms": [],
            "lock_connection_id": None,
            "batch_connection_ids": [],
            "metrics": {},
        }

        if not force_enabled and not cfg.enabled and not is_dry:
            result["stop_reason"] = _STOP_DISABLED
            result["mode"] = "disabled"
            self.metrics.last_stop_reason = _STOP_DISABLED
            result["metrics"] = self.metrics.snapshot()
            return result

        if is_dry:
            report = self.dry_run_report(config=cfg)
            result.update(report)
            result["run_id"] = run_id
            result["mode"] = "dry-run"
            result["stop_reason"] = _STOP_DRY_RUN
            self.metrics.last_stop_reason = _STOP_DRY_RUN
            self.metrics.last_elapsed_ms = float(result.get("elapsed_ms") or 0.0)
            self.metrics.last_db_ms = float(result.get("db_ms") or 0.0)
            result["metrics"] = self.metrics.snapshot()
            return result

        lock_conn = None
        lock_wait_ms = 0.0
        consecutive_errors = 0
        lock_timeout_streak = 0
        try:
            use_pg = self._use_postgres()
            if use_pg:
                # Always hold one physical connection for the entire execute run when PG.
                # Even if acquire_lock=False (tests/process-wrapper), keep a dedicated conn
                # so batch TX cannot bounce across pool checkouts.
                engine = self._engine()
                t_lock = time.perf_counter()
                lock_conn = engine.connect()
                self.last_lock_connection_id = id(lock_conn)
                result["lock_connection_id"] = self.last_lock_connection_id
                if acquire_lock:
                    acquired = lock_conn.execute(
                        text("SELECT pg_try_advisory_lock(:lock_key)"),
                        {"lock_key": self.advisory_lock_key()},
                    ).scalar()
                    lock_conn.commit()
                    lock_wait_ms = (time.perf_counter() - t_lock) * 1000.0
                    if not acquired:
                        lock_conn.close()
                        lock_conn = None
                        self.last_lock_connection_id = None
                        self.metrics.lock_skipped += 1
                        result["stop_reason"] = _STOP_LOCK_SKIPPED
                        result["advisory_lock_wait_ms"] = round(lock_wait_ms, 2)
                        self.metrics.last_stop_reason = _STOP_LOCK_SKIPPED
                        result["metrics"] = self.metrics.snapshot()
                        return result
                    self.metrics.lock_acquired += 1
                else:
                    lock_wait_ms = (time.perf_counter() - t_lock) * 1000.0
            result["advisory_lock_wait_ms"] = round(lock_wait_ms, 2)

            stop_reason = _STOP_NO_ROWS
            deadline = started + float(cfg.max_runtime_seconds)
            empty_rotations = 0

            for _ in range(cfg.max_batches):
                if callable(should_stop) and should_stop():
                    stop_reason = _STOP_SHUTDOWN
                    break
                if time.perf_counter() >= deadline:
                    stop_reason = _STOP_MAX_RUNTIME
                    break

                try:
                    deleted_by_status, latency = self._delete_one_fair_batch(
                        cfg=cfg, lock_conn=lock_conn
                    )
                    consecutive_errors = 0
                    lock_timeout_streak = 0
                except Exception as exc:  # noqa: BLE001
                    msg = str(exc) or exc.__class__.__name__
                    consecutive_errors += 1
                    self.metrics.errors += 1
                    result["errors"].append(msg)
                    lower = msg.lower()
                    if "waiting_locks" in lower:
                        stop_reason = _STOP_WAITING_LOCKS
                        break
                    if "lock timeout" in lower or "canceling statement due to lock timeout" in lower:
                        lock_timeout_streak += 1
                        if lock_timeout_streak >= 2:
                            stop_reason = _STOP_LOCK_TIMEOUT
                            break
                        continue
                    if consecutive_errors >= cfg.error_budget:
                        stop_reason = _STOP_ERROR_BUDGET
                        logger.exception("chat.push_outbox.retention.error_budget_exceeded")
                        break
                    logger.exception("chat.push_outbox.retention.batch_failed")
                    continue

                deleted_total = sum(deleted_by_status.values())
                if deleted_total <= 0:
                    empty_rotations += 1
                    # One full fair rotation without rows → done.
                    if empty_rotations >= len(_WHITELIST_ORDER):
                        stop_reason = _STOP_NO_ROWS
                        break
                    continue
                empty_rotations = 0

                result["batches"] += 1
                result["rows_selected"] += deleted_total
                result["rows_deleted"] += deleted_total
                result["batch_latencies_ms"].append(round(latency, 2))
                for st, cnt in deleted_by_status.items():
                    result["deleted_by_status"][st] = int(result["deleted_by_status"].get(st, 0)) + int(cnt)
                self.metrics.batches += 1
                self.metrics.rows_selected += deleted_total
                self.metrics.rows_deleted += deleted_total
                self.metrics.batch_latencies_ms.append(latency)
                logger.info(
                    "chat.push_outbox.retention.batch run_id=%s deleted=%s by_status=%s "
                    "batch_ms=%.1f batch=%s lock_conn=%s",
                    run_id,
                    deleted_total,
                    deleted_by_status,
                    latency,
                    result["batches"],
                    self.last_lock_connection_id,
                )
                stop_reason = _STOP_MAX_BATCHES

                if cfg.batch_pause_ms > 0:
                    pause_deadline = time.perf_counter() + (cfg.batch_pause_ms / 1000.0)
                    while time.perf_counter() < pause_deadline:
                        if callable(should_stop) and should_stop():
                            stop_reason = _STOP_SHUTDOWN
                            break
                        time.sleep(min(0.1, max(0.0, pause_deadline - time.perf_counter())))
                    if stop_reason == _STOP_SHUTDOWN:
                        break

            try:
                remaining_age = self._oldest_remaining_age_seconds(cfg, conn=lock_conn)
            except Exception:
                remaining_age = None
            self.metrics.oldest_remaining_age_seconds = remaining_age
            result["oldest_remaining_age_seconds"] = remaining_age
            result["batch_connection_ids"] = list(self.last_batch_connection_ids)
            result["stop_reason"] = stop_reason
            result["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
            self.metrics.last_stop_reason = stop_reason
            self.metrics.last_elapsed_ms = result["elapsed_ms"]
            result["metrics"] = self.metrics.snapshot()
            return result
        finally:
            if lock_conn is not None:
                if acquire_lock and self._use_postgres():
                    try:
                        lock_conn.execute(
                            text("SELECT pg_advisory_unlock(:lock_key)"),
                            {"lock_key": self.advisory_lock_key()},
                        )
                        lock_conn.commit()
                    except Exception:
                        logger.warning(
                            "chat.push_outbox.retention.unlock_failed run_id=%s",
                            run_id,
                            exc_info=True,
                        )
                try:
                    lock_conn.close()
                except Exception:
                    pass


chat_push_outbox_retention_service = ChatPushOutboxRetentionService()
