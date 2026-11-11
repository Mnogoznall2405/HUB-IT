"""Dual-write helpers for compact search documents + token_stats.

When ``WAREHOUSE_1C_CATALOG_WRITE_COMPACT=1``, catalogue snapshot writers also
maintain derived compact tables.  Compact write errors must never corrupt the
primary entry/token catalogue transaction — callers isolate failures.

Steady-state path: incremental patch of the *active* index_version using the
same added/changed/removed refs already computed by legacy
``_update_catalog_in_place``. Versioned full rebuild is reserved for
initial/backfill/migration/desync/mass-change recovery.

Ordinary incremental patches never sync-delete a previous index_version;
they schedule deferred cleanup (``previous_cleanup_after``). Ordering is
enforced by CAS on ``base_fingerprint → target_fingerprint`` + ``sync_id``.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import text

from backend.services.one_c_catalog_compact_docs import build_search_document_fields
from backend.services.one_c_catalog_compact_flags import get_compact_flags
from backend.services.one_c_catalog_compact_search import STATUS_READY


logger = logging.getLogger(__name__)

STATUS_BUILDING = "building"
STATUS_FAILED = "failed"
STATUS_STALE = "stale"

# Distinct from backfill (0x1CC0BF11), versioned rebuild (0x1CC0BF12),
# and previous-version cleanup (0x1CC0BF14).
INCREMENTAL_ADVISORY_LOCK_KEY = 0x1CC0BF13

# Default grace before deferred previous-version cleanup may run.
DEFAULT_PREVIOUS_CLEANUP_GRACE_SECONDS = 3600

# Process-wide observability (no PII).
TOKEN_STATS_REBUILD_METRICS: dict[str, float] = {
    "token_stats_rebuild_total": 0,
    "token_stats_rebuild_duration_ms": 0.0,
    "token_stats_rebuild_rows": 0,
    "token_stats_delta_total": 0,
    "token_stats_delta_duration_ms": 0.0,
    "incremental_patch_total": 0,
    "incremental_patch_noop_total": 0,
    "incremental_patch_out_of_order_total": 0,
    "incremental_threshold_escalations": 0,
    "documents_touched_total": 0,
    "previous_cleanup_scheduled_total": 0,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(value: Any, *, maximum: int | None = None) -> str:
    text_value = str(value or "").strip()
    return text_value[:maximum] if maximum is not None else text_value


@dataclass(frozen=True)
class CompactCatalogPatch:
    """Minimal compact dual-write patch — no second full-catalogue compare.

    Built from legacy ``_update_catalog_in_place`` upserts/deletes (or a
    controlled reconcile/recovery path). Does not carry untouched refs.

    Ordering/idempotency: ``base_fingerprint`` (expected indexed fp) →
    ``catalog_fingerprint`` (target) + ``sync_id``. CAS rejects out-of-order
    / stale deliveries in the same compact transaction.
    """

    catalog_type: str
    upserts: tuple[tuple[str, str, str], ...] = ()
    deletes: tuple[str, ...] = ()
    expected_count: int = 0
    changed_count: int = 0
    incoming_count: int = 0
    catalog_fingerprint: str = ""
    base_fingerprint: str = ""
    sync_id: str = ""
    full_rebuild: bool = False
    force_versioned_rebuild: bool = False

    @property
    def target_fingerprint(self) -> str:
        return self.catalog_fingerprint

    @property
    def is_empty(self) -> bool:
        return not self.upserts and not self.deletes and not self.full_rebuild

    @classmethod
    def from_legacy_patch(
        cls,
        catalog_type: str,
        patch: dict[str, Any],
        *,
        catalog_fingerprint: str = "",
        sync_id: str = "",
        base_fingerprint: str = "",
    ) -> "CompactCatalogPatch":
        upserts_raw = list(patch.get("upserts") or [])
        deletes_raw = [str(r) for r in (patch.get("deletes") or []) if r]
        upserts = tuple(
            (str(ref), str(code or ""), str(name or ""))
            for ref, code, name in upserts_raw
            if ref
        )
        changed = int(
            patch.get("changed_count")
            or (len(upserts) + len(deletes_raw))
        )
        target = _text(
            catalog_fingerprint or patch.get("catalog_fingerprint") or "",
            maximum=64,
        )
        base = _text(
            base_fingerprint or patch.get("base_fingerprint") or "",
            maximum=64,
        )
        return cls(
            catalog_type=catalog_type,
            upserts=upserts,
            deletes=tuple(deletes_raw),
            expected_count=int(patch.get("expected_count") or 0),
            changed_count=changed,
            incoming_count=int(patch.get("incoming_count") or 0),
            catalog_fingerprint=target,
            base_fingerprint=base,
            sync_id=_text(sync_id or patch.get("sync_id") or "", maximum=64),
            full_rebuild=bool(patch.get("full_rebuild")),
            force_versioned_rebuild=bool(patch.get("force_versioned_rebuild")),
        )


@dataclass
class IncrementalPatchReport:
    ok: bool
    # applied | noop | out_of_order | stale | threshold | lock_skipped |
    # failed | disabled | rebuilt
    outcome: str
    catalog_type: str = ""
    documents_upserted: int = 0
    documents_deleted: int = 0
    documents_untouched_estimate: int = 0
    token_stats_mode: str = ""
    token_stats_rows: int = 0
    active_index_version: int = 0
    sync_id: str = ""
    catalog_fingerprint: str = ""
    base_fingerprint: str = ""
    error: str = ""
    metrics: dict[str, float] = field(default_factory=dict)


class OneCCatalogCompactWriter:
    """Upsert/delete compact documents and maintain token_stats for a scope."""

    def __init__(self, *, enabled: bool | None = None) -> None:
        flags = get_compact_flags()
        self._enabled = flags.write_compact if enabled is None else bool(enabled)
        self.metrics: dict[str, float] = {
            "documents_upserted": 0,
            "documents_deleted": 0,
            "documents_untouched": 0,
            "token_stats_rebuilds": 0,
            "token_stats_rebuild_total": 0,
            "token_stats_rebuild_duration_ms": 0.0,
            "token_stats_rebuild_rows": 0,
            "token_stats_delta_total": 0,
            "write_errors": 0,
            "incremental_noop": 0,
            "threshold_escalations": 0,
        }

    @property
    def enabled(self) -> bool:
        return self._enabled

    def mark_stale(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        error: str = "",
    ) -> None:
        if session.get_bind().dialect.name != "postgresql":
            return
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
                    previous_index_version, source_fingerprint,
                    previous_cleanup_after
                ) VALUES (
                    :source_base, :catalog_type, :generation, :status,
                    0, 0, 0, '',
                    :last_error, NULL, NULL, :updated_at,
                    '', 0,
                    0, 0,
                    0, '',
                    NULL
                )
                ON CONFLICT (source_base, catalog_type) DO UPDATE SET
                    generation = EXCLUDED.generation,
                    status = :status,
                    last_error = EXCLUDED.last_error,
                    updated_at = EXCLUDED.updated_at,
                    active_index_version = COALESCE(s.active_index_version, 0),
                    building_index_version = COALESCE(s.building_index_version, 0),
                    previous_index_version = COALESCE(s.previous_index_version, 0),
                    source_fingerprint = COALESCE(s.source_fingerprint, '')
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "status": STATUS_STALE,
                "last_error": _text(error, maximum=2_000),
                "updated_at": now,
            },
        )

    def _try_advisory_lock(self, session) -> bool:
        got = session.execute(
            text(f"SELECT pg_try_advisory_lock({int(INCREMENTAL_ADVISORY_LOCK_KEY)})")
        ).scalar()
        return bool(got)

    def _advisory_unlock(self, session) -> None:
        try:
            session.execute(
                text(f"SELECT pg_advisory_unlock({int(INCREMENTAL_ADVISORY_LOCK_KEY)})")
            )
        except Exception:
            pass

    def _read_active_state(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
    ) -> dict[str, Any] | None:
        row = session.execute(
            text(
                """
                SELECT status, generation, expected_count, indexed_count,
                       coalesce(active_index_version, 0) AS active_index_version,
                       coalesce(previous_index_version, 0) AS previous_index_version,
                       coalesce(source_fingerprint, '') AS source_fingerprint,
                       coalesce(checksum, '') AS checksum,
                       coalesce(checkpoint_ref, '') AS checkpoint_ref
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {"source_base": source_base, "catalog_type": catalog_type},
        ).mappings().first()
        return dict(row) if row else None

    def _threshold_exceeded(self, patch: CompactCatalogPatch) -> bool:
        flags = get_compact_flags()
        changed = max(0, int(patch.changed_count or 0))
        incoming = max(0, int(patch.incoming_count or patch.expected_count or 0))
        max_rows = int(flags.compact_incremental_max_changed_rows or 0)
        max_pct = float(flags.compact_incremental_max_changed_percent or 0.0)
        min_base = int(flags.compact_incremental_percent_min_base or 0)
        if max_rows > 0 and changed > max_rows:
            return True
        if (
            max_pct > 0
            and incoming >= max(min_base, 1)
            and (100.0 * changed / incoming) > max_pct
        ):
            return True
        return False

    def upsert_documents(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        entries: Iterable[tuple[str, str, str]],
        index_version: int = 1,
    ) -> int:
        """Upsert compact docs for (ref, code, name) triples. Returns count."""
        if not self._enabled or session.get_bind().dialect.name != "postgresql":
            return 0
        now = _now()
        version = max(1, int(index_version or 1))
        count = 0
        for ref, code, name in entries:
            fields = build_search_document_fields(code, name)
            session.execute(
                text(
                    """
                    INSERT INTO app.one_c_catalog_search_documents (
                        source_base, generation, catalog_type, index_version, entry_ref,
                        code_normalized, name_normalized, search_text, search_tsv,
                        created_at, updated_at
                    ) VALUES (
                        :source_base, :generation, :catalog_type, :index_version, :entry_ref,
                        :code_normalized, :name_normalized, :search_text,
                        to_tsvector('simple', :tsv_source),
                        :created_at, :updated_at
                    )
                    ON CONFLICT (source_base, catalog_type, index_version, entry_ref)
                    DO UPDATE SET
                        generation = EXCLUDED.generation,
                        code_normalized = EXCLUDED.code_normalized,
                        name_normalized = EXCLUDED.name_normalized,
                        search_text = EXCLUDED.search_text,
                        search_tsv = EXCLUDED.search_tsv,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "source_base": source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                    "index_version": version,
                    "entry_ref": ref,
                    "code_normalized": fields["code_normalized"],
                    "name_normalized": fields["name_normalized"],
                    "search_text": fields["search_text"],
                    "tsv_source": fields["tsv_source"],
                    "created_at": now,
                    "updated_at": now,
                },
            )
            count += 1
        self.metrics["documents_upserted"] += count
        TOKEN_STATS_REBUILD_METRICS["documents_touched_total"] += count
        return count

    def delete_documents(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        entry_refs: Iterable[str],
        index_version: int = 1,
    ) -> int:
        refs = [ref for ref in entry_refs if ref]
        if not refs or not self._enabled or session.get_bind().dialect.name != "postgresql":
            return 0
        version = max(1, int(index_version or 1))
        deleted = 0
        chunk = 2_000
        for offset in range(0, len(refs), chunk):
            batch = refs[offset : offset + chunk]
            result = session.execute(
                text(
                    """
                    DELETE FROM app.one_c_catalog_search_documents
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                      AND index_version = :index_version
                      AND entry_ref = ANY(:refs)
                    """
                ),
                {
                    "source_base": source_base,
                    "catalog_type": catalog_type,
                    "index_version": version,
                    "refs": batch,
                },
            )
            deleted += int(result.rowcount or 0)
        self.metrics["documents_deleted"] += deleted
        TOKEN_STATS_REBUILD_METRICS["documents_touched_total"] += deleted
        return deleted

    def _load_doc_token_sets(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
        entry_refs: list[str],
    ) -> dict[str, set[str]]:
        """Map entry_ref → token set from existing compact docs (pre-mutation)."""
        out: dict[str, set[str]] = {}
        if not entry_refs:
            return out
        chunk = 2_000
        for offset in range(0, len(entry_refs), chunk):
            batch = entry_refs[offset : offset + chunk]
            rows = session.execute(
                text(
                    """
                    SELECT entry_ref, search_text
                    FROM app.one_c_catalog_search_documents
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                      AND index_version = :index_version
                      AND entry_ref = ANY(:refs)
                    """
                ),
                {
                    "source_base": source_base,
                    "catalog_type": catalog_type,
                    "index_version": index_version,
                    "refs": batch,
                },
            ).all()
            for row in rows:
                tokens = {
                    part
                    for part in str(row.search_text or "").split()
                    if len(part) >= 2
                }
                out[str(row.entry_ref)] = tokens
        return out

    def apply_token_stats_delta(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        old_by_ref: dict[str, set[str]],
        new_by_ref: dict[str, set[str]],
        affected_refs: Iterable[str],
    ) -> int:
        """Adjust token_stats frequencies from old vs new token sets (distinct refs).

        Idempotent for a given (old,new) pair: applying twice with the same
        sets after docs already mutated is incorrect — callers must load
        ``old_by_ref`` *before* document mutation and pass the intended
        ``new_by_ref``. Returns number of token rows touched.
        """
        if not self._enabled or session.get_bind().dialect.name != "postgresql":
            return 0
        started = time.perf_counter()
        now = _now()
        version = max(1, int(index_version or 1))
        # token → net distinct-ref frequency delta
        deltas: dict[str, int] = {}
        for ref in affected_refs:
            if not ref:
                continue
            old = old_by_ref.get(ref) or set()
            new = new_by_ref.get(ref) or set()
            for token in old - new:
                deltas[token] = deltas.get(token, 0) - 1
            for token in new - old:
                deltas[token] = deltas.get(token, 0) + 1
        touched = 0
        for token, delta in deltas.items():
            if not token or delta == 0:
                continue
            if delta > 0:
                session.execute(
                    text(
                        """
                        INSERT INTO app.one_c_catalog_search_token_stats (
                            source_base, generation, catalog_type, index_version,
                            token, frequency, updated_at
                        ) VALUES (
                            :source_base, :generation, :catalog_type, :index_version,
                            :token, :delta, :updated_at
                        )
                        ON CONFLICT (source_base, catalog_type, index_version, token)
                        DO UPDATE SET
                            generation = EXCLUDED.generation,
                            frequency = app.one_c_catalog_search_token_stats.frequency
                                + EXCLUDED.frequency,
                            updated_at = EXCLUDED.updated_at
                        """
                    ),
                    {
                        "source_base": source_base,
                        "generation": generation,
                        "catalog_type": catalog_type,
                        "index_version": version,
                        "token": token[:200],
                        "delta": int(delta),
                        "updated_at": now,
                    },
                )
            else:
                session.execute(
                    text(
                        """
                        UPDATE app.one_c_catalog_search_token_stats
                        SET frequency = frequency + :delta,
                            generation = :generation,
                            updated_at = :updated_at
                        WHERE source_base = :source_base
                          AND catalog_type = :catalog_type
                          AND index_version = :index_version
                          AND token = :token
                        """
                    ),
                    {
                        "source_base": source_base,
                        "catalog_type": catalog_type,
                        "index_version": version,
                        "token": token[:200],
                        "delta": int(delta),
                        "generation": generation,
                        "updated_at": now,
                    },
                )
            touched += 1
        # Drop zero/negative frequencies (defensive).
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND frequency <= 0
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": version,
            },
        )
        duration_ms = (time.perf_counter() - started) * 1000.0
        self.metrics["token_stats_delta_total"] += 1
        TOKEN_STATS_REBUILD_METRICS["token_stats_delta_total"] += 1
        TOKEN_STATS_REBUILD_METRICS["token_stats_delta_duration_ms"] = duration_ms
        return touched

    def rebuild_token_stats(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int = 1,
    ) -> int:
        """Atomically rebuild token_stats from documents for one scope/version.

        Call sites (only):
        - ``apply_incremental_patch`` / ``sync_scope_safe`` when mode=scope
          or delta fallback
        - backfill / versioned rebuild once after a catalog finishes

        Forbidden: per-entry, per-small-batch, fingerprint no-op, every search.
        """
        if not self._enabled or session.get_bind().dialect.name != "postgresql":
            return 0
        started = time.perf_counter()
        now = _now()
        version = max(1, int(index_version or 1))
        session.execute(
            text(
                """
                DELETE FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND coalesce(index_version, 1) = :index_version
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": version,
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
                    COUNT(*)::integer AS frequency,
                    :updated_at
                FROM (
                    SELECT DISTINCT d.entry_ref, trim(both FROM t.token) AS token
                    FROM app.one_c_catalog_search_documents d
                    CROSS JOIN LATERAL unnest(string_to_array(d.search_text, ' ')) AS t(token)
                    WHERE d.source_base = :source_base
                      AND d.generation = :generation
                      AND d.catalog_type = :catalog_type
                      AND coalesce(d.index_version, 1) = :index_version
                      AND length(trim(both FROM t.token)) >= 2
                ) exploded
                GROUP BY token
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": version,
                "updated_at": now,
            },
        )
        rows = int(result.rowcount or 0)
        duration_ms = (time.perf_counter() - started) * 1000.0
        self.metrics["token_stats_rebuilds"] += 1
        self.metrics["token_stats_rebuild_total"] += 1
        self.metrics["token_stats_rebuild_duration_ms"] = duration_ms
        self.metrics["token_stats_rebuild_rows"] = rows
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"] += 1
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_duration_ms"] = duration_ms
        TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_rows"] = float(rows)
        logger.info(
            "1C compact token_stats rebuild catalog_type=%s version=%s rows=%s duration_ms=%.1f total=%s",
            catalog_type,
            version,
            rows,
            duration_ms,
            int(TOKEN_STATS_REBUILD_METRICS["token_stats_rebuild_total"]),
        )
        return rows

    def refresh_state_counts(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        expected_count: int,
        status: str = STATUS_READY,
        checksum: str = "",
        error: str = "",
        index_version: int | None = None,
        sync_id: str = "",
        invalidate_previous: bool = False,
        schedule_previous_cleanup: bool = False,
        cas_base_fingerprint: str = "",
        cleanup_grace_seconds: int | None = None,
    ) -> int:
        """Refresh ready counts. Returns rows affected by the state upsert/update.

        ``invalidate_previous`` (legacy) zeroes previous pointer immediately —
        prefer ``schedule_previous_cleanup`` so docs stay until the deferred
        cleanup service runs after grace.

        When ``cas_base_fingerprint`` is set, the ON CONFLICT update only
        advances fingerprint if the row still matches the base (CAS).
        """
        if session.get_bind().dialect.name != "postgresql":
            return 0
        version = max(1, int(index_version or 1))
        indexed = session.execute(
            text(
                """
                SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                WHERE source_base = :source_base
                  AND generation = :generation
                  AND catalog_type = :catalog_type
                  AND coalesce(index_version, 1) = :index_version
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": version,
            },
        ).scalar_one()
        now = _now()
        grace = (
            DEFAULT_PREVIOUS_CLEANUP_GRACE_SECONDS
            if cleanup_grace_seconds is None
            else max(0, int(cleanup_grace_seconds))
        )
        cleanup_after = now + timedelta(seconds=grace)
        ready = (
            status == STATUS_READY
            and int(indexed) == int(expected_count)
            and int(expected_count) >= 0
        )
        final_status = STATUS_READY if ready else (
            status if status != STATUS_READY else STATUS_STALE
        )
        fingerprint = _text(checksum, maximum=64)
        cas_base = _text(cas_base_fingerprint, maximum=64)
        result = session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_search_index_state AS s (
                    source_base, catalog_type, generation, status,
                    expected_count, indexed_count, build_version, checksum,
                    last_error, started_at, finished_at, updated_at,
                    checkpoint_ref, checkpoint_offset,
                    active_index_version, building_index_version,
                    previous_index_version, source_fingerprint,
                    previous_cleanup_after
                ) VALUES (
                    :source_base, :catalog_type, :generation, :status,
                    :expected_count, :indexed_count, 1, :checksum,
                    :last_error, :updated_at, :updated_at, :updated_at,
                    :sync_id, 0,
                    :active_version, 0, 0, :checksum,
                    NULL
                )
                ON CONFLICT (source_base, catalog_type) DO UPDATE SET
                    generation = EXCLUDED.generation,
                    status = EXCLUDED.status,
                    expected_count = EXCLUDED.expected_count,
                    indexed_count = EXCLUDED.indexed_count,
                    build_version = s.build_version + 1,
                    checksum = EXCLUDED.checksum,
                    source_fingerprint = EXCLUDED.checksum,
                    active_index_version = CASE
                        WHEN EXCLUDED.status = 'ready'
                            THEN GREATEST(s.active_index_version, :active_version, 1)
                        ELSE s.active_index_version
                    END,
                    previous_index_version = CASE
                        WHEN :invalidate_previous THEN 0
                        ELSE s.previous_index_version
                    END,
                    previous_cleanup_after = CASE
                        WHEN :invalidate_previous THEN :updated_at
                        WHEN :schedule_previous_cleanup
                             AND s.previous_index_version > 0
                             AND s.previous_index_version
                                 IS DISTINCT FROM GREATEST(
                                     s.active_index_version, :active_version, 1
                                 )
                            THEN COALESCE(s.previous_cleanup_after, :cleanup_after)
                        ELSE s.previous_cleanup_after
                    END,
                    checkpoint_ref = CASE
                        WHEN EXCLUDED.status = 'ready' AND :sync_id <> ''
                            THEN :sync_id
                        ELSE s.checkpoint_ref
                    END,
                    last_error = EXCLUDED.last_error,
                    finished_at = EXCLUDED.finished_at,
                    updated_at = EXCLUDED.updated_at
                WHERE :cas_base = ''
                   OR s.source_fingerprint = :cas_base
                   OR s.source_fingerprint = EXCLUDED.checksum
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "status": final_status,
                "expected_count": int(expected_count),
                "indexed_count": int(indexed),
                "checksum": fingerprint,
                "last_error": _text(error, maximum=2_000),
                "updated_at": now,
                "cleanup_after": cleanup_after,
                "active_version": version if final_status == STATUS_READY else 0,
                "sync_id": _text(sync_id, maximum=64),
                "invalidate_previous": bool(invalidate_previous),
                "schedule_previous_cleanup": bool(schedule_previous_cleanup),
                "cas_base": cas_base,
            },
        )
        if schedule_previous_cleanup and not invalidate_previous:
            TOKEN_STATS_REBUILD_METRICS["previous_cleanup_scheduled_total"] += 1
        return int(result.rowcount or 0)

    def _classify_cas(
        self,
        *,
        current_fp: str,
        base_fp: str,
        target_fp: str,
        current_sync: str,
        patch_sync: str,
        status: str,
    ) -> str:
        """Return applied|noop|out_of_order|stale for fingerprint/sync CAS."""
        current = _text(current_fp, maximum=64)
        base = _text(base_fp, maximum=64)
        target = _text(target_fp, maximum=64)
        sync_cur = _text(current_sync, maximum=64)
        sync_new = _text(patch_sync, maximum=64)

        # Identical sync already committed at target → idempotent noop.
        if (
            sync_new
            and sync_cur == sync_new
            and status == STATUS_READY
            and (not target or current == target)
        ):
            return "noop"

        # Already at target fingerprint (possibly via another sync_id).
        if target and current == target and status == STATUS_READY:
            if sync_new and sync_cur and sync_cur != sync_new:
                # Same target reached by a different sync — treat as noop
                # (convergent), not a rewrite.
                return "noop"
            if not sync_new or sync_cur == sync_new:
                return "noop"

        # Empty base: allow apply (bootstrap / recovery without CAS parent).
        if not base:
            return "applied"

        # Strict CAS: must still be at base to advance to target.
        if current == base:
            return "applied"

        # Current already past base toward a different fingerprint.
        if current and current != base and (not target or current != target):
            return "out_of_order"

        return "stale"

    def apply_incremental_patch(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        patch: CompactCatalogPatch,
    ) -> IncrementalPatchReport:
        """Apply a compact patch to the *active* index_version (separate txn).

        Never mutates legacy entries/tokens. Never sync-deletes a previous
        index_version on the ordinary path — schedules deferred cleanup.
        On error: rollback + ``mark_stale``; legacy search remains available.
        """
        report = IncrementalPatchReport(
            ok=False,
            outcome="failed",
            catalog_type=patch.catalog_type,
            sync_id=patch.sync_id,
            catalog_fingerprint=patch.catalog_fingerprint,
            base_fingerprint=patch.base_fingerprint,
        )
        if not self._enabled:
            report.ok = True
            report.outcome = "disabled"
            return report
        if session.get_bind().dialect.name != "postgresql":
            report.ok = True
            report.outcome = "disabled"
            return report

        locked = False
        try:
            if not self._try_advisory_lock(session):
                report.ok = True
                report.outcome = "lock_skipped"
                return report
            locked = True

            state = self._read_active_state(
                session, source_base=source_base, catalog_type=patch.catalog_type
            )
            current_fp = str((state or {}).get("source_fingerprint") or "")
            current_sync = str((state or {}).get("checkpoint_ref") or "")
            status = str((state or {}).get("status") or "")
            cas = self._classify_cas(
                current_fp=current_fp,
                base_fp=patch.base_fingerprint,
                target_fp=patch.catalog_fingerprint,
                current_sync=current_sync,
                patch_sync=patch.sync_id,
                status=status,
            )
            if cas == "noop":
                report.ok = True
                report.outcome = "noop"
                report.active_index_version = int(
                    (state or {}).get("active_index_version") or 0
                )
                self.metrics["incremental_noop"] += 1
                TOKEN_STATS_REBUILD_METRICS["incremental_patch_noop_total"] += 1
                return report
            if cas in {"out_of_order", "stale"} and not patch.full_rebuild:
                report.ok = True
                report.outcome = cas
                report.active_index_version = int(
                    (state or {}).get("active_index_version") or 0
                )
                report.error = f"cas_{cas}"
                TOKEN_STATS_REBUILD_METRICS["incremental_patch_out_of_order_total"] += 1
                logger.warning(
                    "1C compact incremental CAS %s catalog_type=%s",
                    cas,
                    patch.catalog_type,
                )
                return report

            # Fingerprint already indexed and empty patch → no-op.
            if (
                patch.is_empty
                and state
                and status == STATUS_READY
                and patch.catalog_fingerprint
                and current_fp == patch.catalog_fingerprint
            ):
                report.ok = True
                report.outcome = "noop"
                report.active_index_version = int(state.get("active_index_version") or 0)
                self.metrics["incremental_noop"] += 1
                TOKEN_STATS_REBUILD_METRICS["incremental_patch_noop_total"] += 1
                return report

            active_version = int((state or {}).get("active_index_version") or 0)
            # Stale+active with a concrete patch (crash recovery) stays incremental.
            # Bootstrap/versioned only when there is no active version, explicit
            # full_rebuild, or stale/empty with nothing to patch.
            needs_bootstrap = (
                patch.full_rebuild
                or patch.force_versioned_rebuild
                or active_version <= 0
                or (status != STATUS_READY and patch.is_empty)
            )

            if needs_bootstrap or self._threshold_exceeded(patch):
                if self._threshold_exceeded(patch) and not needs_bootstrap:
                    self.metrics["threshold_escalations"] += 1
                    TOKEN_STATS_REBUILD_METRICS["incremental_threshold_escalations"] += 1
                    logger.warning(
                        "1C compact incremental threshold exceeded catalog_type=%s "
                        "changed=%s incoming=%s → versioned recovery",
                        patch.catalog_type,
                        patch.changed_count,
                        patch.incoming_count,
                    )
                    self.mark_stale(
                        session,
                        source_base=source_base,
                        catalog_type=patch.catalog_type,
                        generation=generation,
                        error="incremental_threshold_exceeded",
                    )
                    report.outcome = "threshold"
                return self._escalate_versioned_rebuild(
                    session,
                    source_base=source_base,
                    generation=generation,
                    patch=patch,
                    report=report,
                )

            # Incremental path: patch only the active version.
            index_version = active_version
            report.active_index_version = index_version
            affected_refs = [ref for ref, _c, _n in patch.upserts] + list(patch.deletes)
            old_by_ref = self._load_doc_token_sets(
                session,
                source_base=source_base,
                catalog_type=patch.catalog_type,
                index_version=index_version,
                entry_refs=affected_refs,
            )
            new_by_ref: dict[str, set[str]] = {
                ref: set() for ref in patch.deletes if ref
            }
            for ref, code, name in patch.upserts:
                fields = build_search_document_fields(code, name)
                new_by_ref[ref] = {
                    t for t in fields.get("tokens") or [] if len(str(t)) >= 2
                }

            deleted = self.delete_documents(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=patch.catalog_type,
                entry_refs=list(patch.deletes),
                index_version=index_version,
            )
            upserted = self.upsert_documents(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=patch.catalog_type,
                entries=list(patch.upserts),
                index_version=index_version,
            )
            report.documents_deleted = deleted
            report.documents_upserted = upserted
            untouched = max(
                0,
                int(patch.expected_count or patch.incoming_count or 0)
                - len(set(affected_refs)),
            )
            report.documents_untouched_estimate = untouched
            self.metrics["documents_untouched"] = untouched

            flags = get_compact_flags()
            stats_mode = flags.compact_token_stats_mode
            stats_rows = 0
            if affected_refs:
                if stats_mode == "delta":
                    stats_rows, stats_mode = self._apply_token_stats_delta_safe(
                        session,
                        source_base=source_base,
                        generation=generation,
                        catalog_type=patch.catalog_type,
                        index_version=index_version,
                        old_by_ref=old_by_ref,
                        new_by_ref=new_by_ref,
                        affected_refs=affected_refs,
                    )
                else:
                    stats_rows = self.rebuild_token_stats(
                        session,
                        source_base=source_base,
                        generation=generation,
                        catalog_type=patch.catalog_type,
                        index_version=index_version,
                    )
            report.token_stats_mode = stats_mode
            report.token_stats_rows = stats_rows

            # Schedule deferred cleanup of previous version — never sync-delete.
            schedule_prev = int((state or {}).get("previous_index_version") or 0) > 0
            cas_base = _text(patch.base_fingerprint, maximum=64) or current_fp
            grace = int(
                getattr(flags, "compact_previous_cleanup_grace_seconds", None)
                or DEFAULT_PREVIOUS_CLEANUP_GRACE_SECONDS
            )
            affected = self.refresh_state_counts(
                session,
                source_base=source_base,
                catalog_type=patch.catalog_type,
                generation=generation,
                expected_count=int(patch.expected_count),
                status=STATUS_READY,
                checksum=patch.catalog_fingerprint,
                index_version=index_version,
                sync_id=patch.sync_id,
                schedule_previous_cleanup=schedule_prev,
                cas_base_fingerprint=cas_base,
                cleanup_grace_seconds=grace,
            )
            if affected <= 0 and cas_base:
                # Concurrent CAS lost — do not leave half-applied docs ready.
                try:
                    session.rollback()
                except Exception:
                    pass
                report.ok = True
                report.outcome = "out_of_order"
                report.error = "cas_lost"
                TOKEN_STATS_REBUILD_METRICS["incremental_patch_out_of_order_total"] += 1
                try:
                    self.mark_stale(
                        session,
                        source_base=source_base,
                        catalog_type=patch.catalog_type,
                        generation=generation,
                        error="cas_lost",
                    )
                except Exception:
                    pass
                return report

            TOKEN_STATS_REBUILD_METRICS["incremental_patch_total"] += 1
            report.ok = True
            report.outcome = "applied"
            report.metrics = {
                "documents_upserted": float(upserted),
                "documents_deleted": float(deleted),
                "documents_untouched_estimate": float(untouched),
                "previous_cleanup_scheduled": float(1 if schedule_prev else 0),
            }
            return report
        except Exception as exc:
            self.metrics["write_errors"] += 1
            report.ok = False
            report.outcome = "failed"
            report.error = type(exc).__name__
            logger.warning(
                "1C compact incremental patch failed catalog_type=%s err_type=%s",
                patch.catalog_type,
                type(exc).__name__,
            )
            try:
                session.rollback()
            except Exception:
                pass
            try:
                self.mark_stale(
                    session,
                    source_base=source_base,
                    catalog_type=patch.catalog_type,
                    generation=generation,
                    error=type(exc).__name__,
                )
            except Exception:
                try:
                    session.rollback()
                except Exception:
                    pass
            return report
        finally:
            if locked:
                self._advisory_unlock(session)

    def _apply_token_stats_delta_safe(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        old_by_ref: dict[str, set[str]],
        new_by_ref: dict[str, set[str]],
        affected_refs: list[str],
    ) -> tuple[int, str]:
        """Delta token_stats with SAVEPOINT; on SQL error → scope rebuild.

        Returns ``(rows, mode)`` where mode is ``delta`` or ``scope``.
        Fail-closed: if scope rebuild also fails, caller marks stale.
        """
        try:
            session.execute(text("SAVEPOINT one_c_token_stats_delta"))
            rows = self.apply_token_stats_delta(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=index_version,
                old_by_ref=old_by_ref,
                new_by_ref=new_by_ref,
                affected_refs=affected_refs,
            )
            session.execute(text("RELEASE SAVEPOINT one_c_token_stats_delta"))
            return rows, "delta"
        except Exception as exc:
            logger.warning(
                "1C compact token_stats delta failed; scope rebuild "
                "catalog_type=%s err_type=%s",
                catalog_type,
                type(exc).__name__,
            )
            try:
                session.execute(text("ROLLBACK TO SAVEPOINT one_c_token_stats_delta"))
            except Exception:
                try:
                    session.rollback()
                except Exception:
                    pass
                raise
            rows = self.rebuild_token_stats(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=index_version,
            )
            return rows, "scope"

    def _drop_index_version(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
    ) -> None:
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

    def _escalate_versioned_rebuild(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        patch: CompactCatalogPatch,
        report: IncrementalPatchReport,
    ) -> IncrementalPatchReport:
        """Controlled recovery: versioned rebuild (migration/threshold/bootstrap)."""
        try:
            from backend.services.one_c_catalog_compact_rebuild import (
                OneCCatalogCompactVersionedRebuild,
            )

            orchestrator = OneCCatalogCompactVersionedRebuild(
                enabled=True,
                writer=self,
            )
            rebuilt = orchestrator.rebuild_after_sync(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=patch.catalog_type,
                expected_count=int(patch.expected_count),
            )
            if rebuilt.outcome in {"no_op", "built", "disabled", "non_postgresql", "lock_skipped"}:
                active = int(rebuilt.active_index_version or 0) or 1
                prev = int(rebuilt.previous_index_version or 0)
                # Align indexed fingerprint; schedule deferred previous cleanup
                # (never sync-delete previous docs in this path).
                if rebuilt.outcome in {"no_op", "built"}:
                    self.refresh_state_counts(
                        session,
                        source_base=source_base,
                        catalog_type=patch.catalog_type,
                        generation=generation,
                        expected_count=int(patch.expected_count),
                        status=STATUS_READY,
                        checksum=patch.catalog_fingerprint
                        or _text(rebuilt.fingerprint, maximum=64),
                        index_version=active,
                        sync_id=patch.sync_id,
                        schedule_previous_cleanup=bool(prev > 0 and prev != active),
                    )
                report.ok = True
                report.outcome = (
                    "rebuilt" if rebuilt.outcome == "built" else rebuilt.outcome
                )
                report.active_index_version = int(rebuilt.active_index_version or 0)
                return report
            report.ok = False
            report.outcome = "failed"
            report.error = rebuilt.error or rebuilt.outcome
            return report
        except Exception as exc:
            self.metrics["write_errors"] += 1
            report.ok = False
            report.outcome = "failed"
            report.error = type(exc).__name__
            try:
                session.rollback()
            except Exception:
                pass
            try:
                self.mark_stale(
                    session,
                    source_base=source_base,
                    catalog_type=patch.catalog_type,
                    generation=generation,
                    error=type(exc).__name__,
                )
            except Exception:
                try:
                    session.rollback()
                except Exception:
                    pass
            return report

    def sync_scope_safe(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        upserts: list[tuple[str, str, str]],
        deletes: list[str],
        expected_count: int,
        catalog_fingerprint: str = "",
        sync_id: str = "",
        full_rebuild: bool = False,
        incoming_count: int = 0,
        changed_count: int = 0,
        base_fingerprint: str = "",
    ) -> bool:
        """Best-effort compact sync for one completed legacy scope (post-commit).

        Ordinary path: incremental patch of active version.
        Bootstrap / threshold / explicit full_rebuild → versioned rebuild only.
        """
        if not self._enabled:
            return True
        if session.get_bind().dialect.name != "postgresql":
            return True
        patch = CompactCatalogPatch(
            catalog_type=catalog_type,
            upserts=tuple(
                (str(ref), str(code or ""), str(name or ""))
                for ref, code, name in (upserts or [])
                if ref
            ),
            deletes=tuple(str(r) for r in (deletes or []) if r),
            expected_count=int(expected_count),
            changed_count=int(
                changed_count
                or (len(upserts or []) + len(deletes or []))
            ),
            incoming_count=int(incoming_count or expected_count or 0),
            catalog_fingerprint=_text(catalog_fingerprint, maximum=64),
            base_fingerprint=_text(base_fingerprint, maximum=64),
            sync_id=_text(sync_id, maximum=64),
            full_rebuild=bool(full_rebuild),
        )
        if patch.is_empty and not patch.catalog_fingerprint:
            return True
        report = self.apply_incremental_patch(
            session,
            source_base=source_base,
            generation=generation,
            patch=patch,
        )
        # out_of_order / stale are intentional non-mutations (ok=True).
        return bool(report.ok)

    def reconcile_stale_scope(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        expected_count: int,
        catalog_fingerprint: str,
        sync_id: str = "",
    ) -> IncrementalPatchReport:
        """Crash-recovery / desync repair without a second 1C fetch.

        Diffs legacy entries vs active compact docs in SQL and applies an
        incremental patch. Escalates to versioned rebuild only when the
        changed set exceeds thresholds or no active ready version exists.
        """
        report = IncrementalPatchReport(
            ok=False,
            outcome="failed",
            catalog_type=catalog_type,
            catalog_fingerprint=catalog_fingerprint,
            sync_id=sync_id,
        )
        if not self._enabled or session.get_bind().dialect.name != "postgresql":
            report.ok = True
            report.outcome = "disabled"
            return report
        state = self._read_active_state(
            session, source_base=source_base, catalog_type=catalog_type
        )
        active = int((state or {}).get("active_index_version") or 0)
        if active <= 0:
            patch = CompactCatalogPatch(
                catalog_type=catalog_type,
                expected_count=expected_count,
                incoming_count=expected_count,
                changed_count=expected_count,
                catalog_fingerprint=catalog_fingerprint,
                sync_id=sync_id,
                full_rebuild=True,
            )
            return self.apply_incremental_patch(
                session,
                source_base=source_base,
                generation=generation,
                patch=patch,
            )

        # Prefer SQL ref-diff incremental repair even when status=stale
        # (legacy committed, compact crashed). Versioned rebuild only if
        # the resulting patch exceeds thresholds inside apply_incremental_patch.
        missing = session.execute(
            text(
                """
                SELECT e.ref, e.code, e.name
                FROM app.one_c_catalog_entries e
                LEFT JOIN app.one_c_catalog_search_documents d
                  ON d.source_base = e.source_base
                 AND d.catalog_type = e.catalog_type
                 AND d.index_version = :index_version
                 AND d.entry_ref = e.ref
                WHERE e.source_base = :source_base
                  AND e.generation = :generation
                  AND e.catalog_type = :catalog_type
                  AND d.entry_ref IS NULL
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": active,
            },
        ).all()
        extras = session.execute(
            text(
                """
                SELECT d.entry_ref
                FROM app.one_c_catalog_search_documents d
                LEFT JOIN app.one_c_catalog_entries e
                  ON e.source_base = d.source_base
                 AND e.catalog_type = d.catalog_type
                 AND e.generation = :generation
                 AND e.ref = d.entry_ref
                WHERE d.source_base = :source_base
                  AND d.catalog_type = :catalog_type
                  AND d.index_version = :index_version
                  AND e.ref IS NULL
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": active,
            },
        ).all()
        mismatched = session.execute(
            text(
                """
                SELECT e.ref, e.code, e.name
                FROM app.one_c_catalog_entries e
                JOIN app.one_c_catalog_search_documents d
                  ON d.source_base = e.source_base
                 AND d.catalog_type = e.catalog_type
                 AND d.index_version = :index_version
                 AND d.entry_ref = e.ref
                WHERE e.source_base = :source_base
                  AND e.generation = :generation
                  AND e.catalog_type = :catalog_type
                  AND (
                        d.code_normalized IS DISTINCT FROM e.code_normalized
                     OR d.name_normalized IS DISTINCT FROM e.name_normalized
                  )
                """
            ),
            {
                "source_base": source_base,
                "generation": generation,
                "catalog_type": catalog_type,
                "index_version": active,
            },
        ).all()
        upserts = [
            (str(r.ref), str(r.code or ""), str(r.name or ""))
            for r in (*missing, *mismatched)
        ]
        deletes = [str(r.entry_ref) for r in extras if r.entry_ref]
        base_fp = str((state or {}).get("source_fingerprint") or "")
        if not upserts and not deletes:
            # Counts/fingerprint drift only — refresh state to catalogue fp.
            self.refresh_state_counts(
                session,
                source_base=source_base,
                catalog_type=catalog_type,
                generation=generation,
                expected_count=expected_count,
                status=STATUS_READY,
                checksum=catalog_fingerprint,
                index_version=active,
                sync_id=sync_id,
                cas_base_fingerprint=base_fp,
            )
            report.ok = True
            report.outcome = "noop"
            report.active_index_version = active
            return report
        patch = CompactCatalogPatch(
            catalog_type=catalog_type,
            upserts=tuple(upserts),
            deletes=tuple(deletes),
            expected_count=expected_count,
            changed_count=len(upserts) + len(deletes),
            incoming_count=expected_count,
            catalog_fingerprint=catalog_fingerprint,
            base_fingerprint=base_fp,
            sync_id=sync_id,
        )
        return self.apply_incremental_patch(
            session,
            source_base=source_base,
            generation=generation,
            patch=patch,
        )
