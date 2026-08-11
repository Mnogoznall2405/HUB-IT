"""Versioned compact search rebuild for 4h sync lifecycle.

Lifecycle after a changed catalogue sync:
  fingerprint → no_op | build-next → validate → atomic switch → delayed cleanup

Readers always use ``active_index_version`` while the next version builds.
On failure the previous ready version keeps serving. Parallel rebuilds are
blocked by a PostgreSQL advisory lock.

Memory safety (critical at ~700k rows):
- fingerprint hashes per-row digests (never string_agg of full names)
- documents built via chunked SQL INSERT…SELECT (keyset pages), not full
  Python materialization of the catalogue
- token_stats via set-based SQL; one rebuild at a time (advisory lock)
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from backend.services.one_c_catalog_compact_flags import get_compact_flags
from backend.services.one_c_catalog_compact_search import STATUS_READY
from backend.services.one_c_catalog_compact_writer import (
    STATUS_BUILDING,
    STATUS_FAILED,
    TOKEN_STATS_REBUILD_METRICS,
    OneCCatalogCompactWriter,
)


logger = logging.getLogger(__name__)

# Dedicated lock — distinct from backfill ADVISORY_LOCK_KEY (0x1CC0BF11).
REBUILD_ADVISORY_LOCK_KEY = 0x1CC0BF12

STATUS_STALE = "stale"
DEFAULT_CLEANUP_GRACE_SECONDS = 3600
DEFAULT_DOC_BATCH = 5_000
# Suggest/typo token_stats: drop once-only noise. Search documents keep all tokens.
DEFAULT_TOKEN_STATS_MIN_FREQUENCY = 2
DEFAULT_TOKEN_STATS_MAX_TOKEN_LEN = 64
# Soft RSS ceiling for the rebuild process (bytes). Override via env.
DEFAULT_MAX_RSS_BYTES = int(
    os.getenv("WAREHOUSE_1C_CATALOG_COMPACT_REBUILD_MAX_RSS_BYTES", str(2_500_000_000))
)

VERSIONED_REBUILD_METRICS: dict[str, float] = {
    "rebuild_total": 0,
    "rebuild_no_op_total": 0,
    "rebuild_success_total": 0,
    "rebuild_failed_total": 0,
    "rebuild_lock_skipped_total": 0,
    "rebuild_duration_ms": 0.0,
    "atomic_switch_total": 0,
    "rollback_total": 0,
    "cleanup_total": 0,
}


@dataclass
class VersionedRebuildReport:
    ok: bool
    outcome: str  # no_op | built | lock_skipped | failed | disabled | oom
    source_base: str = ""
    catalog_type: str = ""
    generation: int = 0
    active_index_version: int = 0
    built_index_version: int = 0
    previous_index_version: int = 0
    fingerprint: str = ""
    previous_fingerprint: str = ""
    documents_built: int = 0
    token_stats_rows: int = 0
    expected_count: int = 0
    validation_ok: bool = False
    duration_ms: float = 0.0
    fingerprint_ms: float = 0.0
    build_ms: float = 0.0
    token_stats_ms: float = 0.0
    validate_ms: float = 0.0
    switch_ms: float = 0.0
    peak_rss_bytes: int = 0
    error: str = ""
    metrics: dict[str, float] = field(default_factory=dict)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(value: Any, *, maximum: int | None = None) -> str:
    text_value = str(value or "").strip()
    return text_value[:maximum] if maximum is not None else text_value


def _process_rss_bytes() -> int:
    """Best-effort current process RSS; 0 if unavailable."""
    try:
        import psutil  # type: ignore

        return int(psutil.Process(os.getpid()).memory_info().rss)
    except Exception:
        pass
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            GetCurrentProcess = ctypes.windll.kernel32.GetCurrentProcess
            GetProcessMemoryInfo = ctypes.windll.psapi.GetProcessMemoryInfo
            counters = PROCESS_MEMORY_COUNTERS()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
            if GetProcessMemoryInfo(GetCurrentProcess(), ctypes.byref(counters), counters.cb):
                return int(counters.WorkingSetSize)
        except Exception:
            return 0
    return 0


class MemoryBudgetExceeded(RuntimeError):
    """Raised when rebuild RSS exceeds the configured soft ceiling."""


class OneCCatalogCompactVersionedRebuild:
    """Build-next / validate / atomic-switch orchestrator for compact search."""

    def __init__(
        self,
        *,
        enabled: bool | None = None,
        min_token_frequency: int = DEFAULT_TOKEN_STATS_MIN_FREQUENCY,
        max_token_len: int = DEFAULT_TOKEN_STATS_MAX_TOKEN_LEN,
        cleanup_grace_seconds: int = DEFAULT_CLEANUP_GRACE_SECONDS,
        doc_batch_size: int = DEFAULT_DOC_BATCH,
        max_rss_bytes: int = DEFAULT_MAX_RSS_BYTES,
        writer: OneCCatalogCompactWriter | None = None,
    ) -> None:
        flags = get_compact_flags()
        self._enabled = flags.write_compact if enabled is None else bool(enabled)
        self._min_token_frequency = max(1, int(min_token_frequency))
        self._max_token_len = max(8, int(max_token_len))
        self._cleanup_grace_seconds = max(0, int(cleanup_grace_seconds))
        self._doc_batch_size = max(100, min(int(doc_batch_size), 20_000))
        self._max_rss_bytes = max(0, int(max_rss_bytes))
        self._peak_rss_bytes = 0
        self._writer = writer or OneCCatalogCompactWriter(enabled=True)

    def _check_rss(self, *, stage: str) -> None:
        rss = _process_rss_bytes()
        if rss > self._peak_rss_bytes:
            self._peak_rss_bytes = rss
        if self._max_rss_bytes > 0 and rss >= self._max_rss_bytes:
            raise MemoryBudgetExceeded(
                f"rebuild_rss_exceeded stage={stage} rss={rss} max={self._max_rss_bytes}"
            )

    @property
    def enabled(self) -> bool:
        return self._enabled

    def compute_source_fingerprint(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
    ) -> tuple[str, int, float]:
        """Return (fingerprint, entry_count, duration_ms) for current entries.

        Memory-safe: aggregates **per-row md5 digests** (32 hex chars each),
        never ``string_agg`` of full code/name payloads (that OOMed at ~718k).
        """
        started = time.perf_counter()
        self._check_rss(stage="fingerprint_start")
        row = session.execute(
            text(
                """
                SELECT
                    COUNT(*)::integer AS entry_count,
                    md5(
                        COALESCE(
                            string_agg(
                                md5(
                                    ref || E'\\x1f'
                                    || coalesce(code, '') || E'\\x1f'
                                    || coalesce(name, '')
                                ),
                                ''
                                ORDER BY ref COLLATE "C"
                            ),
                            ''
                        )
                    ) AS fingerprint
                FROM app.one_c_catalog_entries
                WHERE source_base = :source_base
                  AND generation = :generation
                  AND catalog_type = :catalog_type
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
            },
        ).mappings().one()
        fingerprint = str(row["fingerprint"] or "")
        duration_ms = (time.perf_counter() - started) * 1000.0
        self._check_rss(stage="fingerprint_done")
        return fingerprint, int(row["entry_count"] or 0), duration_ms

    def _try_lock(self, session) -> bool:
        row = session.execute(
            text(f"SELECT pg_try_advisory_lock({int(REBUILD_ADVISORY_LOCK_KEY)})")
        ).scalar_one()
        return bool(row)

    def _unlock(self, session) -> None:
        try:
            session.execute(
                text(f"SELECT pg_advisory_unlock({int(REBUILD_ADVISORY_LOCK_KEY)})")
            )
        except Exception:
            logger.warning(
                "1C compact rebuild unlock failed err_type=UnlockError",
            )

    def _ensure_state_row(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
    ) -> dict[str, Any]:
        now = _now()
        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_search_index_state AS s (
                    source_base, catalog_type, generation, status,
                    expected_count, indexed_count, build_version, checksum,
                    last_error, started_at, finished_at, updated_at,
                    checkpoint_ref, checkpoint_offset,
                    active_index_version, building_index_version,
                    previous_index_version, source_fingerprint, previous_cleanup_after
                ) VALUES (
                    :source_base, :catalog_type, :generation, 'building',
                    0, 0, 0, '',
                    '', NULL, NULL, :updated_at,
                    '', 0,
                    0, 0, 0, '', NULL
                )
                ON CONFLICT (source_base, catalog_type) DO NOTHING
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "updated_at": now,
            },
        )
        row = session.execute(
            text(
                """
                SELECT
                    status, generation, expected_count, indexed_count,
                    build_version, checksum,
                    coalesce(active_index_version, 0) AS active_index_version,
                    coalesce(building_index_version, 0) AS building_index_version,
                    coalesce(previous_index_version, 0) AS previous_index_version,
                    coalesce(source_fingerprint, '') AS source_fingerprint
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {"source_base": source_base, "catalog_type": catalog_type},
        ).mappings().one()
        return dict(row)

    def rebuild_after_sync(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        expected_count: int | None = None,
        force: bool = False,
        inject_fail_before_switch: bool = False,
    ) -> VersionedRebuildReport:
        """Fingerprint → no_op or versioned rebuild with atomic switch.

        Safe to call once after a completed sync scope. Never clears the active
        version before the next build validates.
        """
        report = VersionedRebuildReport(
            ok=False,
            outcome="disabled",
            source_base=source_base,
            catalog_type=catalog_type,
            generation=generation,
        )
        if not self._enabled:
            report.ok = True
            return report
        if session.get_bind().dialect.name != "postgresql":
            report.ok = True
            report.outcome = "non_postgresql"
            return report

        started = time.perf_counter()
        locked = False
        try:
            if not self._try_lock(session):
                VERSIONED_REBUILD_METRICS["rebuild_lock_skipped_total"] += 1
                report.outcome = "lock_skipped"
                report.error = "advisory_lock_busy"
                return report
            locked = True
            VERSIONED_REBUILD_METRICS["rebuild_total"] += 1

            state = self._ensure_state_row(
                session,
                source_base=source_base,
                catalog_type=catalog_type,
                generation=generation,
            )
            active_version = int(state.get("active_index_version") or 0)
            report.active_index_version = active_version
            report.previous_fingerprint = str(state.get("source_fingerprint") or "")

            fingerprint, entry_count, fingerprint_ms = self.compute_source_fingerprint(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
            )
            report.fingerprint = fingerprint
            report.fingerprint_ms = fingerprint_ms
            report.expected_count = (
                int(expected_count) if expected_count is not None else entry_count
            )

            if (
                not force
                and str(state.get("status") or "") == STATUS_READY
                and active_version > 0
                and report.previous_fingerprint
                and report.previous_fingerprint == fingerprint
                and int(state.get("indexed_count") or 0) == int(state.get("expected_count") or 0)
            ):
                VERSIONED_REBUILD_METRICS["rebuild_no_op_total"] += 1
                report.ok = True
                report.outcome = "no_op"
                report.validation_ok = True
                report.duration_ms = (time.perf_counter() - started) * 1000.0
                return report

            next_version = max(active_version, int(state.get("building_index_version") or 0)) + 1
            if next_version <= 0:
                next_version = 1
            report.built_index_version = next_version

            now = _now()
            session.execute(
                text(
                    """
                    UPDATE app.one_c_catalog_search_index_state
                    SET generation = :generation,
                        status = :status,
                        building_index_version = :building_version,
                        last_error = '',
                        started_at = :started_at,
                        updated_at = :updated_at,
                        expected_count = :expected_count
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                    """
                ),
                {
                    "source_base": source_base,
                    "catalog_type": catalog_type,
                    "generation": generation,
                    "status": STATUS_BUILDING,
                    "building_version": next_version,
                    "started_at": now,
                    "updated_at": now,
                    "expected_count": report.expected_count,
                },
            )
            # Keep active ready for readers: do not flip status away from ready
            # on the active pointer — building_index_version is the signal.
            # Readers gate on status=ready AND active_index_version.
            if active_version > 0 and str(state.get("status") or "") == STATUS_READY:
                session.execute(
                    text(
                        """
                        UPDATE app.one_c_catalog_search_index_state
                        SET status = :status
                        WHERE source_base = :source_base
                          AND catalog_type = :catalog_type
                        """
                    ),
                    {
                        "source_base": source_base,
                        "catalog_type": catalog_type,
                        "status": STATUS_READY,
                    },
                )

            build_started = time.perf_counter()
            documents_built = self._build_documents_version(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=next_version,
            )
            report.documents_built = documents_built
            report.build_ms = (time.perf_counter() - build_started) * 1000.0

            stats_started = time.perf_counter()
            stats_rows = self._rebuild_token_stats_version(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=next_version,
            )
            report.token_stats_rows = stats_rows
            report.token_stats_ms = (time.perf_counter() - stats_started) * 1000.0

            validate_started = time.perf_counter()
            validation_ok, validation_error = self._validate_version(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=next_version,
                expected_count=report.expected_count,
            )
            report.validate_ms = (time.perf_counter() - validate_started) * 1000.0
            report.validation_ok = validation_ok

            if inject_fail_before_switch:
                validation_ok = False
                validation_error = "injected_fail_before_switch"

            if not validation_ok:
                self._mark_build_failed(
                    session,
                    source_base=source_base,
                    catalog_type=catalog_type,
                    generation=generation,
                    active_version=active_version,
                    error=validation_error or "validation_failed",
                )
                # Drop incomplete building version data.
                self._delete_version(
                    session,
                    source_base=source_base,
                    catalog_type=catalog_type,
                    index_version=next_version,
                )
                VERSIONED_REBUILD_METRICS["rebuild_failed_total"] += 1
                VERSIONED_REBUILD_METRICS["rollback_total"] += 1
                report.outcome = "failed"
                report.error = validation_error or "validation_failed"
                report.duration_ms = (time.perf_counter() - started) * 1000.0
                return report

            switch_started = time.perf_counter()
            self._atomic_switch(
                session,
                source_base=source_base,
                catalog_type=catalog_type,
                generation=generation,
                new_version=next_version,
                previous_version=active_version,
                expected_count=report.expected_count,
                indexed_count=documents_built,
                fingerprint=fingerprint,
            )
            report.switch_ms = (time.perf_counter() - switch_started) * 1000.0
            report.previous_index_version = active_version
            report.active_index_version = next_version
            VERSIONED_REBUILD_METRICS["atomic_switch_total"] += 1
            VERSIONED_REBUILD_METRICS["rebuild_success_total"] += 1

            if active_version > 0 and active_version != next_version:
                # Old version remains readable until grace cleanup.
                pass

            report.ok = True
            report.outcome = "built"
            report.duration_ms = (time.perf_counter() - started) * 1000.0
            VERSIONED_REBUILD_METRICS["rebuild_duration_ms"] = report.duration_ms
            logger.info(
                "1C compact versioned rebuild ok catalog_type=%s version=%s docs=%s "
                "stats=%s duration_ms=%.1f",
                catalog_type,
                next_version,
                documents_built,
                stats_rows,
                report.duration_ms,
            )
            return report
        except MemoryBudgetExceeded as exc:
            VERSIONED_REBUILD_METRICS["rebuild_failed_total"] += 1
            report.outcome = "oom"
            report.error = str(exc)[:500]
            report.duration_ms = (time.perf_counter() - started) * 1000.0
            logger.error(
                "1C compact versioned rebuild aborted for memory catalog_type=%s peak_rss=%s",
                catalog_type,
                self._peak_rss_bytes,
            )
            try:
                session.rollback()
            except Exception:
                pass
            try:
                self._mark_build_failed(
                    session,
                    source_base=source_base,
                    catalog_type=catalog_type,
                    generation=generation,
                    active_version=int(report.active_index_version or 0),
                    error="memory_budget_exceeded",
                )
            except Exception:
                try:
                    session.rollback()
                except Exception:
                    pass
            return report
        except Exception as exc:
            VERSIONED_REBUILD_METRICS["rebuild_failed_total"] += 1
            report.outcome = "failed"
            report.error = f"{type(exc).__name__}:{str(exc)[:300]}"
            report.duration_ms = (time.perf_counter() - started) * 1000.0
            logger.warning(
                "1C compact versioned rebuild failed catalog_type=%s err_type=%s detail=%s",
                catalog_type,
                type(exc).__name__,
                str(exc)[:200],
            )
            try:
                session.rollback()
            except Exception:
                pass
            try:
                self._mark_build_failed(
                    session,
                    source_base=source_base,
                    catalog_type=catalog_type,
                    generation=generation,
                    active_version=int(report.active_index_version or 0),
                    error=type(exc).__name__,
                )
            except Exception:
                try:
                    session.rollback()
                except Exception:
                    pass
            return report
        finally:
            report.peak_rss_bytes = int(self._peak_rss_bytes or _process_rss_bytes())
            if locked:
                self._unlock(session)
            report.metrics = dict(VERSIONED_REBUILD_METRICS)

    def cleanup_previous_versions(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        force: bool = False,
    ) -> int:
        """Delete previous index versions past grace period. Never deletes active."""
        if session.get_bind().dialect.name != "postgresql":
            return 0
        row = session.execute(
            text(
                """
                SELECT
                    coalesce(active_index_version, 0) AS active_index_version,
                    coalesce(previous_index_version, 0) AS previous_index_version,
                    previous_cleanup_after
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {"source_base": source_base, "catalog_type": catalog_type},
        ).mappings().first()
        if row is None:
            return 0
        active = int(row["active_index_version"] or 0)
        previous = int(row["previous_index_version"] or 0)
        cleanup_after = row["previous_cleanup_after"]
        if previous <= 0 or previous == active:
            return 0
        if not force:
            if cleanup_after is None:
                return 0
            cutoff = cleanup_after
            if cutoff.tzinfo is None:
                cutoff = cutoff.replace(tzinfo=timezone.utc)
            if _now() < cutoff:
                return 0
        deleted = self._delete_version(
            session,
            source_base=source_base,
            catalog_type=catalog_type,
            index_version=previous,
        )
        session.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET previous_index_version = 0,
                    previous_cleanup_after = NULL,
                    updated_at = :updated_at
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "updated_at": _now(),
            },
        )
        VERSIONED_REBUILD_METRICS["cleanup_total"] += 1
        return deleted

    def _build_documents_version(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
    ) -> int:
        """Chunked SQL INSERT…SELECT — never materialize the full catalogue in Python.

        Prefers token rows from ``one_c_catalog_tokens`` (same tokens as the
        legacy engine). When tokens are absent (synthetic benches), falls back
        to ``code_normalized || name_normalized`` only.
        """
        # Clear only the *next* version namespace (never active).
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_documents
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
        )
        session.flush()
        self._check_rss(stage="docs_after_delete")

        built = 0
        last_ref = ""
        # Keyset pagination keeps each statement bounded.
        insert_sql = text(
            """
            INSERT INTO app.one_c_catalog_search_documents (
                source_base, generation, catalog_type, index_version, entry_ref,
                code_normalized, name_normalized, search_text, search_tsv,
                created_at, updated_at
            )
            SELECT
                src.source_base,
                src.generation,
                src.catalog_type,
                :index_version,
                src.ref,
                src.code_normalized,
                src.name_normalized,
                src.search_text,
                to_tsvector('simple', src.tsv_source),
                NOW(),
                NOW()
            FROM (
                SELECT
                    e.source_base,
                    e.generation,
                    e.catalog_type,
                    e.ref,
                    coalesce(e.code_normalized, '') AS code_normalized,
                    coalesce(e.name_normalized, '') AS name_normalized,
                    trim(both FROM concat_ws(
                        ' ',
                        NULLIF(coalesce(e.code_normalized, ''), ''),
                        NULLIF(coalesce(e.name_normalized, ''), ''),
                        NULLIF(coalesce(tok.tokens_text, ''), ''),
                        NULLIF(coalesce(models.compact_models, ''), '')
                    )) AS search_text,
                    -- Prefer dual-write tokens; always append SQL compact models
                    -- (m-70 / m 70 → m70) so benches without tokens keep FN=0.
                    trim(both FROM concat_ws(
                        ' ',
                        NULLIF(coalesce(tok.tokens_text, ''), ''),
                        NULLIF(coalesce(e.code_normalized, ''), ''),
                        NULLIF(coalesce(e.name_normalized, ''), ''),
                        NULLIF(coalesce(models.compact_models, ''), '')
                    )) AS tsv_source
                FROM app.one_c_catalog_entries e
                LEFT JOIN LATERAL (
                    SELECT string_agg(t.token, ' ' ORDER BY t.token) AS tokens_text
                    FROM app.one_c_catalog_tokens t
                    WHERE t.source_base = e.source_base
                      AND t.generation = e.generation
                      AND t.catalog_type = e.catalog_type
                      AND t.entry_ref = e.ref
                ) tok ON TRUE
                LEFT JOIN LATERAL (
                    SELECT string_agg(DISTINCT compact_tok, ' ') AS compact_models
                    FROM (
                        SELECT lower(
                            regexp_replace(
                                replace(raw_tok, 'ё', 'е'),
                                '[^0-9a-zа-я]+',
                                '',
                                'g'
                            )
                        ) AS compact_tok
                        FROM (
                            SELECT coalesce(m[1], m[2], m[3]) AS raw_tok
                            FROM regexp_matches(
                                -- Pad edges so spaced models need real boundaries
                                -- (avoids matching "а 70" inside "елка 70").
                                ' ' || lower(replace(
                                    coalesce(e.code, '') || ' ' || coalesce(e.name, ''),
                                    'ё',
                                    'е'
                                )) || ' ',
                                '([0-9a-zа-яё]+(?:[-_./\\\\]+[0-9a-zа-яё]+)+)'
                                || '|[^0-9a-zа-яё]([a-zа-яё][[:space:]]+[0-9][0-9a-zа-яё]*)[^0-9a-zа-яё]'
                                || '|[^0-9a-zа-яё]([0-9]+[[:space:]]+[a-zа-яё][0-9a-zа-яё]*)[^0-9a-zа-яё]',
                                'g'
                            ) AS m
                        ) matches
                        WHERE raw_tok IS NOT NULL
                    ) extracted
                    WHERE length(compact_tok) BETWEEN 2 AND 200
                      AND compact_tok ~ '[a-zа-я]'
                      AND compact_tok ~ '[0-9]'
                ) models ON TRUE
                WHERE e.source_base = :source_base
                  AND e.generation = :generation
                  AND e.catalog_type = :catalog_type
                  AND e.ref COLLATE "C" > :last_ref
                ORDER BY e.ref COLLATE "C"
                LIMIT :batch_size
            ) src
            RETURNING entry_ref
            """
        )
        while True:
            self._check_rss(stage="docs_batch")
            rows = session.execute(
                insert_sql,
                {
                    "source_base": source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                    "index_version": index_version,
                    "last_ref": last_ref,
                    "batch_size": self._doc_batch_size,
                },
            ).fetchall()
            if not rows:
                break
            built += len(rows)
            last_ref = str(rows[-1][0])
            # Release per-batch objects; keep transaction open for rebuild atomicity
            # of the building version, but avoid holding result proxies.
            del rows
            if built % (self._doc_batch_size * 10) == 0:
                session.flush()
                logger.info(
                    "1C compact docs build progress catalog_type=%s version=%s built=%s peak_rss=%s",
                    catalog_type,
                    index_version,
                    built,
                    self._peak_rss_bytes,
                )
        return built

    def _rebuild_token_stats_version(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
    ) -> int:
        """Rebuild suggest/typo stats for one version; exclude rare/junk tokens."""
        started = time.perf_counter()
        now = _now()
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_token_stats
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
        )
        result = session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_search_token_stats (
                    source_base, generation, catalog_type, index_version,
                    token, frequency, updated_at
                )
                SELECT
                    :source_base,
                    :generation,
                    :catalog_type,
                    :index_version,
                    token,
                    frequency,
                    :updated_at
                FROM (
                    SELECT
                        exploded.token,
                        COUNT(*)::integer AS frequency
                    FROM (
                        SELECT DISTINCT d.entry_ref, trim(both FROM u.token) AS token
                        FROM app.one_c_catalog_search_documents d
                        CROSS JOIN LATERAL unnest(string_to_array(d.search_text, ' '))
                            AS u(token)
                        WHERE d.source_base = :source_base
                          AND d.catalog_type = :catalog_type
                          AND d.index_version = :index_version
                          AND length(trim(both FROM u.token)) >= 2
                          AND length(trim(both FROM u.token)) <= :max_token_len
                          AND trim(both FROM u.token) !~ '^[0-9a-f]{32,}$'
                          AND trim(both FROM u.token) !~ '^[0-9]{12,}$'
                    ) exploded
                    GROUP BY exploded.token
                ) aggregated
                WHERE frequency >= :min_frequency
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "updated_at": now,
                "min_frequency": self._min_token_frequency,
                "max_token_len": self._max_token_len,
            },
        )
        rows = int(result.rowcount or 0)
        duration_ms = (time.perf_counter() - started) * 1000.0
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"] += 1
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_duration_ms"] = duration_ms
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_rows"] = float(rows)
        self._writer.metrics["token_stats_rebuilds"] += 1
        self._writer.metrics["token_stats_rebuild_total"] += 1
        self._writer.metrics["token_stats_rebuild_duration_ms"] = duration_ms
        self._writer.metrics["token_stats_rebuild_rows"] = rows
        return rows

    def _validate_version(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        expected_count: int,
    ) -> tuple[bool, str]:
        indexed = session.execute(
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
        if int(indexed) != int(expected_count):
            return False, f"count_mismatch:{indexed}!={expected_count}"
        # Incomplete build guard: every document must have non-empty search_text.
        empty = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND (search_text = '' OR search_tsv IS NULL)
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
            },
        ).scalar_one()
        if int(empty) > 0:
            return False, f"incomplete_documents:{empty}"
        # Generation consistency with catalogue.
        bad_gen = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND generation <> :generation
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "generation": generation,
            },
        ).scalar_one()
        if int(bad_gen) > 0:
            return False, f"generation_mismatch:{bad_gen}"
        return True, ""

    def _atomic_switch(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        new_version: int,
        previous_version: int,
        expected_count: int,
        indexed_count: int,
        fingerprint: str,
    ) -> None:
        now = _now()
        cleanup_after = now + timedelta(seconds=self._cleanup_grace_seconds)
        session.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET generation = :generation,
                    status = :status,
                    expected_count = :expected_count,
                    indexed_count = :indexed_count,
                    build_version = build_version + 1,
                    checksum = :checksum,
                    source_fingerprint = :fingerprint,
                    active_index_version = :new_version,
                    previous_index_version = CASE
                        WHEN :previous_version > 0 AND :previous_version <> :new_version
                        THEN :previous_version ELSE previous_index_version END,
                    building_index_version = 0,
                    previous_cleanup_after = CASE
                        WHEN :previous_version > 0 AND :previous_version <> :new_version
                        THEN :cleanup_after ELSE previous_cleanup_after END,
                    last_error = '',
                    finished_at = :finished_at,
                    updated_at = :updated_at
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "status": STATUS_READY,
                "expected_count": int(expected_count),
                "indexed_count": int(indexed_count),
                "checksum": _text(fingerprint, maximum=64),
                "fingerprint": _text(fingerprint, maximum=64),
                "new_version": int(new_version),
                "previous_version": int(previous_version),
                "cleanup_after": cleanup_after,
                "finished_at": now,
                "updated_at": now,
            },
        )

    def _mark_build_failed(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        active_version: int,
        error: str,
    ) -> None:
        now = _now()
        # Preserve ready status when an active version still serves.
        status = STATUS_READY if active_version > 0 else STATUS_FAILED
        session.execute(
            text(
                """
                UPDATE app.one_c_catalog_search_index_state
                SET generation = :generation,
                    status = :status,
                    building_index_version = 0,
                    last_error = :last_error,
                    finished_at = :finished_at,
                    updated_at = :updated_at
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "status": status,
                "last_error": _text(error, maximum=2_000),
                "finished_at": now,
                "updated_at": now,
            },
        )

    def _delete_version(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
    ) -> int:
        docs = session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_documents
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
        )
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_token_stats
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
        )
        return int(docs.rowcount or 0)


def schedule_versioned_rebuild_after_sync(
    session,
    *,
    source_base: str,
    generation: int,
    catalog_type: str,
    expected_count: int,
    enabled: bool | None = None,
) -> VersionedRebuildReport:
    """Entry point used by snapshot dual-write after a completed sync scope."""
    orchestrator = OneCCatalogCompactVersionedRebuild(enabled=enabled)
    return orchestrator.rebuild_after_sync(
        session,
        source_base=source_base,
        generation=generation,
        catalog_type=catalog_type,
        expected_count=expected_count,
    )
