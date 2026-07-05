"""Add hub_tasks list query indexes.

Revision ID: 20260624_0059
Revises: 20260624_0058
Create Date: 2026-06-24 20:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260624_0059"
down_revision = "20260624_0058"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_tasks"
INDEXES = (
    ("idx_hub_tasks_created_by", ["created_by_user_id", "status", "updated_at"]),
    ("idx_hub_tasks_due_at", ["due_at"]),
)


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
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    for index_name, columns in INDEXES:
        if _has_index(schema, TABLE_NAME, index_name):
            continue
        op.create_index(index_name, TABLE_NAME, columns, unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    for index_name, _columns in reversed(INDEXES):
        if _has_index(schema, TABLE_NAME, index_name):
            op.drop_index(index_name, table_name=TABLE_NAME, schema=schema)
