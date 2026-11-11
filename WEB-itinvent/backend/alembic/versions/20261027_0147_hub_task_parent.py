"""Add parent_task_id to hub_tasks (subtasks).

Revision ID: 20261027_0147
Revises: 20261027_0146
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261027_0147"
down_revision = "20261027_0146"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_tasks"
COLUMN_NAME = "parent_task_id"
INDEX_NAME = "idx_hub_tasks_parent"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == column_name.lower()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    )


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
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if not _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.add_column(TABLE_NAME, sa.Column(COLUMN_NAME, sa.Text(), nullable=True), schema=schema)
    if not _has_index(schema, TABLE_NAME, INDEX_NAME):
        op.create_index(INDEX_NAME, TABLE_NAME, [COLUMN_NAME], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_index(schema, TABLE_NAME, INDEX_NAME):
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME, schema=schema)
    if _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
