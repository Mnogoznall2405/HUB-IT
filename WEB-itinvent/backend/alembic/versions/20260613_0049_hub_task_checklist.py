"""hub task checklist items

Revision ID: 20260613_0049
Revises: 20260610_0048
Create Date: 2026-06-13 17:15:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260613_0049"
down_revision = "20260610_0048"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return False
    return any(str(item.get("name") or "") == column_name for item in inspector.get_columns(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "hub_tasks") or _has_column(schema, "hub_tasks", "checklist_items"):
        return
    with op.batch_alter_table("hub_tasks", schema=schema) as batch_op:
        batch_op.add_column(sa.Column("checklist_items", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "hub_tasks") or not _has_column(schema, "hub_tasks", "checklist_items"):
        return
    with op.batch_alter_table("hub_tasks", schema=schema) as batch_op:
        batch_op.drop_column("checklist_items")
