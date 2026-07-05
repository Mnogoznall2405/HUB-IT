"""Add trusted_device_id to app sessions for extended idle timeout.

Revision ID: 20260624_0057
Revises: 20260624_0056
Create Date: 2026-06-24 20:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260624_0057"
down_revision = "20260624_0056"
branch_labels = None
depends_on = None


TABLE_NAME = "sessions"
COLUMN_NAME = "trusted_device_id"


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
            sa.Column(COLUMN_NAME, sa.String(length=64), nullable=True),
            schema=schema,
        )
        op.create_index(
            op.f("ix_app_sessions_trusted_device_id"),
            TABLE_NAME,
            [COLUMN_NAME],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.drop_index(
            op.f("ix_app_sessions_trusted_device_id"),
            table_name=TABLE_NAME,
            schema=schema,
        )
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
