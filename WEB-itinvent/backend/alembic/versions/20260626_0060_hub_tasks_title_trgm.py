"""Add pg_trgm GIN index for hub_tasks title search.

Revision ID: 20260626_0060
Revises: 20260624_0059
Create Date: 2026-06-26 14:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260626_0060"
down_revision = "20260624_0059"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_tasks"
TITLE_INDEX = "idx_hub_tasks_title_trgm"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == index_name.lower()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    if op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if _has_index(schema, TABLE_NAME, TITLE_INDEX):
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    qualified = f"{schema}.{TABLE_NAME}" if schema else TABLE_NAME
    op.execute(
        f"CREATE INDEX {TITLE_INDEX} ON {qualified} "
        f"USING gin (lower(title) gin_trgm_ops)"
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    if op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if _has_index(schema, TABLE_NAME, TITLE_INDEX):
        op.drop_index(TITLE_INDEX, table_name=TABLE_NAME, schema=schema)
