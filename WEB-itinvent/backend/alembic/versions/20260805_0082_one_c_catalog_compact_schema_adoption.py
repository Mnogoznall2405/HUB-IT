"""Adopt / align 1C compact search schema (0080+0081 target shape).

Revision ID: 20260805_0082
Revises: 20260805_0081
Create Date: 2026-08-05 10:00:00.000000

Resolves empty / partially-created compact tables vs missing Alembic 0080/0081
history without rewriting those revisions.

Modes (auto-detected):
  A — tables missing → create target shape (columns + light uniques; NO heavy
      GIN/CONCURRENTLY indexes in this revision)
  B — tables exist, empty, compatible → add missing columns/constraints only
  C — incompatible shape (wrong types / conflicting unique keys with data) → ABORT

Heavy indexes (GIN tsv/trgm, pattern_ops recreates) are **deferred** to a
separately approved ``CREATE INDEX CONCURRENTLY`` ops step — see
``scripts/one_c_compact_schema_preflight.py`` and the final closure report.

**Do NOT apply on production without separate approval.** Safe on allowed
test DBs only. CAS fingerprint ordering does not require a patch ledger;
no applied-events table is introduced here.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0082"
down_revision = "20260805_0081"
branch_labels = None
depends_on = None

SCHEMA = "app"
DOC_TABLE = "one_c_catalog_search_documents"
STATS_TABLE = "one_c_catalog_search_token_stats"
STATE_TABLE = "one_c_catalog_search_index_state"

REQUIRED_DOC_COLS = {
    "id",
    "source_base",
    "generation",
    "catalog_type",
    "index_version",
    "entry_ref",
    "code_normalized",
    "name_normalized",
    "search_text",
    "search_tsv",
    "created_at",
    "updated_at",
}
REQUIRED_STATS_COLS = {
    "id",
    "source_base",
    "generation",
    "catalog_type",
    "index_version",
    "token",
    "frequency",
    "updated_at",
}
REQUIRED_STATE_COLS = {
    "source_base",
    "catalog_type",
    "generation",
    "status",
    "expected_count",
    "indexed_count",
    "build_version",
    "checksum",
    "last_error",
    "started_at",
    "finished_at",
    "updated_at",
    "checkpoint_ref",
    "checkpoint_offset",
    "active_index_version",
    "building_index_version",
    "previous_index_version",
    "source_fingerprint",
    "previous_cleanup_after",
}


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return SCHEMA if op.get_bind().dialect.name == "postgresql" else None


def _table_exists(table_name: str, schema: str | None) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _column_names(table_name: str, schema: str | None) -> set[str]:
    if not _table_exists(table_name, schema):
        return set()
    return {
        str(col["name"])
        for col in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def _table_row_count(table_name: str, schema: str | None) -> int:
    if not _table_exists(table_name, schema):
        return 0
    qual = f'"{schema}"."{table_name}"' if schema else f'"{table_name}"'
    return int(op.get_bind().execute(sa.text(f"SELECT COUNT(*) FROM {qual}")).scalar_one())


def _detect_mode(schema: str | None) -> str:
    """Return A | B | C."""
    docs = _table_exists(DOC_TABLE, schema)
    stats = _table_exists(STATS_TABLE, schema)
    state = _table_exists(STATE_TABLE, schema)
    if not docs and not stats and not state:
        return "A"
    # Partial missing → treat as adoption with create-missing (still A-ish / B).
    if not (docs and stats and state):
        # If any existing table has incompatible required-overlap, abort.
        if docs:
            cols = _column_names(DOC_TABLE, schema)
            # Conflicting: has entry_ref but search_tsv is wrong type — checked below.
            if cols and "entry_ref" not in cols and "id" in cols:
                return "C"
        return "B" if (docs or stats or state) else "A"

    doc_cols = _column_names(DOC_TABLE, schema)
    stats_cols = _column_names(STATS_TABLE, schema)
    state_cols = _column_names(STATE_TABLE, schema)
    # Incompatible: core identity columns missing while table non-empty.
    docs_n = _table_row_count(DOC_TABLE, schema)
    if docs_n > 0 and "entry_ref" not in doc_cols:
        return "C"
    if docs_n > 0 and "source_base" not in doc_cols:
        return "C"
    # Compatible empty or missing additive columns → B.
    missing = (
        (REQUIRED_DOC_COLS - doc_cols)
        | (REQUIRED_STATS_COLS - stats_cols)
        | (REQUIRED_STATE_COLS - state_cols)
    )
    if missing or docs_n == 0:
        return "B"
    # Fully present — no-op adopt.
    return "B"


def _create_fresh_pg(schema: str) -> None:
    op.execute(sa.text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    op.execute(
        sa.text(
            f"""
            CREATE TABLE IF NOT EXISTS "{schema}"."{DOC_TABLE}" (
                id BIGSERIAL PRIMARY KEY,
                source_base VARCHAR(64) NOT NULL,
                generation INTEGER NOT NULL,
                catalog_type VARCHAR(16) NOT NULL,
                index_version INTEGER NOT NULL DEFAULT 1,
                entry_ref VARCHAR(64) NOT NULL,
                code_normalized VARCHAR(200) NOT NULL DEFAULT '',
                name_normalized TEXT NOT NULL DEFAULT '',
                search_text TEXT NOT NULL DEFAULT '',
                search_tsv tsvector NOT NULL DEFAULT ''::tsvector,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_app_one_c_catalog_search_documents_ref
                    UNIQUE (source_base, catalog_type, index_version, entry_ref)
            )
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE TABLE IF NOT EXISTS "{schema}"."{STATS_TABLE}" (
                id BIGSERIAL PRIMARY KEY,
                source_base VARCHAR(64) NOT NULL,
                generation INTEGER NOT NULL,
                catalog_type VARCHAR(16) NOT NULL,
                index_version INTEGER NOT NULL DEFAULT 1,
                token VARCHAR(200) NOT NULL,
                frequency INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_app_one_c_catalog_search_token_stats
                    UNIQUE (source_base, catalog_type, index_version, token)
            )
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE TABLE IF NOT EXISTS "{schema}"."{STATE_TABLE}" (
                source_base VARCHAR(64) NOT NULL,
                catalog_type VARCHAR(16) NOT NULL,
                generation INTEGER NOT NULL DEFAULT 0,
                status VARCHAR(16) NOT NULL DEFAULT 'building',
                expected_count INTEGER NOT NULL DEFAULT 0,
                indexed_count INTEGER NOT NULL DEFAULT 0,
                build_version INTEGER NOT NULL DEFAULT 0,
                checksum VARCHAR(64) NOT NULL DEFAULT '',
                last_error TEXT NOT NULL DEFAULT '',
                started_at TIMESTAMPTZ NULL,
                finished_at TIMESTAMPTZ NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                checkpoint_ref VARCHAR(64) NOT NULL DEFAULT '',
                checkpoint_offset INTEGER NOT NULL DEFAULT 0,
                active_index_version INTEGER NOT NULL DEFAULT 0,
                building_index_version INTEGER NOT NULL DEFAULT 0,
                previous_index_version INTEGER NOT NULL DEFAULT 0,
                source_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
                previous_cleanup_after TIMESTAMPTZ NULL,
                PRIMARY KEY (source_base, catalog_type)
            )
            """
        )
    )
    # Light btree only — heavy GIN/pattern recreates are a separate ops step.
    op.execute(
        sa.text(
            f"""
            CREATE INDEX IF NOT EXISTS
            "ix_app_one_c_catalog_search_documents_code"
            ON "{schema}"."{DOC_TABLE}"
            (source_base, catalog_type, index_version, code_normalized)
            """
        )
    )


def _add_missing_columns_pg(schema: str) -> None:
    if _table_exists(DOC_TABLE, schema):
        cols = _column_names(DOC_TABLE, schema)
        if "index_version" not in cols:
            op.add_column(
                DOC_TABLE,
                sa.Column("index_version", sa.Integer(), nullable=False, server_default="1"),
                schema=schema,
            )
    else:
        # Create missing table via fresh helper fragment.
        _create_fresh_pg(schema)
        return

    if _table_exists(STATS_TABLE, schema):
        cols = _column_names(STATS_TABLE, schema)
        if "index_version" not in cols:
            op.add_column(
                STATS_TABLE,
                sa.Column("index_version", sa.Integer(), nullable=False, server_default="1"),
                schema=schema,
            )
    else:
        op.execute(
            sa.text(
                f"""
                CREATE TABLE "{schema}"."{STATS_TABLE}" (
                    id BIGSERIAL PRIMARY KEY,
                    source_base VARCHAR(64) NOT NULL,
                    generation INTEGER NOT NULL,
                    catalog_type VARCHAR(16) NOT NULL,
                    index_version INTEGER NOT NULL DEFAULT 1,
                    token VARCHAR(200) NOT NULL,
                    frequency INTEGER NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_app_one_c_catalog_search_token_stats
                        UNIQUE (source_base, catalog_type, index_version, token)
                )
                """
            )
        )

    if _table_exists(STATE_TABLE, schema):
        cols = _column_names(STATE_TABLE, schema)
        for name, col in (
            ("active_index_version", sa.Column("active_index_version", sa.Integer(), nullable=False, server_default="0")),
            ("building_index_version", sa.Column("building_index_version", sa.Integer(), nullable=False, server_default="0")),
            ("previous_index_version", sa.Column("previous_index_version", sa.Integer(), nullable=False, server_default="0")),
            ("source_fingerprint", sa.Column("source_fingerprint", sa.String(length=64), nullable=False, server_default="")),
            ("previous_cleanup_after", sa.Column("previous_cleanup_after", sa.DateTime(timezone=True), nullable=True)),
            ("checkpoint_ref", sa.Column("checkpoint_ref", sa.String(length=64), nullable=False, server_default="")),
            ("checkpoint_offset", sa.Column("checkpoint_offset", sa.Integer(), nullable=False, server_default="0")),
        ):
            if name not in cols:
                op.add_column(STATE_TABLE, col, schema=schema)
    else:
        op.execute(
            sa.text(
                f"""
                CREATE TABLE "{schema}"."{STATE_TABLE}" (
                    source_base VARCHAR(64) NOT NULL,
                    catalog_type VARCHAR(16) NOT NULL,
                    generation INTEGER NOT NULL DEFAULT 0,
                    status VARCHAR(16) NOT NULL DEFAULT 'building',
                    expected_count INTEGER NOT NULL DEFAULT 0,
                    indexed_count INTEGER NOT NULL DEFAULT 0,
                    build_version INTEGER NOT NULL DEFAULT 0,
                    checksum VARCHAR(64) NOT NULL DEFAULT '',
                    last_error TEXT NOT NULL DEFAULT '',
                    started_at TIMESTAMPTZ NULL,
                    finished_at TIMESTAMPTZ NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    checkpoint_ref VARCHAR(64) NOT NULL DEFAULT '',
                    checkpoint_offset INTEGER NOT NULL DEFAULT 0,
                    active_index_version INTEGER NOT NULL DEFAULT 0,
                    building_index_version INTEGER NOT NULL DEFAULT 0,
                    previous_index_version INTEGER NOT NULL DEFAULT 0,
                    source_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
                    previous_cleanup_after TIMESTAMPTZ NULL,
                    PRIMARY KEY (source_base, catalog_type)
                )
                """
            )
        )

    # Ensure versioned unique constraints when tables are empty (safe reshape).
    docs_n = _table_row_count(DOC_TABLE, schema)
    stats_n = _table_row_count(STATS_TABLE, schema)
    if docs_n == 0:
        op.execute(
            sa.text(
                f'ALTER TABLE "{schema}"."{DOC_TABLE}" '
                f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_documents_ref'
            )
        )
        op.execute(
            sa.text(
                f'ALTER TABLE "{schema}"."{DOC_TABLE}" '
                f'ADD CONSTRAINT uq_app_one_c_catalog_search_documents_ref '
                f'UNIQUE (source_base, catalog_type, index_version, entry_ref)'
            )
        )
    if stats_n == 0:
        op.execute(
            sa.text(
                f'ALTER TABLE "{schema}"."{STATS_TABLE}" '
                f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_token_stats'
            )
        )
        op.execute(
            sa.text(
                f'ALTER TABLE "{schema}"."{STATS_TABLE}" '
                f'ADD CONSTRAINT uq_app_one_c_catalog_search_token_stats '
                f'UNIQUE (source_base, catalog_type, index_version, token)'
            )
        )


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if not is_pg:
        # Non-PG: best-effort create_all-compatible columns via 0080/0081 chain.
        return

    assert schema is not None
    mode = _detect_mode(schema)
    if mode == "C":
        raise RuntimeError(
            "1C compact schema adoption ABORT (mode C): incompatible compact "
            "table shape with existing rows. Manual review required; refusing "
            "to rewrite. Heavy indexes are never auto-dropped here."
        )
    if mode == "A":
        _create_fresh_pg(schema)
        return
    # Mode B
    _add_missing_columns_pg(schema)


def downgrade() -> None:
    # Non-destructive: adoption does not drop compact tables on downgrade.
    if _scope() == "chat":
        return
    return
