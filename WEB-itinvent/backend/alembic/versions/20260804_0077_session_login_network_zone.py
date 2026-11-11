"""Add login_network_zone to app sessions for internal idle timeout.

Revision ID: 20260804_0077
Revises: 20260801_0076
Create Date: 2026-08-04 11:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260804_0077"
down_revision = "20260801_0076"
branch_labels = None
depends_on = None


TABLE_NAME = "sessions"
COLUMN_NAME = "login_network_zone"


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


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if not _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.add_column(
            TABLE_NAME,
            sa.Column(COLUMN_NAME, sa.String(length=16), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
