"""Deferred cleanup of previous compact index_version rows.

Ordinary incremental patches only *schedule* cleanup via
``previous_cleanup_after``. This service deletes previous-version documents
and token_stats in small SKIP LOCKED batches after grace.

Fail-closed defaults: enabled=false, dry_run=true.

PostgreSQL DELETE does **not** shrink GIN index files; reclaiming dead space
requires separately approved ``REINDEX INDEX CONCURRENTLY`` (or VACUUM) ops —
never run those from this service.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from backend.services.one_c_catalog_compact_flags import get_compact_flags


logger = logging.getLogger(__name__)

# Distinct from incremental (0x1CC0BF13) / rebuild (0x1CC0BF12) / backfill.
CLEANUP_ADVISORY_LOCK_KEY = 0x1CC0BF14

CLEANUP_METRICS: dict[str, float] = {
    "cleanup_runs_total": 0,
    "cleanup_dry_run_total": 0,
    "cleanup_batches_total": 0,
    "cleanup_docs_deleted_total": 0,
    "cleanup_stats_deleted_total": 0,
    "cleanup_errors_total": 0,
    "cleanup_lock_skipped_total": 0,
    "cleanup_aborted_budget_total": 0,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class CleanupRunReport:
    ok: bool
    outcome: str  # disabled | dry_run | cleaned | lock_skipped | aborted | failed
    scopes_considered: int = 0
    documents_deleted: int = 0
    token_stats_deleted: int = 0
    batches: int = 0
    dry_run: bool = True
    error: str = ""
    metrics: dict[str, float] = field(default_factory=dict)


class OneCCatalogCompactCleanupService:
    """Batch-delete previous index versions past grace. Never touches active/building."""

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        dry_run: bool | None = None,
        batch_size: int | None = None,
        max_batches: int | None = None,
        max_runtime_seconds: int | None = None,
        pause_ms: int | None = None,
        statement_timeout_ms: int | None = None,
        error_budget: int | None = None,
    ) -> None:
        flags = get_compact_flags()
        self._enabled = (
            flags.compact_previous_cleanup_enabled
            if enabled is None
            else bool(enabled)
        )
        self._dry_run = (
            flags.compact_previous_cleanup_dry_run
            if dry_run is None
            else bool(dry_run)
        )
        self._batch_size = max(
            100,
            min(
                5_000,
                int(
                    batch_size
                    if batch_size is not None
                    else flags.compact_previous_cleanup_batch_size
                ),
            ),
        )
        # Prefer 2k–5k; clamp already applied.
        if self._batch_size < 2_000:
            self._batch_size = max(self._batch_size, 2_000) if batch_size is None else self._batch_size
        self._max_batches = max(
            1,
            int(
                max_batches
                if max_batches is not None
                else flags.compact_previous_cleanup_max_batches
            ),
        )
        self._max_runtime_seconds = max(
            0,
            int(
                max_runtime_seconds
                if max_runtime_seconds is not None
                else flags.compact_previous_cleanup_max_runtime_seconds
            ),
        )
        self._pause_ms = max(
            0,
            int(
                pause_ms
                if pause_ms is not None
                else flags.compact_previous_cleanup_pause_ms
            ),
        )
        self._statement_timeout_ms = max(
            1_000,
            int(
                statement_timeout_ms
                if statement_timeout_ms is not None
                else flags.compact_previous_cleanup_statement_timeout_ms
            ),
        )
        self._error_budget = max(
            1,
            int(
                error_budget
                if error_budget is not None
                else flags.compact_previous_cleanup_error_budget
            ),
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def dry_run(self) -> bool:
        return self._dry_run

    def _try_lock(self, session) -> bool:
        got = session.execute(
            text(f"SELECT pg_try_advisory_lock({int(CLEANUP_ADVISORY_LOCK_KEY)})")
        ).scalar()
        return bool(got)

    def _unlock(self, session) -> None:
        try:
            session.execute(
                text(f"SELECT pg_advisory_unlock({int(CLEANUP_ADVISORY_LOCK_KEY)})")
            )
        except Exception:
            pass

    def _apply_timeouts(self, session) -> None:
        session.execute(
            text(f"SET LOCAL statement_timeout = '{int(self._statement_timeout_ms)}ms'")
        )
        session.execute(text("SET LOCAL lock_timeout = '2s'"))

    def list_cleanup_candidates(self, session) -> list[dict[str, Any]]:
        """Scopes with previous version past grace, not equal to active/building."""
        rows = session.execute(
            text(
                """
                SELECT source_base, catalog_type,
                       coalesce(active_index_version, 0) AS active_index_version,
                       coalesce(building_index_version, 0) AS building_index_version,
                       coalesce(previous_index_version, 0) AS previous_index_version,
                       previous_cleanup_after
                FROM app.one_c_catalog_search_index_state
                WHERE coalesce(previous_index_version, 0) > 0
                  AND previous_cleanup_after IS NOT NULL
                  AND previous_cleanup_after <= :now
                  AND coalesce(previous_index_version, 0)
                      IS DISTINCT FROM coalesce(active_index_version, 0)
                  AND coalesce(previous_index_version, 0)
                      IS DISTINCT FROM coalesce(building_index_version, 0)
                ORDER BY previous_cleanup_after ASC
                """
            ),
            {"now": _now()},
        ).mappings().all()
        return [dict(r) for r in rows]

    def _count_version_rows(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
    ) -> tuple[int, int]:
        docs = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
            },
        ).scalar_one()
        stats = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
            },
        ).scalar_one()
        return int(docs), int(stats)

    def _delete_docs_batch(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
        active_version: int,
        building_version: int,
    ) -> int:
        """Delete up to batch_size docs with SKIP LOCKED. Never active/building."""
        if index_version in {active_version, building_version} or index_version <= 0:
            return 0
        result = session.execute(
            text(
                """
                WITH doomed AS (
                    SELECT ctid
                    FROM app.one_c_catalog_search_documents
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                      AND index_version = :index_version
                      AND index_version IS DISTINCT FROM :active_version
                      AND index_version IS DISTINCT FROM :building_version
                    FOR UPDATE SKIP LOCKED
                    LIMIT :batch_size
                )
                DELETE FROM app.one_c_catalog_search_documents d
                USING doomed
                WHERE d.ctid = doomed.ctid
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "active_version": active_version,
                "building_version": building_version,
                "batch_size": self._batch_size,
            },
        )
        return int(result.rowcount or 0)

    def _delete_stats_batch(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
        active_version: int,
        building_version: int,
    ) -> int:
        if index_version in {active_version, building_version} or index_version <= 0:
            return 0
        result = session.execute(
            text(
                """
                WITH doomed AS (
                    SELECT ctid
                    FROM app.one_c_catalog_search_token_stats
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                      AND index_version = :index_version
                      AND index_version IS DISTINCT FROM :active_version
                      AND index_version IS DISTINCT FROM :building_version
                    FOR UPDATE SKIP LOCKED
                    LIMIT :batch_size
                )
                DELETE FROM app.one_c_catalog_search_token_stats s
                USING doomed
                WHERE s.ctid = doomed.ctid
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "active_version": active_version,
                "building_version": building_version,
                "batch_size": self._batch_size,
            },
        )
        return int(result.rowcount or 0)

    def _clear_previous_pointer(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        previous_version: int,
    ) -> None:
        session.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET previous_index_version = 0,
                    previous_cleanup_after = NULL,
                    updated_at = :updated_at
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND previous_index_version = :previous_version
                  AND previous_index_version IS DISTINCT FROM active_index_version
                  AND previous_index_version IS DISTINCT FROM building_index_version
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "previous_version": previous_version,
                "updated_at": _now(),
            },
        )

    def run_once(self, session) -> CleanupRunReport:
        """Single cleanup pass. Fail-closed when disabled or dry_run."""
        report = CleanupRunReport(ok=True, outcome="disabled", dry_run=self._dry_run)
        if not self._enabled:
            return report
        if session.get_bind().dialect.name != "postgresql":
            report.outcome = "disabled"
            return report

        CLEANUP_METRICS["cleanup_runs_total"] += 1
        locked = False
        errors = 0
        started = time.perf_counter()
        try:
            if not self._try_lock(session):
                report.outcome = "lock_skipped"
                CLEANUP_METRICS["cleanup_lock_skipped_total"] += 1
                return report
            locked = True
            self._apply_timeouts(session)

            candidates = self.list_cleanup_candidates(session)
            report.scopes_considered = len(candidates)
            if self._dry_run:
                CLEANUP_METRICS["cleanup_dry_run_total"] += 1
                # Count only — no DELETE.
                for cand in candidates:
                    docs, stats = self._count_version_rows(
                        session,
                        source_base=str(cand["source_base"]),
                        catalog_type=str(cand["catalog_type"]),
                        index_version=int(cand["previous_index_version"]),
                    )
                    report.documents_deleted += docs
                    report.token_stats_deleted += stats
                report.outcome = "dry_run"
                report.metrics = dict(CLEANUP_METRICS)
                logger.info(
                    "1C compact previous cleanup dry_run scopes=%s docs=%s stats=%s",
                    report.scopes_considered,
                    report.documents_deleted,
                    report.token_stats_deleted,
                )
                return report

            for cand in candidates:
                if report.batches >= self._max_batches:
                    break
                if (
                    self._max_runtime_seconds > 0
                    and (time.perf_counter() - started) >= self._max_runtime_seconds
                ):
                    break
                source_base = str(cand["source_base"])
                catalog_type = str(cand["catalog_type"])
                prev = int(cand["previous_index_version"])
                active = int(cand["active_index_version"])
                building = int(cand["building_index_version"])
                if prev <= 0 or prev in {active, building}:
                    continue

                # Drain docs then stats in short transactions (caller may commit).
                while report.batches < self._max_batches:
                    if (
                        self._max_runtime_seconds > 0
                        and (time.perf_counter() - started)
                        >= self._max_runtime_seconds
                    ):
                        break
                    try:
                        self._apply_timeouts(session)
                        deleted_docs = self._delete_docs_batch(
                            session,
                            source_base=source_base,
                            catalog_type=catalog_type,
                            index_version=prev,
                            active_version=active,
                            building_version=building,
                        )
                        report.documents_deleted += deleted_docs
                        CLEANUP_METRICS["cleanup_docs_deleted_total"] += deleted_docs
                        report.batches += 1
                        CLEANUP_METRICS["cleanup_batches_total"] += 1
                        session.flush()
                        if deleted_docs == 0:
                            break
                        if self._pause_ms > 0:
                            time.sleep(self._pause_ms / 1000.0)
                    except Exception as exc:
                        errors += 1
                        CLEANUP_METRICS["cleanup_errors_total"] += 1
                        logger.warning(
                            "1C compact previous cleanup docs batch failed "
                            "err_type=%s",
                            type(exc).__name__,
                        )
                        try:
                            session.rollback()
                        except Exception:
                            pass
                        if errors >= self._error_budget:
                            report.outcome = "aborted"
                            report.error = "error_budget"
                            CLEANUP_METRICS["cleanup_aborted_budget_total"] += 1
                            report.ok = False
                            report.metrics = dict(CLEANUP_METRICS)
                            return report
                        break

                while report.batches < self._max_batches:
                    if (
                        self._max_runtime_seconds > 0
                        and (time.perf_counter() - started)
                        >= self._max_runtime_seconds
                    ):
                        break
                    try:
                        self._apply_timeouts(session)
                        deleted_stats = self._delete_stats_batch(
                            session,
                            source_base=source_base,
                            catalog_type=catalog_type,
                            index_version=prev,
                            active_version=active,
                            building_version=building,
                        )
                        report.token_stats_deleted += deleted_stats
                        CLEANUP_METRICS["cleanup_stats_deleted_total"] += deleted_stats
                        report.batches += 1
                        CLEANUP_METRICS["cleanup_batches_total"] += 1
                        session.flush()
                        if deleted_stats == 0:
                            break
                        if self._pause_ms > 0:
                            time.sleep(self._pause_ms / 1000.0)
                    except Exception as exc:
                        errors += 1
                        CLEANUP_METRICS["cleanup_errors_total"] += 1
                        logger.warning(
                            "1C compact previous cleanup stats batch failed "
                            "err_type=%s",
                            type(exc).__name__,
                        )
                        try:
                            session.rollback()
                        except Exception:
                            pass
                        if errors >= self._error_budget:
                            report.outcome = "aborted"
                            report.error = "error_budget"
                            CLEANUP_METRICS["cleanup_aborted_budget_total"] += 1
                            report.ok = False
                            report.metrics = dict(CLEANUP_METRICS)
                            return report
                        break

                docs_left, stats_left = self._count_version_rows(
                    session,
                    source_base=source_base,
                    catalog_type=catalog_type,
                    index_version=prev,
                )
                if docs_left == 0 and stats_left == 0:
                    self._clear_previous_pointer(
                        session,
                        source_base=source_base,
                        catalog_type=catalog_type,
                        previous_version=prev,
                    )

            report.outcome = "cleaned"
            report.metrics = dict(CLEANUP_METRICS)
            return report
        except Exception as exc:
            report.ok = False
            report.outcome = "failed"
            report.error = type(exc).__name__
            CLEANUP_METRICS["cleanup_errors_total"] += 1
            logger.warning(
                "1C compact previous cleanup failed err_type=%s",
                type(exc).__name__,
            )
            try:
                session.rollback()
            except Exception:
                pass
            report.metrics = dict(CLEANUP_METRICS)
            return report
        finally:
            if locked:
                self._unlock(session)
