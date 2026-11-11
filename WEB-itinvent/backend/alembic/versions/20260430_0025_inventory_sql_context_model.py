"""add inventory model fields to sql context cache

Revision ID: 20260430_0025
Revises: 20260428_0024
Create Date: 2026-04-30 16:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260430_0025"
down_revision = "20260428_0024"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _column_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_columns(table_name, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    table_name = "inventory_host_sql_contexts"
    if not _has_table(schema, table_name):
        return
    columns = _column_names(schema, table_name)
    if "inventory_inv_no" not in columns:
        op.add_column(table_name, sa.Column("inventory_inv_no", sa.String(length=64), nullable=True), schema=schema)
    if "inventory_model_name" not in columns:
        op.add_column(table_name, sa.Column("inventory_model_name", sa.String(length=255), nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    table_name = "inventory_host_sql_contexts"
    if not _has_table(schema, table_name):
        return
    columns = _column_names(schema, table_name)
    if "inventory_model_name" in columns:
        op.drop_column(table_name, "inventory_model_name", schema=schema)
    if "inventory_inv_no" in columns:
        op.drop_column(table_name, "inventory_inv_no", schema=schema)
