"""Add compact (D-lite) 1C catalogue search derived tables.

Revision ID: 20260804_0080
Revises: 20260804_0079
Create Date: 2026-08-04 23:30:00.000000

Derived tables only — does not alter ``one_c_catalog_entries`` /
``one_c_catalog_tokens``.  Feature flags keep production on the token engine
until an explicit, separately approved cutover.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0080"
down_revision = "20260804_0079"
branch_labels = None
depends_on = None

SCHEMA = "app"
DOC_TABLE = "one_c_catalog_search_documents"
STATS_TABLE = "one_c_catalog_search_token_stats"
STATE_TABLE = "one_c_catalog_search_index_state"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return SCHEMA if op.get_bind().dialect.name == "postgresql" else None


def _table_exists(table_name: str, schema: str | None) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(table_name: str, schema: str | None) -> set[str]:
    if not _table_exists(table_name, schema):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _pg_index_validity(schema: str, index_name: str) -> tuple[bool, bool] | None:
    row = op.get_bind().execute(
        sa.text(
            """
            SELECT i.indisvalid, i.indisready
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_index i ON i.indexrelid = c.oid
            WHERE n.nspname = :schema
              AND c.relname = :index_name
            """
        ),
        {"schema": schema, "index_name": index_name},
    ).first()
    if row is None:
        return None
    return bool(row[0]), bool(row[1])


def _create_index_concurrently(schema: str, create_sql: str, drop_sql: str, index_name: str) -> None:
    with op.get_context().autocommit_block():
        validity = _pg_index_validity(schema, index_name)
        if validity is not None:
            is_valid, _is_ready = validity
            if not is_valid:
                op.execute(sa.text(drop_sql))
            else:
                return
        op.execute(sa.text(create_sql))
        validity_after = _pg_index_validity(schema, index_name)
        if validity_after is None or not validity_after[0]:
            raise RuntimeError(
                f"Failed to create a valid index {schema}.{index_name} "
                "via CREATE INDEX CONCURRENTLY."
            )


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if not _table_exists(DOC_TABLE, schema):
        if is_pg:
            op.execute(sa.text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
            op.execute(
                sa.text(
                    f"""
                    CREATE TABLE {SCHEMA}.{DOC_TABLE} (
                        id BIGSERIAL PRIMARY KEY,
                        source_base VARCHAR(64) NOT NULL,
                        generation INTEGER NOT NULL,
                        catalog_type VARCHAR(16) NOT NULL,
                        entry_ref VARCHAR(64) NOT NULL,
                        code_normalized VARCHAR(200) NOT NULL DEFAULT '',
                        name_normalized TEXT NOT NULL DEFAULT '',
                        search_text TEXT NOT NULL DEFAULT '',
                        search_tsv tsvector NOT NULL DEFAULT ''::tsvector,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT uq_app_one_c_catalog_search_documents_ref
                            UNIQUE (source_base, generation, catalog_type, entry_ref)
                    )
                    """
                )
            )
        else:
            op.create_table(
                DOC_TABLE,
                sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
                sa.Column("source_base", sa.String(length=64), nullable=False),
                sa.Column("generation", sa.Integer(), nullable=False),
                sa.Column("catalog_type", sa.String(length=16), nullable=False),
                sa.Column("entry_ref", sa.String(length=64), nullable=False),
                sa.Column("code_normalized", sa.String(length=200), nullable=False, server_default=""),
                sa.Column("name_normalized", sa.Text(), nullable=False, server_default=""),
                sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
                sa.Column("search_tsv", sa.Text(), nullable=False, server_default=""),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
                sa.UniqueConstraint(
                    "source_base",
                    "generation",
                    "catalog_type",
                    "entry_ref",
                    name="uq_app_one_c_catalog_search_documents_ref",
                ),
                schema=schema,
            )

    if not _table_exists(STATS_TABLE, schema):
        op.create_table(
            STATS_TABLE,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source_base", sa.String(length=64), nullable=False),
            sa.Column("generation", sa.Integer(), nullable=False),
            sa.Column("catalog_type", sa.String(length=16), nullable=False),
            sa.Column("token", sa.String(length=200), nullable=False),
            sa.Column("frequency", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint(
                "source_base",
                "generation",
                "catalog_type",
                "token",
                name="uq_app_one_c_catalog_search_token_stats",
            ),
            schema=schema,
        )

    if not _table_exists(STATE_TABLE, schema):
        op.create_table(
            STATE_TABLE,
            sa.Column("source_base", sa.String(length=64), primary_key=True),
            sa.Column("catalog_type", sa.String(length=16), primary_key=True),
            sa.Column("generation", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=16), nullable=False, server_default="building"),
            sa.Column("expected_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("indexed_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("build_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("checksum", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("checkpoint_ref", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("checkpoint_offset", sa.Integer(), nullable=False, server_default="0"),
            schema=schema,
        )

    if not is_pg:
        # Portable btree indexes for SQLite / non-PG test paths.
        # No separate documents_scope index: code index leading columns cover scope.
        existing_docs = _index_names(DOC_TABLE, schema)
        if "ix_app_one_c_catalog_search_documents_code" not in existing_docs:
            op.create_index(
                "ix_app_one_c_catalog_search_documents_code",
                DOC_TABLE,
                ["source_base", "generation", "catalog_type", "code_normalized"],
                schema=schema,
            )
        # SQLite: unique covers equality; keep a simple prefix twin for LIKE tests.
        existing_stats = _index_names(STATS_TABLE, schema)
        if "ix_app_one_c_catalog_search_token_stats_prefix" not in existing_stats:
            op.create_index(
                "ix_app_one_c_catalog_search_token_stats_prefix",
                STATS_TABLE,
                ["source_base", "generation", "catalog_type", "token"],
                schema=schema,
            )
        return

    assert schema is not None
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # Drop unused scope index if an earlier draft created it (code prefix covers it).
    with op.get_context().autocommit_block():
        op.execute(
            sa.text(
                f'DROP INDEX CONCURRENTLY IF EXISTS '
                f'"{schema}"."ix_app_one_c_catalog_search_documents_scope"'
            )
        )

    # btree exact/prefix code path — also serves scope filters via leading cols
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_documents_code" '
            f'ON "{schema}"."{DOC_TABLE}" '
            f"(source_base, generation, catalog_type, code_normalized)"
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_documents_code"',
        "ix_app_one_c_catalog_search_documents_code",
    )
    # FTS (simple config lexemes via to_tsvector at write time)
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_documents_tsv" '
            f'ON "{schema}"."{DOC_TABLE}" USING gin (search_tsv)'
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_documents_tsv"',
        "ix_app_one_c_catalog_search_documents_tsv",
    )
    # mid-token / trigram fallback on search_text — NOT on text[]
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_documents_trgm" '
            f'ON "{schema}"."{DOC_TABLE}" USING gin (search_text gin_trgm_ops)'
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_documents_trgm"',
        "ix_app_one_c_catalog_search_documents_trgm",
    )
    # token_stats LIKE 'abc%' needs varchar_pattern_ops (unique alone is for =).
    # Drop a prior non-pattern prefix twin if present, then create pattern_ops.
    with op.get_context().autocommit_block():
        op.execute(
            sa.text(
                f'DROP INDEX CONCURRENTLY IF EXISTS '
                f'"{schema}"."ix_app_one_c_catalog_search_token_stats_prefix"'
            )
        )
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_token_stats_prefix" '
            f'ON "{schema}"."{STATS_TABLE}" '
            f"(source_base, generation, catalog_type, token varchar_pattern_ops)"
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_token_stats_prefix"',
        "ix_app_one_c_catalog_search_token_stats_prefix",
    )
    # typo candidates via trigram on compact token_stats only
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_token_stats_trgm" '
            f'ON "{schema}"."{STATS_TABLE}" USING gin (token gin_trgm_ops)'
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_token_stats_trgm"',
        "ix_app_one_c_catalog_search_token_stats_trgm",
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    indexes = [
        ("ix_app_one_c_catalog_search_token_stats_trgm", STATS_TABLE),
        ("ix_app_one_c_catalog_search_token_stats_prefix", STATS_TABLE),
        ("ix_app_one_c_catalog_search_documents_trgm", DOC_TABLE),
        ("ix_app_one_c_catalog_search_documents_tsv", DOC_TABLE),
        # legacy draft name — drop if present
        ("ix_app_one_c_catalog_search_documents_scope", DOC_TABLE),
        ("ix_app_one_c_catalog_search_documents_code", DOC_TABLE),
    ]
    if is_pg and schema is not None:
        for index_name, _table in indexes:
            with op.get_context().autocommit_block():
                op.execute(
                    sa.text(f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{index_name}"')
                )
    else:
        for index_name, table_name in indexes:
            if index_name in _index_names(table_name, schema):
                op.drop_index(index_name, table_name=table_name, schema=schema)

    if _table_exists(STATE_TABLE, schema):
        op.drop_table(STATE_TABLE, schema=schema)
    if _table_exists(STATS_TABLE, schema):
        op.drop_table(STATS_TABLE, schema=schema)
    if _table_exists(DOC_TABLE, schema):
        op.drop_table(DOC_TABLE, schema=schema)
