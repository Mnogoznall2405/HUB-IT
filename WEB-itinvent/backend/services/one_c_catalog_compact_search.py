"""Staged D-lite compact catalogue search planner.

Stages: exact code → code prefix → name/model prefix → multiword FTS →
capped single-token FTS → mid-token trigram (≥3) → optional typo → suggest.
Readers must see index_state=ready and use ``active_index_version``.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text

from backend.appdb.db import app_session, is_app_database_configured
from backend.services.one_c_catalog_compact_docs import (
    build_and_prefix_tsquery,
    build_and_tsquery,
    hash_query_shape,
)
from backend.services.one_c_catalog_compact_flags import (
    ENGINE_COMPACT,
    OneCCatalogCompactFlags,
    get_compact_flags,
    should_attempt_compact_reader,
)
from backend.services.one_c_catalog_search import catalog_query_tokens, normalize_catalog_text


logger = logging.getLogger(__name__)

STATUS_READY = "ready"

# Candidate caps (minimal without critical FN). Tuned on Zipf-like benches.
CAP_EXACT = 200
CAP_PREFIX = 500
CAP_NAME_PREFIX = 500
CAP_MULTIWORD_FTS = 200
CAP_SINGLE_FTS = 200
# Common single-token FTS: keep PG top-N small (reduces sort/join work, not only trim).
CAP_COMMON_SINGLE_FTS = 100
CAP_MIDTOKEN = 150
CAP_TYPO = 150
# Tokens with frequency above this are treated as "common" → exact tsquery + stricter cap.
COMMON_TOKEN_FREQUENCY = 5_000
# Expression index from Alembic 0081: left(name_normalized, 200) varchar_pattern_ops
NAME_PREFIX_INDEX_CHARS = 200
CANARY_ROUTE_METRICS: dict[str, float] = {
    "compact_attempts": 0,
    "compact_hits": 0,
    "legacy_fallback": 0,
    "canary_selected": 0,
}


@dataclass
class CompactSearchResult:
    available: bool
    rows: list[dict[str, str]] = field(default_factory=list)
    stage: str = ""
    latency_ms: float = 0.0
    query_shape: str = ""
    error: str = ""
    ready: bool = False
    # Privacy-safe per-stage timings (shape/hash only — never raw query text).
    stage_metrics: list[dict[str, Any]] = field(default_factory=list)


class OneCCatalogCompactSearch:
    """PostgreSQL-backed compact search. Unavailable on non-PG dialects."""

    def __init__(
        self,
        database_url: str | None = None,
        *,
        flags: OneCCatalogCompactFlags | None = None,
    ) -> None:
        self._database_url = database_url
        self._flags = flags or get_compact_flags()

    @property
    def flags(self) -> OneCCatalogCompactFlags:
        return self._flags

    def _enabled(self) -> bool:
        return bool(self._database_url or is_app_database_configured())

    def resolve_ready_version(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        catalog_fingerprint: str | None = None,
    ) -> int | None:
        """Return active_index_version when ready + fingerprint-aligned, else None.

        Fail-closed: ready AND active version AND (when fingerprint provided)
        ``source_fingerprint == catalog_fingerprint``. Stale/desynced compact
        never serves search/suggest/canary.
        """
        row = session.execute(
            text(
                """
                SELECT status, generation, expected_count, indexed_count,
                       coalesce(active_index_version, 0) AS active_index_version,
                       coalesce(source_fingerprint, '') AS source_fingerprint
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                """
            ),
            {"source_base": source_base, "catalog_type": catalog_type},
        ).mappings().first()
        if row is None:
            return None
        ready = (
            str(row["status"]) == STATUS_READY
            and int(row["generation"] or 0) == int(generation)
            and int(row["indexed_count"] or 0) == int(row["expected_count"] or 0)
            and int(row["active_index_version"] or 0) > 0
        )
        if not ready:
            return None
        if catalog_fingerprint is None:
            # Load catalogue fingerprint from snapshot when caller omitted it.
            fp_col = (
                "nomenclature_fingerprint"
                if catalog_type == "nomenclature"
                else "warehouses_fingerprint"
            )
            snap = session.execute(
                text(
                    f"""
                    SELECT coalesce({fp_col}, '') AS catalog_fingerprint
                    FROM app.one_c_catalog_snapshots
                    WHERE source_base = :source_base
                    """
                ),
                {"source_base": source_base},
            ).mappings().first()
            catalog_fingerprint = str((snap or {}).get("catalog_fingerprint") or "")
        expected_fp = str(catalog_fingerprint or "").strip()
        indexed_fp = str(row["source_fingerprint"] or "").strip()
        if expected_fp and indexed_fp != expected_fp:
            return None
        return int(row["active_index_version"])

    def is_ready(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        generation: int,
        catalog_fingerprint: str | None = None,
    ) -> bool:
        return (
            self.resolve_ready_version(
                session,
                source_base=source_base,
                catalog_type=catalog_type,
                generation=generation,
                catalog_fingerprint=catalog_fingerprint,
            )
            is not None
        )

    def search_entries(
        self,
        *,
        catalog_type: str,
        text_query: str,
        limit: int,
        source_base: str,
        generation: int,
    ) -> CompactSearchResult:
        """Search using a short-lived Session (commits on success via app_session)."""
        started = time.perf_counter()
        tokens = catalog_query_tokens(text_query)
        shape = hash_query_shape(text_query, catalog_type=catalog_type, tokens=tokens)
        if not tokens:
            return CompactSearchResult(
                available=True, rows=[], stage="empty_tokens", query_shape=shape
            )
        if not self._enabled():
            return CompactSearchResult(
                available=False, rows=[], stage="disabled", query_shape=shape
            )

        safe_limit = max(1, min(int(limit or 1), 1_000))
        try:
            with app_session(self._database_url) as session:
                return self.search_entries_on_session(
                    session,
                    catalog_type=catalog_type,
                    text_query=text_query,
                    limit=safe_limit,
                    source_base=source_base,
                    generation=generation,
                    started=started,
                    shape=shape,
                    tokens=tokens,
                )
        except Exception as exc:
            logger.warning(
                "1C compact catalogue search unavailable shape=%s err_type=%s",
                shape,
                type(exc).__name__,
            )
            return CompactSearchResult(
                available=False,
                rows=[],
                stage="error",
                query_shape=shape,
                error=type(exc).__name__,
                latency_ms=(time.perf_counter() - started) * 1000.0,
            )

    def search_entries_on_session(
        self,
        session,
        *,
        catalog_type: str,
        text_query: str,
        limit: int,
        source_base: str,
        generation: int,
        started: float | None = None,
        shape: str | None = None,
        tokens: list[str] | None = None,
    ) -> CompactSearchResult:
        """Search on a caller-owned Session (no commit/close here).

        Used by shadow workers that must open/close their own Session and
        must never commit.
        """
        t0 = time.perf_counter() if started is None else started
        resolved_tokens = tokens if tokens is not None else catalog_query_tokens(text_query)
        resolved_shape = shape or hash_query_shape(
            text_query, catalog_type=catalog_type, tokens=resolved_tokens
        )
        if not resolved_tokens:
            return CompactSearchResult(
                available=True, rows=[], stage="empty_tokens", query_shape=resolved_shape
            )
        if session.get_bind().dialect.name != "postgresql":
            return CompactSearchResult(
                available=False,
                rows=[],
                stage="non_postgresql",
                query_shape=resolved_shape,
                error="compact_requires_postgresql",
            )
        index_version = self.resolve_ready_version(
            session,
            source_base=source_base,
            catalog_type=catalog_type,
            generation=generation,
        )
        if index_version is None:
            return CompactSearchResult(
                available=False,
                rows=[],
                stage="not_ready",
                query_shape=resolved_shape,
                ready=False,
                error="compact_index_not_ready",
            )

        safe_limit = max(1, min(int(limit or 1), 1_000))
        rows, stage, stage_metrics = self._staged_search(
            session,
            catalog_type=catalog_type,
            text_query=text_query,
            tokens=resolved_tokens,
            limit=safe_limit,
            source_base=source_base,
            generation=generation,
            index_version=index_version,
        )
        return CompactSearchResult(
            available=True,
            rows=rows,
            stage=stage,
            query_shape=resolved_shape,
            ready=True,
            latency_ms=(time.perf_counter() - t0) * 1000.0,
            stage_metrics=stage_metrics,
        )

    def suggest_token_prefixes(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        prefix: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Prefix suggest from compact token_stats (no token-row table)."""
        token_prefix = normalize_catalog_text(prefix)
        if len(token_prefix) < 2:
            return []
        index_version = self.resolve_ready_version(
            session,
            source_base=source_base,
            catalog_type=catalog_type,
            generation=generation,
        )
        if index_version is None:
            return []
        escaped = (
            token_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        safe_limit = max(1, min(int(limit or 1), 100))
        rows = session.execute(
            text(
                """
                SELECT token, frequency
                FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND token LIKE :prefix ESCAPE '\\'
                ORDER BY frequency DESC, token COLLATE "C"
                LIMIT :limit
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "prefix": f"{escaped}%",
                "limit": safe_limit,
            },
        ).all()
        return [{"token": str(r.token), "frequency": int(r.frequency)} for r in rows]

    def token_frequencies_from_stats(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        tokens: list[str],
    ) -> dict[str, int] | None:
        """Exact-token frequencies from compact stats; None if not ready."""
        if not tokens:
            return {}
        index_version = self.resolve_ready_version(
            session,
            source_base=source_base,
            catalog_type=catalog_type,
            generation=generation,
        )
        if index_version is None:
            return None
        rows = session.execute(
            text(
                """
                SELECT token, frequency
                FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND token = ANY(:tokens)
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "tokens": list(tokens),
            },
        ).all()
        return {str(r.token): int(r.frequency) for r in rows}

    def _token_frequency(
        self,
        session,
        *,
        source_base: str,
        catalog_type: str,
        index_version: int,
        token: str,
    ) -> int:
        row = session.execute(
            text(
                """
                SELECT frequency
                FROM app.one_c_catalog_search_token_stats
                WHERE source_base = :source_base
                  AND catalog_type = :catalog_type
                  AND index_version = :index_version
                  AND token = :token
                """
            ),
            {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "token": token,
            },
        ).first()
        return int(row.frequency) if row is not None else 0

    def _staged_search(
        self,
        session,
        *,
        catalog_type: str,
        text_query: str,
        tokens: list[str],
        limit: int,
        source_base: str,
        generation: int,
        index_version: int,
    ) -> tuple[list[dict[str, str]], str, list[dict[str, Any]]]:
        primary = tokens[0]
        normalized_query = normalize_catalog_text(text_query)
        prefix_rows: list[dict[str, str]] = []
        name_rows: list[dict[str, str]] = []
        stage_metrics: list[dict[str, Any]] = []
        scope = {
            "source_base": source_base,
            "generation": generation,
            "catalog_type": catalog_type,
            "index_version": index_version,
        }

        def _note(
            name: str,
            *,
            input_limit: int,
            candidates: int,
            returned: int,
            duration_ms: float,
            stop_reason: str,
        ) -> None:
            stage_metrics.append(
                {
                    "stage": name,
                    "input_limit": int(input_limit),
                    "candidates": int(candidates),
                    "returned": int(returned),
                    "duration_ms": round(float(duration_ms), 3),
                    "stop_reason": stop_reason,
                }
            )

        if len(tokens) == 1:
            t_stage = time.perf_counter()
            exact_limit = min(limit, CAP_EXACT)
            exact = self._search_code_exact(
                session,
                **scope,
                code=primary,
                limit=exact_limit,
            )
            _note(
                "exact_code",
                input_limit=exact_limit,
                candidates=len(exact),
                returned=min(len(exact), limit),
                duration_ms=(time.perf_counter() - t_stage) * 1000.0,
                stop_reason="filled" if exact else "continue",
            )
            if exact:
                return exact[:limit], "exact_code", stage_metrics

        if len(tokens) == 1 and len(primary) >= 2:
            t_stage = time.perf_counter()
            prefix_limit = min(limit, CAP_PREFIX)
            prefix_rows = self._search_code_prefix(
                session,
                **scope,
                code_prefix=primary,
                limit=prefix_limit,
            )
            _note(
                "code_prefix",
                input_limit=prefix_limit,
                candidates=len(prefix_rows),
                returned=min(len(prefix_rows), limit),
                duration_ms=(time.perf_counter() - t_stage) * 1000.0,
                stop_reason="filled" if len(prefix_rows) >= limit else "continue",
            )
            if len(prefix_rows) >= limit:
                return prefix_rows[:limit], "code_prefix", stage_metrics

            t_stage = time.perf_counter()
            name_limit = min(limit, CAP_NAME_PREFIX)
            name_rows = self._search_name_prefix(
                session,
                **scope,
                name_prefix=primary,
                limit=name_limit,
            )
            collected_prefix = self._merge_unique(prefix_rows, name_rows, limit)
            _note(
                "name_prefix",
                input_limit=name_limit,
                candidates=len(name_rows),
                returned=len(collected_prefix),
                duration_ms=(time.perf_counter() - t_stage) * 1000.0,
                stop_reason="filled" if len(collected_prefix) >= limit else "continue",
            )
            if len(collected_prefix) >= limit:
                return (
                    collected_prefix,
                    "name_prefix" if name_rows else "code_prefix",
                    stage_metrics,
                )
            prefix_rows = collected_prefix

        # Multiword FTS (AND) before expensive mid/typo. Dense single → exact tsquery + low cap.
        fts_limit = CAP_MULTIWORD_FTS if len(tokens) > 1 else CAP_SINGLE_FTS
        common_single = False
        if len(tokens) == 1:
            freq = self._token_frequency(
                session,
                source_base=source_base,
                catalog_type=catalog_type,
                index_version=index_version,
                token=primary,
            )
            if freq >= COMMON_TOKEN_FREQUENCY:
                fts_limit = CAP_COMMON_SINGLE_FTS
                common_single = True

        t_stage = time.perf_counter()
        fts_cap = min(limit, fts_limit)
        fts_rows = self._search_fts(
            session,
            **scope,
            tokens=tokens,
            primary=primary,
            limit=fts_cap,
            prefer_exact_lexemes=common_single or (
                len(tokens) == 1 and len(primary) >= 3
            ),
        )
        collected = self._merge_unique(prefix_rows, fts_rows, limit)
        fts_stage = "fts_multi" if len(tokens) > 1 else "fts_single"
        _note(
            fts_stage,
            input_limit=fts_cap,
            candidates=len(fts_rows),
            returned=len(collected),
            duration_ms=(time.perf_counter() - t_stage) * 1000.0,
            stop_reason="filled" if len(collected) >= limit else "continue",
        )
        if len(collected) >= limit:
            return (
                collected,
                fts_stage if fts_rows else (
                    "name_prefix" if name_rows else "code_prefix"
                ),
                stage_metrics,
            )

        if all(len(token) < self._flags.midtoken_min_length for token in tokens):
            if collected:
                return (
                    collected,
                    "fts" if fts_rows else (
                        "name_prefix" if name_rows else "code_prefix"
                    ),
                    stage_metrics,
                )
            _note(
                "short_tokens",
                input_limit=limit,
                candidates=0,
                returned=0,
                duration_ms=0.0,
                stop_reason="stop",
            )
            return collected, "short_tokens", stage_metrics

        if len(collected) < limit and all(
            len(token) >= self._flags.midtoken_min_length for token in tokens
        ):
            t_stage = time.perf_counter()
            mid_cap = min(limit, CAP_MIDTOKEN)
            mid = self._search_midtoken(
                session,
                **scope,
                tokens=tokens,
                primary=primary,
                limit=mid_cap,
            )
            collected = self._merge_unique(collected, mid, limit)
            _note(
                "midtoken",
                input_limit=mid_cap,
                candidates=len(mid),
                returned=len(collected),
                duration_ms=(time.perf_counter() - t_stage) * 1000.0,
                stop_reason="filled" if collected else "continue",
            )
            if collected:
                if mid:
                    return collected, "midtoken", stage_metrics
                return (
                    collected,
                    "fts" if fts_rows else (
                        "name_prefix" if name_rows else "code_prefix"
                    ),
                    stage_metrics,
                )

        if (
            not collected
            and self._flags.typo_fallback_enabled
            and len(normalized_query) >= 4
            and len(primary) >= 4
        ):
            t_stage = time.perf_counter()
            typo_cap = min(limit, CAP_TYPO)
            typo_rows = self._search_typo(
                session,
                **scope,
                primary=primary,
                tokens=tokens,
                limit=typo_cap,
            )
            _note(
                "typo",
                input_limit=typo_cap,
                candidates=len(typo_rows),
                returned=len(typo_rows),
                duration_ms=(time.perf_counter() - t_stage) * 1000.0,
                stop_reason="filled" if typo_rows else "empty",
            )
            if typo_rows:
                return typo_rows, "typo", stage_metrics

        if collected:
            return (
                collected,
                "fts" if fts_rows else (
                    "name_prefix" if name_rows else "code_prefix"
                ),
                stage_metrics,
            )
        _note(
            "empty",
            input_limit=limit,
            candidates=0,
            returned=0,
            duration_ms=0.0,
            stop_reason="empty",
        )
        return [], "empty", stage_metrics

    @staticmethod
    def _merge_unique(
        first: list[dict[str, str]],
        second: list[dict[str, str]],
        limit: int,
    ) -> list[dict[str, str]]:
        seen: set[str] = set()
        out: list[dict[str, str]] = []
        for row in (*first, *second):
            ref = str(row.get("ref") or "")
            if not ref or ref in seen:
                continue
            seen.add(ref)
            out.append(row)
            if len(out) >= limit:
                break
        return out

    def _run_ranked(
        self,
        session,
        *,
        sql: str,
        params: dict[str, Any],
        catalog_type: str,
        statement_timeout_ms: int | None = None,
    ) -> list[dict[str, str]]:
        if statement_timeout_ms is not None:
            # SET LOCAL does not accept bind parameters reliably.
            timeout_ms = max(1, int(statement_timeout_ms))
            session.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))
        rows = session.execute(text(sql), params).all()
        if catalog_type == "warehouses":
            return [
                {"ref": str(row.entry_ref), "name": str(getattr(row, "name", None) or row.name_normalized or "")}
                for row in rows
            ]
        return [
            {
                "ref": str(row.entry_ref),
                "code": str(getattr(row, "code", None) or row.code_normalized or ""),
                "name": str(getattr(row, "name", None) or row.name_normalized or ""),
            }
            for row in rows
        ]

    def _search_code_exact(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        code: str,
        limit: int,
    ) -> list[dict[str, str]]:
        sql = self._select_sql(
            """
            d.code_normalized = :code
            """
        )
        return self._run_ranked(
            session,
            sql=sql,
            params={
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "code": code,
                "limit": limit,
            },
            catalog_type=catalog_type,
        )

    @staticmethod
    def _select_sql(
        where_extra: str,
        *,
        rank_sql: str | None = None,
    ) -> str:
        """Limit on documents first, then join entries for display fields.

        Joining ``one_c_catalog_entries`` before LIMIT forced PG to materialize
        and rank every FTS/prefix hit — dominant cost on dense brands.
        """
        rank_select = f",\n                       {rank_sql}" if rank_sql else ""
        inner_order = (
            "rank_bucket,\n"
            "                         d.name_normalized COLLATE \"C\",\n"
            "                         d.code_normalized COLLATE \"C\",\n"
            "                         d.entry_ref COLLATE \"C\""
            if rank_sql
            else (
                "d.name_normalized COLLATE \"C\",\n"
                "                         d.code_normalized COLLATE \"C\",\n"
                "                         d.entry_ref COLLATE \"C\""
            )
        )
        outer_order = (
            "limited.rank_bucket,\n"
            "                     limited.name_normalized COLLATE \"C\",\n"
            "                     limited.code_normalized COLLATE \"C\",\n"
            "                     limited.entry_ref COLLATE \"C\""
            if rank_sql
            else (
                "limited.name_normalized COLLATE \"C\",\n"
                "                     limited.code_normalized COLLATE \"C\",\n"
                "                     limited.entry_ref COLLATE \"C\""
            )
        )
        return f"""
            SELECT limited.entry_ref,
                   limited.code_normalized,
                   limited.name_normalized,
                   e.code,
                   e.name
            FROM (
                SELECT d.entry_ref,
                       d.code_normalized,
                       d.name_normalized,
                       d.generation,
                       d.source_base,
                       d.catalog_type{rank_select}
                FROM app.one_c_catalog_search_documents d
                WHERE d.source_base = :source_base
                  AND d.catalog_type = :catalog_type
                  AND d.index_version = :index_version
                  AND {where_extra}
                ORDER BY {inner_order}
                LIMIT :limit
            ) limited
            JOIN app.one_c_catalog_entries e
              ON e.source_base = limited.source_base
             AND e.generation = limited.generation
             AND e.catalog_type = limited.catalog_type
             AND e.ref = limited.entry_ref
            ORDER BY {outer_order}
        """

    def _search_code_prefix(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        code_prefix: str,
        limit: int,
    ) -> list[dict[str, str]]:
        escaped = (
            code_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        # Cheap rank: equality first, then prefix hits (no regex / search_text scan).
        sql = self._select_sql(
            "d.code_normalized LIKE :prefix ESCAPE '\\'",
            rank_sql="""CASE
                         WHEN d.code_normalized = :exact THEN 0
                         ELSE 2
                       END AS rank_bucket""",
        )
        return self._run_ranked(
            session,
            sql=sql,
            params={
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "exact": code_prefix,
                "prefix": f"{escaped}%",
                "limit": limit,
            },
            catalog_type=catalog_type,
        )

    def _search_name_prefix(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        name_prefix: str,
        limit: int,
    ) -> list[dict[str, str]]:
        escaped = (
            name_prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        # Match 0081 expression index exactly (literal 200 — bind params break index match).
        n = int(NAME_PREFIX_INDEX_CHARS)
        sql = self._select_sql(
            f"left(d.name_normalized, {n}) LIKE :prefix ESCAPE '\\'",
            rank_sql=f"""CASE
                         WHEN d.code_normalized = :exact THEN 0
                         WHEN left(d.name_normalized, {n})
                              LIKE :prefix ESCAPE '\\' THEN 3
                         ELSE 4
                       END AS rank_bucket""",
        )
        return self._run_ranked(
            session,
            sql=sql,
            params={
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "exact": name_prefix,
                "prefix": f"{escaped}%",
                "limit": limit,
            },
            catalog_type=catalog_type,
        )

    def _search_fts(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        tokens: list[str],
        primary: str,
        limit: int,
        prefer_exact_lexemes: bool = False,
    ) -> list[dict[str, str]]:
        # Multiword keeps prefix AND; dense/common single uses exact lexemes.
        if prefer_exact_lexemes:
            tsquery = build_and_tsquery(tokens, prefix=False)
        else:
            tsquery = build_and_prefix_tsquery(tokens)
        if not tsquery:
            return []
        # Dense/common: no per-row CASE — stable name order + LIMIT enables top-N.
        # Selective FTS keeps a light code/name bucket (no search_text regex).
        n = int(NAME_PREFIX_INDEX_CHARS)
        if prefer_exact_lexemes:
            sql = self._select_sql(
                "d.search_tsv @@ to_tsquery('simple', :tsquery)",
            )
            params = {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "tsquery": tsquery,
                "limit": limit,
            }
        else:
            sql = self._select_sql(
                "d.search_tsv @@ to_tsquery('simple', :tsquery)",
                rank_sql=f"""CASE
                             WHEN d.code_normalized = :primary THEN 0
                             WHEN d.code_normalized LIKE :primary_prefix ESCAPE '\\' THEN 2
                             WHEN left(d.name_normalized, {n})
                                  LIKE :primary_prefix ESCAPE '\\' THEN 3
                             ELSE 4
                           END AS rank_bucket""",
            )
            escaped = (
                primary.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            params = {
                "source_base": source_base,
                "catalog_type": catalog_type,
                "index_version": index_version,
                "tsquery": tsquery,
                "primary": primary,
                "primary_prefix": f"{escaped}%",
                "limit": limit,
            }
        return self._run_ranked(
            session,
            sql=sql,
            params=params,
            catalog_type=catalog_type,
        )

    def _search_midtoken(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        tokens: list[str],
        primary: str,
        limit: int,
    ) -> list[dict[str, str]]:
        conditions: list[str] = []
        params: dict[str, Any] = {
            "source_base": source_base,
            "catalog_type": catalog_type,
            "index_version": index_version,
            "primary": primary,
            "limit": limit,
        }
        for index, token in enumerate(tokens):
            key = f"tok{index}"
            escaped = token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params[key] = f"%{escaped}%"
            conditions.append(f"d.search_text LIKE :{key} ESCAPE '\\'")
        where_extra = " AND ".join(conditions)
        escaped_primary = (
            primary.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        params["primary_prefix"] = f"{escaped_primary}%"
        n = int(NAME_PREFIX_INDEX_CHARS)
        sql = self._select_sql(
            where_extra,
            rank_sql=f"""CASE
                         WHEN d.code_normalized = :primary THEN 0
                         WHEN d.code_normalized LIKE :primary_prefix ESCAPE '\\' THEN 2
                         WHEN left(d.name_normalized, {n})
                              LIKE :primary_prefix ESCAPE '\\' THEN 3
                         ELSE 5
                       END AS rank_bucket""",
        )
        try:
            return self._run_ranked(
                session,
                sql=sql,
                params=params,
                catalog_type=catalog_type,
                statement_timeout_ms=self._flags.midtoken_timeout_ms,
            )
        except Exception as exc:
            logger.info(
                "1C compact midtoken stage skipped err_type=%s",
                type(exc).__name__,
            )
            try:
                session.rollback()
            except Exception:
                pass
            return []

    def _search_typo(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        index_version: int,
        primary: str,
        tokens: list[str],
        limit: int,
    ) -> list[dict[str, str]]:
        """Typo path: similar tokens from token_stats only — never full-entry fuzzy."""
        try:
            timeout_ms = max(1, int(self._flags.typo_timeout_ms))
            session.execute(text(f"SET LOCAL statement_timeout = '{timeout_ms}ms'"))
            candidates = session.execute(
                text(
                    """
                    SELECT token, frequency, similarity(token, :primary) AS sim
                    FROM app.one_c_catalog_search_token_stats
                    WHERE source_base = :source_base
                      AND catalog_type = :catalog_type
                      AND index_version = :index_version
                      AND token %% :primary
                      AND similarity(token, :primary) >= :threshold
                    ORDER BY sim DESC, frequency DESC, token COLLATE "C"
                    LIMIT :max_candidates
                    """
                ),
                {
                    "source_base": source_base,
                    "catalog_type": catalog_type,
                    "index_version": index_version,
                    "primary": primary,
                    "threshold": self._flags.typo_similarity_threshold,
                    "max_candidates": self._flags.typo_max_candidates,
                },
            ).all()
        except Exception as exc:
            logger.info(
                "1C compact typo candidate stage skipped err_type=%s",
                type(exc).__name__,
            )
            try:
                session.rollback()
            except Exception:
                pass
            return []

        if not candidates:
            return []

        corrected = str(candidates[0].token)
        corrected_tokens = [corrected if token == primary else token for token in tokens]
        tsquery = build_and_prefix_tsquery(corrected_tokens)
        if not tsquery:
            return []
        sql = self._select_sql(
            "d.search_tsv @@ to_tsquery('simple', :tsquery)",
            rank_sql="6 AS rank_bucket",
        )
        try:
            return self._run_ranked(
                session,
                sql=sql,
                params={
                    "source_base": source_base,
                    "catalog_type": catalog_type,
                    "index_version": index_version,
                    "tsquery": tsquery,
                    "limit": limit,
                },
                catalog_type=catalog_type,
                statement_timeout_ms=self._flags.typo_timeout_ms,
            )
        except Exception as exc:
            logger.info(
                "1C compact typo FTS stage skipped err_type=%s",
                type(exc).__name__,
            )
            try:
                session.rollback()
            except Exception:
                pass
            return []


def compact_engine_requested(flags: OneCCatalogCompactFlags | None = None) -> bool:
    """True when SEARCH_ENGINE=compact (full cutover). Prefer should_attempt_compact_reader for canary."""
    resolved = flags or get_compact_flags()
    return resolved.search_engine == ENGINE_COMPACT and not resolved.engine_config_error


def compact_reader_requested(
    flags: OneCCatalogCompactFlags | None = None,
    *,
    routing_user_key: str | None = None,
) -> bool:
    """Engine=compact OR deterministic canary selects this request."""
    return should_attempt_compact_reader(flags, routing_user_key=routing_user_key)
