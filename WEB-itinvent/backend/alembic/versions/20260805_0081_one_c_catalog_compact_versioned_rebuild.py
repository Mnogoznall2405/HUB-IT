"""Versioned compact search rebuild columns + name prefix index.

Revision ID: 20260805_0081
Revises: 20260804_0080
Create Date: 2026-08-05 00:30:00.000000

Adds ``index_version`` namespaces so a next search version can build while the
active version keeps serving, plus state pointer / fingerprint fields for the
4h sync rebuild lifecycle.

**Do NOT apply on production without a separate approval.** Safe to apply on
allowed test DBs only (`hubit_chat_retention_test_%` / `hubit_chat_1c_search_test_%`).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260805_0081"
down_revision = "20260804_0080"
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


def _column_names(table_name: str, schema: str | None) -> set[str]:
    if not _table_exists(table_name, schema):
        return set()
    return {
        str(col["name"])
        for col in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


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

    if not _table_exists(STATE_TABLE, schema):
        return

    state_cols = _column_names(STATE_TABLE, schema)
    for name, col in (
        ("active_index_version", sa.Column("active_index_version", sa.Integer(), nullable=False, server_default="0")),
        ("building_index_version", sa.Column("building_index_version", sa.Integer(), nullable=False, server_default="0")),
        ("previous_index_version", sa.Column("previous_index_version", sa.Integer(), nullable=False, server_default="0")),
        ("source_fingerprint", sa.Column("source_fingerprint", sa.String(length=64), nullable=False, server_default="")),
        ("previous_cleanup_after", sa.Column("previous_cleanup_after", sa.DateTime(timezone=True), nullable=True)),
    ):
        if name not in state_cols:
            op.add_column(STATE_TABLE, col, schema=schema)

    if _table_exists(DOC_TABLE, schema):
        doc_cols = _column_names(DOC_TABLE, schema)
        if "index_version" not in doc_cols:
            op.add_column(
                DOC_TABLE,
                sa.Column("index_version", sa.Integer(), nullable=False, server_default="1"),
                schema=schema,
            )
        # Replace unique key to include index_version namespace.
        # Old: (source_base, generation, catalog_type, entry_ref)
        # New: (source_base, catalog_type, index_version, entry_ref)
        if is_pg:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{DOC_TABLE}" '
                    f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_documents_ref'
                )
            )
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{DOC_TABLE}" '
                    f'ADD CONSTRAINT uq_app_one_c_catalog_search_documents_ref '
                    f'UNIQUE (source_base, catalog_type, index_version, entry_ref)'
                )
            )
        else:
            # SQLite / portable path: recreate unique via batch if present.
            existing = _index_names(DOC_TABLE, schema)
            if "uq_app_one_c_catalog_search_documents_ref" in existing:
                op.drop_constraint(
                    "uq_app_one_c_catalog_search_documents_ref",
                    DOC_TABLE,
                    schema=schema,
                    type_="unique",
                )
            op.create_unique_constraint(
                "uq_app_one_c_catalog_search_documents_ref",
                DOC_TABLE,
                ["source_base", "catalog_type", "index_version", "entry_ref"],
                schema=schema,
            )

    if _table_exists(STATS_TABLE, schema):
        stats_cols = _column_names(STATS_TABLE, schema)
        if "index_version" not in stats_cols:
            op.add_column(
                STATS_TABLE,
                sa.Column("index_version", sa.Integer(), nullable=False, server_default="1"),
                schema=schema,
            )
        if is_pg:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{STATS_TABLE}" '
                    f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_token_stats'
                )
            )
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{STATS_TABLE}" '
                    f'ADD CONSTRAINT uq_app_one_c_catalog_search_token_stats '
                    f'UNIQUE (source_base, catalog_type, index_version, token)'
                )
            )
        else:
            existing = _index_names(STATS_TABLE, schema)
            if "uq_app_one_c_catalog_search_token_stats" in existing:
                op.drop_constraint(
                    "uq_app_one_c_catalog_search_token_stats",
                    STATS_TABLE,
                    schema=schema,
                    type_="unique",
                )
            op.create_unique_constraint(
                "uq_app_one_c_catalog_search_token_stats",
                STATS_TABLE,
                ["source_base", "catalog_type", "index_version", "token"],
                schema=schema,
            )

    # Seed active_index_version from existing ready rows (legacy single-version).
    if is_pg:
        op.execute(
            sa.text(
                f"""
                UPDATE "{SCHEMA}"."{STATE_TABLE}"
                SET active_index_version = 1,
                    source_fingerprint = COALESCE(NULLIF(checksum, ''), source_fingerprint)
                WHERE status = 'ready'
                  AND coalesce(active_index_version, 0) = 0
                  AND coalesce(indexed_count, 0) > 0
                """
            )
        )

    if not is_pg:
        # Portable btree for name prefix tests.
        existing_docs = _index_names(DOC_TABLE, schema)
        if "ix_app_one_c_catalog_search_documents_name_prefix" not in existing_docs:
            op.create_index(
                "ix_app_one_c_catalog_search_documents_name_prefix",
                DOC_TABLE,
                ["source_base", "catalog_type", "index_version", "name_normalized"],
                schema=schema,
            )
        return

    assert schema is not None
    # Recreate code index with index_version in leading columns.
    with op.get_context().autocommit_block():
        op.execute(
            sa.text(
                f'DROP INDEX CONCURRENTLY IF EXISTS '
                f'"{schema}"."ix_app_one_c_catalog_search_documents_code"'
            )
        )
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_documents_code" '
            f'ON "{schema}"."{DOC_TABLE}" '
            f"(source_base, catalog_type, index_version, "
            f"code_normalized varchar_pattern_ops)"
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_documents_code"',
        "ix_app_one_c_catalog_search_documents_code",
    )
    # Name/model prefix: varchar_pattern_ops for LIKE 'abc%'.
    # Grammar: (expression) opclass — not (expression opclass).
    _create_index_concurrently(
        schema,
        (
            f'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            f'"ix_app_one_c_catalog_search_documents_name_prefix" '
            f'ON "{schema}"."{DOC_TABLE}" '
            f"(source_base, catalog_type, index_version, "
            f"(left(name_normalized, 200)) varchar_pattern_ops)"
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_documents_name_prefix"',
        "ix_app_one_c_catalog_search_documents_name_prefix",
    )
    # token_stats prefix needs index_version + pattern_ops.
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
            f"(source_base, catalog_type, index_version, token varchar_pattern_ops)"
        ),
        f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."ix_app_one_c_catalog_search_token_stats_prefix"',
        "ix_app_one_c_catalog_search_token_stats_prefix",
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if not _table_exists(STATE_TABLE, schema):
        return

    if is_pg and schema is not None:
        for index_name in (
            "ix_app_one_c_catalog_search_documents_name_prefix",
            "ix_app_one_c_catalog_search_token_stats_prefix",
        ):
            with op.get_context().autocommit_block():
                op.execute(
                    sa.text(f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{index_name}"')
                )
        # Restore pre-0081 code index shape (best-effort).
        with op.get_context().autocommit_block():
            op.execute(
                sa.text(
                    f'DROP INDEX CONCURRENTLY IF EXISTS '
                    f'"{schema}"."ix_app_one_c_catalog_search_documents_code"'
                )
            )
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

    if _table_exists(DOC_TABLE, schema) and "index_version" in _column_names(DOC_TABLE, schema):
        if is_pg:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{DOC_TABLE}" '
                    f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_documents_ref'
                )
            )
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{DOC_TABLE}" '
                    f'ADD CONSTRAINT uq_app_one_c_catalog_search_documents_ref '
                    f'UNIQUE (source_base, generation, catalog_type, entry_ref)'
                )
            )
        op.drop_column(DOC_TABLE, "index_version", schema=schema)

    if _table_exists(STATS_TABLE, schema) and "index_version" in _column_names(STATS_TABLE, schema):
        if is_pg:
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{STATS_TABLE}" '
                    f'DROP CONSTRAINT IF EXISTS uq_app_one_c_catalog_search_token_stats'
                )
            )
            op.execute(
                sa.text(
                    f'ALTER TABLE "{SCHEMA}"."{STATS_TABLE}" '
                    f'ADD CONSTRAINT uq_app_one_c_catalog_search_token_stats '
                    f'UNIQUE (source_base, generation, catalog_type, token)'
                )
            )
        op.drop_column(STATS_TABLE, "index_version", schema=schema)

    state_cols = _column_names(STATE_TABLE, schema)
    for name in (
        "previous_cleanup_after",
        "source_fingerprint",
        "previous_index_version",
        "building_index_version",
        "active_index_version",
    ):
        if name in state_cols:
            op.drop_column(STATE_TABLE, name, schema=schema)
