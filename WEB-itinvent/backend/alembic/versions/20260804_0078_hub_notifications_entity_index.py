"""Add hub_notifications (entity_type, entity_id) index for entity DELETE/mark-read.

Revision ID: 20260804_0078
Revises: 20260804_0077
Create Date: 2026-08-04 12:50:00.000000

PostgreSQL: CREATE INDEX CONCURRENTLY outside the normal transaction block.
SQLite/dev: regular CREATE INDEX IF NOT EXISTS (no CONCURRENTLY).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0078"
down_revision = "20260804_0077"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_notifications"
INDEX_NAME = "idx_hub_notifications_entity"
INDEX_COLUMNS = ("entity_type", "entity_id")


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _qualified_table(schema: str | None) -> str:
    if schema:
        return f'"{schema}"."{TABLE_NAME}"'
    return f'"{TABLE_NAME}"'


def _has_table(schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE_NAME, schema=schema)


def _index_row(schema: str | None) -> dict | None:
    if not _has_table(schema):
        return None
    for item in sa.inspect(op.get_bind()).get_indexes(TABLE_NAME, schema=schema):
        if str(item.get("name") or "").strip().lower() == INDEX_NAME.lower():
            return dict(item)
    return None


def _pg_index_validity(schema: str) -> tuple[bool, bool] | None:
    """Return (indisvalid, indisready) or None if index row is absent."""
    bind = op.get_bind()
    row = bind.execute(
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
        {"schema": schema, "index_name": INDEX_NAME},
    ).first()
    if row is None:
        return None
    return bool(row[0]), bool(row[1])


def _create_index_postgresql(schema: str) -> None:
    table = _qualified_table(schema)
    columns_sql = ", ".join(INDEX_COLUMNS)
    create_sql = (
        f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{INDEX_NAME}" '
        f"ON {table} ({columns_sql})"
    )
    drop_sql = f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{INDEX_NAME}"'

    with op.get_context().autocommit_block():
        validity = _pg_index_validity(schema)
        if validity is not None:
            is_valid, _is_ready = validity
            if not is_valid:
                op.execute(sa.text(drop_sql))
            else:
                return
        op.execute(sa.text(create_sql))
        validity_after = _pg_index_validity(schema)
        if validity_after is None or not validity_after[0]:
            raise RuntimeError(
                "Failed to create a valid index "
                f'{schema}.{INDEX_NAME} via CREATE INDEX CONCURRENTLY. '
                "An interrupted concurrent build leaves an INVALID index that "
                "blocks CREATE INDEX IF NOT EXISTS. Recover with:\n"
                f"  1) SELECT c.relname, i.indisvalid, i.indisready\n"
                f"       FROM pg_class c\n"
                f"       JOIN pg_namespace n ON n.oid = c.relnamespace\n"
                f"       JOIN pg_index i ON i.indexrelid = c.oid\n"
                f"      WHERE n.nspname = '{schema}' AND c.relname = '{INDEX_NAME}';\n"
                f'  2) DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{INDEX_NAME}";\n'
                "  3) Re-run: alembic -c backend/alembic.ini upgrade head\n"
                "Do not start/restart backend until the index is valid; "
                "HubService fail-fast requires idx_hub_notifications_entity."
            )


def _create_index_sqlite() -> None:
    if _index_row(None) is not None:
        return
    op.create_index(INDEX_NAME, TABLE_NAME, list(INDEX_COLUMNS), unique=False, schema=None)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema):
        return
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        assert schema is not None
        _create_index_postgresql(schema)
        return
    _create_index_sqlite()


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema):
        return
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        assert schema is not None
        with op.get_context().autocommit_block():
            op.execute(sa.text(f'DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{INDEX_NAME}"'))
        return
    if _index_row(None) is not None:
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME, schema=None)
