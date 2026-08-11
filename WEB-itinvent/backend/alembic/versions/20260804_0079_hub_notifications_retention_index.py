"""Add hub_notifications retention index (entity_type, created_at, id).

Revision ID: 20260804_0079
Revises: 20260804_0078
Create Date: 2026-08-04 14:30:00.000000

Supports retention SELECT:
  entity_type = ? AND created_at < ? AND recipient_user_id IS NOT NULL
  ORDER BY created_at, id LIMIT n

PostgreSQL: CREATE INDEX CONCURRENTLY outside the normal transaction block.
Partial WHERE recipient_user_id IS NOT NULL (broadcast nulls excluded from retention).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0079"
down_revision = "20260804_0078"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_notifications"
INDEX_NAME = "idx_hub_notifications_retention"
INDEX_COLUMNS = ("entity_type", "created_at", "id")


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


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
    create_sql = (
        f'CREATE INDEX CONCURRENTLY IF NOT EXISTS "{INDEX_NAME}" '
        f'ON "{schema}"."{TABLE_NAME}" (entity_type, created_at, id) '
        f"WHERE recipient_user_id IS NOT NULL"
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
                "Recover with:\n"
                f"  1) SELECT c.relname, i.indisvalid, i.indisready\n"
                f"       FROM pg_class c\n"
                f"       JOIN pg_namespace n ON n.oid = c.relnamespace\n"
                f"       JOIN pg_index i ON i.indexrelid = c.oid\n"
                f"      WHERE n.nspname = '{schema}' AND c.relname = '{INDEX_NAME}';\n"
                f'  2) DROP INDEX CONCURRENTLY IF EXISTS "{schema}"."{INDEX_NAME}";\n'
                "  3) Re-run: alembic -c backend/alembic.ini upgrade head\n"
                "Do not enable the retention worker until the index is valid."
            )
        op.execute(sa.text(f'ANALYZE "{schema}"."{TABLE_NAME}"'))


def _create_index_sqlite() -> None:
    if _index_row(None) is not None:
        return
    op.execute(
        sa.text(
            f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} "
            f"ON {TABLE_NAME} (entity_type, created_at, id) "
            f"WHERE recipient_user_id IS NOT NULL"
        )
    )


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
