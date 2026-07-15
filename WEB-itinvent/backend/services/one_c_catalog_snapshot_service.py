"""Indexed, app-owned snapshots of read-only 1C directories.

This module has no COM imports and never calls 1C.  The 1C worker supplies a
fully-read catalogue, then this store atomically promotes a new immutable
generation.  Web backends search the indexed rows directly instead of loading
hundreds of thousands of records and rebuilding a Python token index on every
process start.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import case, delete, exists, insert, or_, select, text

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppOneCCatalogEntry, AppOneCCatalogSnapshot, AppOneCCatalogToken
from backend.services.one_c_catalog_search import catalog_index_tokens, catalog_query_tokens


logger = logging.getLogger(__name__)

CATALOG_NOMENCLATURE = "nomenclature"
CATALOG_WAREHOUSES = "warehouses"
CATALOG_TYPES = {CATALOG_NOMENCLATURE, CATALOG_WAREHOUSES}
DEFAULT_SOURCE_BASE = "buh20"
_WHITESPACE_RE = re.compile(r"\s+")
_ENTRY_INSERT_CHUNK = 10_000
_TOKEN_INSERT_CHUNK = 50_000
_DELETE_REF_CHUNK = 2_000

_ENTRY_COPY_COLUMNS = (
    "source_base",
    "generation",
    "catalog_type",
    "ref",
    "code",
    "name",
    "code_normalized",
    "name_normalized",
    "created_at",
)
_TOKEN_COPY_COLUMNS = (
    "source_base",
    "generation",
    "catalog_type",
    "entry_ref",
    "token",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _text(value: Any, *, maximum: int | None = None) -> str:
    text = str(value or "").strip()
    return text[:maximum] if maximum is not None else text


def _normalized(value: Any, *, maximum: int | None = None) -> str:
    return _WHITESPACE_RE.sub(" ", _text(value, maximum=maximum).casefold()).strip()


def _flag_enabled() -> bool:
    """Return whether the app snapshot should be the primary catalogue store.

    ``auto`` (the default) means enabled whenever APP_DATABASE_URL is present.
    An explicit false value keeps the legacy JSON cache as an emergency
    rollback path without changing the 1C read contract.
    """
    raw = _text(os.getenv("WAREHOUSE_1C_CATALOG_APP_STORAGE", "auto")).casefold()
    if raw in {"0", "false", "no", "off", "disabled"}:
        return False
    return is_app_database_configured()


def catalog_search_tokens(value: Any) -> list[str]:
    """Stable, compact tokens used for DB-backed autocomplete.

    Two characters are retained because the public autocomplete accepts a
    two-character query.  The original hyphenated part number is kept in
    addition to its components, which makes exact inventory-like codes useful
    without sacrificing prefix/substring typeahead.
    """
    return catalog_index_tokens(value)


def _like_fragment(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class OneCCatalogSnapshotStore:
    """Storage seam for one current indexed snapshot per 1C source base.

    The return convention for read methods is intentional:

    * ``available=False`` means no app snapshot can safely answer the query;
      callers may use the legacy JSON fallback.
    * ``available=True`` with an empty list/value means the current snapshot
      answered definitively and callers must not make a live 1C query just to
      turn a real empty search into an accidental timeout.
    """

    def __init__(self, database_url: str | None = None, *, enabled: bool | None = None) -> None:
        self._database_url = database_url
        self._enabled = bool(database_url) if enabled is None and database_url else (
            _flag_enabled() if enabled is None else bool(enabled)
        )

    @property
    def enabled(self) -> bool:
        return bool(self._enabled and (self._database_url or is_app_database_configured()))

    def _storage_enabled(self) -> bool:
        # Schema creation belongs to migrations/application startup. Neither
        # autocomplete reads nor periodic snapshot writes may execute DDL.
        return self.enabled

    @staticmethod
    def _source_base(value: str | None) -> str:
        return _text(value, maximum=64) or DEFAULT_SOURCE_BASE

    @staticmethod
    def _stable_order_column(column, dialect_name: str):
        # Python's memory fallback orders normalized Unicode strings
        # deterministically. PostgreSQL's database locale may ignore or
        # reorder spaces/hyphens, changing which equal-rank row crosses the
        # autocomplete limit. Binary UTF-8 order matches the fallback.
        return column.collate("C") if dialect_name == "postgresql" else column

    @staticmethod
    def _catalog_type(value: str) -> str:
        normalized = _text(value, maximum=16).casefold()
        if normalized not in CATALOG_TYPES:
            raise ValueError("Unsupported 1C catalogue type")
        return normalized

    def _current_snapshot(self, session, source_base: str) -> AppOneCCatalogSnapshot | None:
        row = session.get(AppOneCCatalogSnapshot, source_base)
        if row is None or int(row.active_generation or 0) <= 0 or row.updated_at is None:
            return None
        return row

    @staticmethod
    def _entry_values(row: Any, catalog_type: str) -> tuple[str, str, str] | None:
        if isinstance(row, dict):
            ref = _text(row.get("ref"), maximum=64)
            code = _text(row.get("code"), maximum=200) if catalog_type == CATALOG_NOMENCLATURE else ""
            name = _text(row.get("name"))
        elif isinstance(row, (tuple, list)):
            if catalog_type == CATALOG_NOMENCLATURE:
                if len(row) < 3:
                    return None
                ref, code, name = _text(row[0], maximum=64), _text(row[1], maximum=200), _text(row[2])
            else:
                if len(row) < 2:
                    return None
                ref, code, name = _text(row[0], maximum=64), "", _text(row[1])
        else:
            return None
        if not ref:
            return None
        return ref, code, name

    @staticmethod
    def _copy_rows(session, *, table: str, columns: tuple[str, ...], rows: list[dict[str, Any]]) -> bool:
        """Bulk-load one PostgreSQL batch through the current transaction.

        Millions of catalogue tokens are normal for the full 1C directory.
        Sending them as individual extended-protocol INSERT parameters keeps
        the transaction atomic but can saturate WAL for tens of minutes.
        Psycopg COPY retains the exact same transaction boundary and defaults
        while reducing round trips dramatically. Other dialects keep the
        portable SQLAlchemy insert path used by tests/development.
        """
        if not rows or session.get_bind().dialect.name != "postgresql":
            return False
        driver_connection = session.connection().connection.driver_connection
        column_sql = ", ".join(columns)
        copy_sql = f"COPY app.{table} ({column_sql}) FROM STDIN"
        with driver_connection.cursor() as cursor:
            with cursor.copy(copy_sql) as copy:
                for row in rows:
                    copy.write_row(tuple(row[column] for column in columns))
        return True

    @staticmethod
    def _prepare_initial_postgres_load(session) -> bool:
        """Defer expensive secondary token indexes for the first snapshot.

        Maintaining three indexes row-by-row makes a seven-million-token
        initial COPY slower than building each index once over the completed
        heap. PostgreSQL DDL is transactional, so a failure restores both the
        previous index definitions and the empty pre-snapshot state.
        """
        if session.get_bind().dialect.name != "postgresql":
            return False
        session.execute(text("DROP INDEX IF EXISTS app.ix_app_one_c_catalog_entries_ref"))
        session.execute(text("DROP INDEX IF EXISTS app.ix_app_one_c_catalog_entries_name"))
        session.execute(text("DROP INDEX IF EXISTS app.ix_app_one_c_catalog_entries_code"))
        session.execute(
            text(
                "ALTER TABLE app.one_c_catalog_entries "
                "DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_entries_generation_ref"
            )
        )
        session.execute(text("DROP INDEX IF EXISTS app.ix_app_one_c_catalog_tokens_token_trgm"))
        session.execute(text("DROP INDEX IF EXISTS app.ix_app_one_c_catalog_tokens_lookup"))
        session.execute(
            text(
                "ALTER TABLE app.one_c_catalog_tokens "
                "DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_tokens_entry_token"
            )
        )
        session.execute(text("SET LOCAL maintenance_work_mem = '256MB'"))
        return True

    @staticmethod
    def _finish_initial_postgres_load(session) -> None:
        session.execute(
            text(
                "ALTER TABLE app.one_c_catalog_entries ADD CONSTRAINT "
                "uq_app_one_c_catalog_entries_generation_ref UNIQUE "
                "(source_base, generation, catalog_type, ref)"
            )
        )
        session.execute(
            text(
                "CREATE INDEX ix_app_one_c_catalog_entries_ref "
                "ON app.one_c_catalog_entries "
                "(source_base, generation, catalog_type, ref)"
            )
        )
        session.execute(
            text(
                "CREATE INDEX ix_app_one_c_catalog_entries_name "
                "ON app.one_c_catalog_entries "
                "(source_base, generation, catalog_type, name_normalized)"
            )
        )
        session.execute(
            text(
                "CREATE INDEX ix_app_one_c_catalog_entries_code "
                "ON app.one_c_catalog_entries "
                "(source_base, generation, catalog_type, code_normalized)"
            )
        )
        session.execute(
            text(
                "ALTER TABLE app.one_c_catalog_tokens ADD CONSTRAINT "
                "uq_app_one_c_catalog_tokens_entry_token UNIQUE "
                "(source_base, generation, catalog_type, entry_ref, token)"
            )
        )
        session.execute(
            text(
                "CREATE INDEX ix_app_one_c_catalog_tokens_lookup "
                "ON app.one_c_catalog_tokens "
                "(source_base, generation, catalog_type, token, entry_ref)"
            )
        )
        session.execute(
            text(
                "CREATE INDEX ix_app_one_c_catalog_tokens_token_trgm "
                "ON app.one_c_catalog_tokens USING gin (token gin_trgm_ops)"
            )
        )

    def _insert_generation(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        entries: Iterable[Any],
    ) -> int:
        entry_batch: list[dict[str, Any]] = []
        token_batch: list[dict[str, Any]] = []
        seen_refs: set[str] = set()
        count = 0
        created_at = _now()

        def flush_entries() -> None:
            if entry_batch:
                if not self._copy_rows(
                    session,
                    table="one_c_catalog_entries",
                    columns=_ENTRY_COPY_COLUMNS,
                    rows=entry_batch,
                ):
                    session.execute(insert(AppOneCCatalogEntry), list(entry_batch))
                entry_batch.clear()

        def flush_tokens() -> None:
            if token_batch:
                if not self._copy_rows(
                    session,
                    table="one_c_catalog_tokens",
                    columns=_TOKEN_COPY_COLUMNS,
                    rows=token_batch,
                ):
                    session.execute(insert(AppOneCCatalogToken), list(token_batch))
                token_batch.clear()

        for raw in entries:
            values = self._entry_values(raw, catalog_type)
            if values is None:
                continue
            ref, code, name = values
            if ref in seen_refs:
                continue
            seen_refs.add(ref)
            count += 1
            entry_batch.append(
                {
                    "source_base": source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                    "ref": ref,
                    "code": code,
                    "name": name,
                    "code_normalized": _normalized(code, maximum=200),
                    "name_normalized": _normalized(name),
                    "created_at": created_at,
                }
            )
            for token in catalog_search_tokens(f"{code} {name}"):
                token_batch.append(
                    {
                        "source_base": source_base,
                        "generation": generation,
                        "catalog_type": catalog_type,
                        "entry_ref": ref,
                        "token": token,
                    }
                )
            if len(entry_batch) >= _ENTRY_INSERT_CHUNK:
                flush_entries()
            if len(token_batch) >= _TOKEN_INSERT_CHUNK:
                flush_tokens()

        flush_entries()
        flush_tokens()
        return count

    def _update_catalog_in_place(
        self,
        session,
        *,
        source_base: str,
        generation: int,
        catalog_type: str,
        entries: Iterable[Any],
    ) -> tuple[int, int]:
        """Atomically patch only rows that differ from the active snapshot.

        A normal hourly 1C refresh changes very few of ~710k catalogue rows.
        Copying a complete replacement generation also rewrites millions of
        derived tokens and can saturate PostgreSQL WAL for tens of minutes.
        PostgreSQL MVCC already gives readers the previous committed values
        until this transaction commits, so a small in-place patch preserves
        atomic visibility without duplicating every unchanged row.
        """
        pending: dict[str, tuple[str, str]] = {}
        for raw in entries:
            values = self._entry_values(raw, catalog_type)
            if values is None:
                continue
            ref, code, name = values
            pending.setdefault(ref, (code, name))
        incoming_count = len(pending)

        changed_rows: list[dict[str, str]] = []
        removed_refs: list[str] = []
        current_rows = session.execute(
            select(
                AppOneCCatalogEntry.ref,
                AppOneCCatalogEntry.code,
                AppOneCCatalogEntry.name,
            ).where(
                AppOneCCatalogEntry.source_base == source_base,
                AppOneCCatalogEntry.generation == generation,
                AppOneCCatalogEntry.catalog_type == catalog_type,
            )
        )
        for current in current_rows:
            ref = str(current.ref)
            replacement = pending.pop(ref, None)
            if replacement is None:
                removed_refs.append(ref)
                continue
            code, name = replacement
            if code != str(current.code or "") or name != str(current.name or ""):
                changed_rows.append({"ref": ref, "code": code, "name": name})

        added_rows = [
            {"ref": ref, "code": code, "name": name}
            for ref, (code, name) in pending.items()
        ]
        replaced_refs = removed_refs + [row["ref"] for row in changed_rows]
        for offset in range(0, len(replaced_refs), _DELETE_REF_CHUNK):
            refs = replaced_refs[offset : offset + _DELETE_REF_CHUNK]
            session.execute(
                delete(AppOneCCatalogToken).where(
                    AppOneCCatalogToken.source_base == source_base,
                    AppOneCCatalogToken.generation == generation,
                    AppOneCCatalogToken.catalog_type == catalog_type,
                    AppOneCCatalogToken.entry_ref.in_(refs),
                )
            )
            session.execute(
                delete(AppOneCCatalogEntry).where(
                    AppOneCCatalogEntry.source_base == source_base,
                    AppOneCCatalogEntry.generation == generation,
                    AppOneCCatalogEntry.catalog_type == catalog_type,
                    AppOneCCatalogEntry.ref.in_(refs),
                )
            )

        if changed_rows or added_rows:
            self._insert_generation(
                session,
                source_base=source_base,
                generation=generation,
                catalog_type=catalog_type,
                entries=[*changed_rows, *added_rows],
            )
        return incoming_count, len(removed_refs) + len(changed_rows) + len(added_rows)

    def replace_snapshot(
        self,
        *,
        nomenclature: Iterable[Any],
        warehouses: Iterable[Any],
        source_base: str = DEFAULT_SOURCE_BASE,
        nomenclature_truncated: bool = False,
        warehouses_truncated: bool = False,
        nomenclature_fingerprint: str = "",
        warehouses_fingerprint: str = "",
    ) -> dict[str, Any] | None:
        """Atomically make a fully read 1C catalogue snapshot current.

        The first import creates an immutable generation. Later refreshes use
        an MVCC transaction to patch only changed refs in that active
        generation. A failed transaction therefore leaves all readers on the
        last verified snapshot without rewriting millions of unchanged tokens.
        """
        if not self._storage_enabled():
            return None
        source = self._source_base(source_base)
        now = _now()
        with app_session(self._database_url) as session:
            state = session.scalars(
                select(AppOneCCatalogSnapshot)
                .where(AppOneCCatalogSnapshot.source_base == source)
                .with_for_update()
            ).first()
            if state is None:
                state = AppOneCCatalogSnapshot(source_base=source)
                session.add(state)
                previous_generation = 0
            else:
                previous_generation = int(state.active_generation or 0)
            generation = previous_generation or 1
            changed_count = 0
            if previous_generation == 0:
                deferred_initial_indexes = self._prepare_initial_postgres_load(session)
                nomenclature_count = self._insert_generation(
                    session,
                    source_base=source,
                    generation=generation,
                    catalog_type=CATALOG_NOMENCLATURE,
                    entries=nomenclature,
                )
                warehouses_count = self._insert_generation(
                    session,
                    source_base=source,
                    generation=generation,
                    catalog_type=CATALOG_WAREHOUSES,
                    entries=warehouses,
                )
                if deferred_initial_indexes:
                    self._finish_initial_postgres_load(session)
                changed_count = nomenclature_count + warehouses_count
                state.active_generation = generation
            else:
                nomenclature_count, nomenclature_changed = self._update_catalog_in_place(
                    session,
                    source_base=source,
                    generation=generation,
                    catalog_type=CATALOG_NOMENCLATURE,
                    entries=nomenclature,
                )
                warehouses_count, warehouses_changed = self._update_catalog_in_place(
                    session,
                    source_base=source,
                    generation=generation,
                    catalog_type=CATALOG_WAREHOUSES,
                    entries=warehouses,
                )
                changed_count = nomenclature_changed + warehouses_changed
            state.nomenclature_count = nomenclature_count
            state.warehouses_count = warehouses_count
            metadata_changed = (
                bool(state.nomenclature_truncated) != bool(nomenclature_truncated)
                or bool(state.warehouses_truncated) != bool(warehouses_truncated)
            )
            state.nomenclature_truncated = bool(nomenclature_truncated)
            state.warehouses_truncated = bool(warehouses_truncated)
            state.nomenclature_fingerprint = _text(nomenclature_fingerprint, maximum=64)
            state.warehouses_fingerprint = _text(warehouses_fingerprint, maximum=64)
            if previous_generation == 0 or changed_count or metadata_changed:
                state.updated_at = now
            state.last_attempt_at = now
            state.last_error = ""
            session.flush()

        return self.get_status(source_base=source)

    def record_attempt_failure(self, error: Any, *, source_base: str = DEFAULT_SOURCE_BASE) -> None:
        """Publish a failed refresh attempt without discarding the old snapshot."""
        if not self._storage_enabled():
            return
        source = self._source_base(source_base)
        with app_session(self._database_url) as session:
            state = session.get(AppOneCCatalogSnapshot, source)
            if state is None:
                state = AppOneCCatalogSnapshot(source_base=source)
                session.add(state)
            state.last_attempt_at = _now()
            state.last_error = _text(error, maximum=2_000)

    def record_attempt_success(self, *, source_base: str = DEFAULT_SOURCE_BASE) -> None:
        """Record a verified unchanged 1C read without rebuilding indexes."""
        if not self._storage_enabled():
            return
        source = self._source_base(source_base)
        with app_session(self._database_url) as session:
            state = session.get(AppOneCCatalogSnapshot, source)
            if state is None or int(state.active_generation or 0) <= 0:
                return
            state.last_attempt_at = _now()
            state.last_error = ""

    def get_status(self, *, source_base: str = DEFAULT_SOURCE_BASE) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        source = self._source_base(source_base)
        try:
            if not self._storage_enabled():
                return None
            with app_session(self._database_url) as session:
                state = session.get(AppOneCCatalogSnapshot, source)
                if state is None:
                    return {
                        "storage": "app_db_indexed_snapshot",
                        "available": False,
                        "has_snapshot": False,
                        "source_base": source,
                        "nomenclature_count": 0,
                        "warehouses_count": 0,
                        "updated_at": "",
                        "last_attempt_at": "",
                        "last_error": "",
                        "nomenclature_truncated": False,
                        "warehouses_truncated": False,
                        "nomenclature_fingerprint": "",
                        "warehouses_fingerprint": "",
                    }
                return {
                    "storage": "app_db_indexed_snapshot",
                    "available": True,
                    "has_snapshot": bool(int(state.active_generation or 0) > 0 and state.updated_at is not None),
                    "source_base": source,
                    "generation": int(state.active_generation or 0),
                    "nomenclature_count": int(state.nomenclature_count or 0),
                    "warehouses_count": int(state.warehouses_count or 0),
                    "updated_at": state.updated_at.isoformat() if state.updated_at else "",
                    "last_attempt_at": state.last_attempt_at.isoformat() if state.last_attempt_at else "",
                    "last_error": _text(state.last_error, maximum=2_000),
                    "nomenclature_truncated": bool(state.nomenclature_truncated),
                    "warehouses_truncated": bool(state.warehouses_truncated),
                    "nomenclature_fingerprint": _text(state.nomenclature_fingerprint, maximum=64),
                    "warehouses_fingerprint": _text(state.warehouses_fingerprint, maximum=64),
                }
        except Exception as exc:
            logger.warning("1C app catalogue status is unavailable: %s", exc)
            return {
                "storage": "app_db_indexed_snapshot",
                "available": False,
                "has_snapshot": False,
                "source_base": source,
                "nomenclature_count": 0,
                "warehouses_count": 0,
                "updated_at": "",
                "last_attempt_at": "",
                "last_error": _text(exc, maximum=2_000),
                "nomenclature_truncated": False,
                "warehouses_truncated": False,
                "nomenclature_fingerprint": "",
                "warehouses_fingerprint": "",
            }

    def _read_snapshot(self, session, source_base: str) -> AppOneCCatalogSnapshot | None:
        return self._current_snapshot(session, source_base)

    def search_entries(
        self,
        *,
        catalog_type: str,
        text: str,
        limit: int,
        source_base: str = DEFAULT_SOURCE_BASE,
    ) -> tuple[bool, list[dict[str, str]]]:
        """Search the current generation with an AND token index query."""
        if not self._storage_enabled():
            return False, []
        source = self._source_base(source_base)
        kind = self._catalog_type(catalog_type)
        tokens = catalog_query_tokens(text)
        if not tokens:
            return True, []
        safe_limit = max(1, min(int(limit or 1), 1_000))
        try:
            with app_session(self._database_url) as session:
                state = self._read_snapshot(session, source)
                if state is None:
                    return False, []
                generation = int(state.active_generation)
                entry = AppOneCCatalogEntry
                conditions = [
                    entry.source_base == source,
                    entry.generation == generation,
                    entry.catalog_type == kind,
                ]
                for token in tokens:
                    pattern = f"%{_like_fragment(token)}%"
                    matching_entry_refs = select(AppOneCCatalogToken.entry_ref).where(
                        AppOneCCatalogToken.source_base == source,
                        AppOneCCatalogToken.generation == generation,
                        AppOneCCatalogToken.catalog_type == kind,
                        AppOneCCatalogToken.token.like(pattern, escape="\\"),
                    )
                    # Start from matching tokens so PostgreSQL can use the
                    # trigram GIN index for a leading-wildcard typeahead.
                    conditions.append(entry.ref.in_(matching_entry_refs))
                primary = tokens[0]
                primary_exact = exists(
                    select(1).where(
                        AppOneCCatalogToken.source_base == source,
                        AppOneCCatalogToken.generation == generation,
                        AppOneCCatalogToken.catalog_type == kind,
                        AppOneCCatalogToken.entry_ref == entry.ref,
                        AppOneCCatalogToken.token == primary,
                    )
                )
                primary_prefix = f"{_like_fragment(primary)}%"
                primary_starts = exists(
                    select(1).where(
                        AppOneCCatalogToken.source_base == source,
                        AppOneCCatalogToken.generation == generation,
                        AppOneCCatalogToken.catalog_type == kind,
                        AppOneCCatalogToken.entry_ref == entry.ref,
                        AppOneCCatalogToken.token.like(primary_prefix, escape="\\"),
                    )
                )
                relevance_rank = case(
                    (primary_exact, 0),
                    (
                        or_(
                            entry.name_normalized.like(primary_prefix, escape="\\"),
                            entry.code_normalized.like(primary_prefix, escape="\\"),
                            primary_starts,
                        ),
                        1,
                    ),
                    else_=2,
                )
                dialect_name = session.get_bind().dialect.name
                rows = session.execute(
                    select(entry.ref, entry.code, entry.name)
                    .where(*conditions)
                    .order_by(
                        relevance_rank,
                        self._stable_order_column(entry.name_normalized, dialect_name),
                        self._stable_order_column(entry.code_normalized, dialect_name),
                        self._stable_order_column(entry.ref, dialect_name),
                    )
                    .limit(safe_limit)
                ).all()
        except Exception as exc:
            logger.warning("1C app catalogue search is unavailable: %s", exc)
            return False, []
        if kind == CATALOG_WAREHOUSES:
            return True, [{"ref": str(row.ref), "name": str(row.name or "")} for row in rows]
        return True, [
            {"ref": str(row.ref), "code": str(row.code or ""), "name": str(row.name or "")}
            for row in rows
        ]

    def lookup_entry(
        self,
        *,
        catalog_type: str,
        ref: str,
        source_base: str = DEFAULT_SOURCE_BASE,
    ) -> tuple[bool, dict[str, str] | None]:
        """Return ``(available, entry)`` for an exact immutable 1C ref."""
        if not self._storage_enabled():
            return False, None
        source = self._source_base(source_base)
        kind = self._catalog_type(catalog_type)
        normalized_ref = _text(ref, maximum=64)
        if not normalized_ref:
            return True, None
        try:
            with app_session(self._database_url) as session:
                state = self._read_snapshot(session, source)
                if state is None:
                    return False, None
                row = session.execute(
                    select(AppOneCCatalogEntry.ref, AppOneCCatalogEntry.code, AppOneCCatalogEntry.name).where(
                        AppOneCCatalogEntry.source_base == source,
                        AppOneCCatalogEntry.generation == int(state.active_generation),
                        AppOneCCatalogEntry.catalog_type == kind,
                        AppOneCCatalogEntry.ref == normalized_ref,
                    )
                ).first()
        except Exception as exc:
            logger.warning("1C app catalogue lookup is unavailable: %s", exc)
            return False, None
        if row is None:
            return True, None
        if kind == CATALOG_WAREHOUSES:
            return True, {"ref": str(row.ref), "name": str(row.name or "")}
        return True, {"ref": str(row.ref), "code": str(row.code or ""), "name": str(row.name or "")}

    def lookup_nomenclature_codes(
        self,
        codes: Iterable[str],
        *,
        source_base: str = DEFAULT_SOURCE_BASE,
    ) -> tuple[bool, dict[str, dict[str, str]]]:
        """Resolve exact 1C nomenclature codes in one indexed query."""
        if not self._storage_enabled():
            return False, {}
        source = self._source_base(source_base)
        normalized_codes = sorted({_normalized(value, maximum=200) for value in codes if _normalized(value, maximum=200)})
        if not normalized_codes:
            return True, {}
        try:
            with app_session(self._database_url) as session:
                state = self._read_snapshot(session, source)
                if state is None:
                    return False, {}
                rows = session.execute(
                    select(AppOneCCatalogEntry.ref, AppOneCCatalogEntry.code, AppOneCCatalogEntry.name).where(
                        AppOneCCatalogEntry.source_base == source,
                        AppOneCCatalogEntry.generation == int(state.active_generation),
                        AppOneCCatalogEntry.catalog_type == CATALOG_NOMENCLATURE,
                        AppOneCCatalogEntry.code_normalized.in_(normalized_codes),
                    )
                ).all()
        except Exception as exc:
            logger.warning("1C app catalogue code lookup is unavailable: %s", exc)
            return False, {}
        return True, {
            _normalized(row.code, maximum=200): {
                "ref": str(row.ref),
                "code": str(row.code or ""),
                "name": str(row.name or ""),
            }
            for row in rows
        }

    def token_frequencies(
        self,
        *,
        catalog_type: str,
        tokens: Iterable[str],
        source_base: str = DEFAULT_SOURCE_BASE,
    ) -> tuple[bool, dict[str, int]]:
        """Return indexed exact-token document frequencies for suggestion rank."""
        if not self._storage_enabled():
            return False, {}
        source = self._source_base(source_base)
        kind = self._catalog_type(catalog_type)
        normalized_tokens = sorted({token for value in tokens for token in catalog_search_tokens(value)})
        if not normalized_tokens:
            return True, {}
        try:
            with app_session(self._database_url) as session:
                state = self._read_snapshot(session, source)
                if state is None:
                    return False, {}
                rows = session.execute(
                    select(AppOneCCatalogToken.token, AppOneCCatalogToken.entry_ref)
                    .where(
                        AppOneCCatalogToken.source_base == source,
                        AppOneCCatalogToken.generation == int(state.active_generation),
                        AppOneCCatalogToken.catalog_type == kind,
                        AppOneCCatalogToken.token.in_(normalized_tokens),
                    )
                ).all()
        except Exception as exc:
            logger.warning("1C app catalogue token frequency is unavailable: %s", exc)
            return False, {}
        result: dict[str, set[str]] = {}
        for row in rows:
            result.setdefault(str(row.token), set()).add(str(row.entry_ref))
        return True, {token: len(refs) for token, refs in result.items()}
