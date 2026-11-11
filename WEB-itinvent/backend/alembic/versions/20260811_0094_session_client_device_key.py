"""Add stable client-device key hash to web sessions.

Revision ID: 20260811_0094
Revises: 20260810_0093
Create Date: 2026-08-11 16:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260811_0094"
down_revision = "20260810_0093"
branch_labels = None
depends_on = None


TABLE_NAME = "sessions"
COLUMN_NAME = "client_device_key_hash"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _columns(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def _indexes(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if COLUMN_NAME not in _columns(schema, TABLE_NAME):
        op.add_column(
            TABLE_NAME,
            sa.Column(COLUMN_NAME, sa.String(length=64), nullable=True),
            schema=schema,
        )
    index_name = "ix_app_sessions_client_device_key_hash"
    if index_name not in _indexes(schema, TABLE_NAME):
        op.create_index(
            index_name,
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
    index_name = "ix_app_sessions_client_device_key_hash"
    if index_name in _indexes(schema, TABLE_NAME):
        op.drop_index(index_name, table_name=TABLE_NAME, schema=schema)
    if COLUMN_NAME in _columns(schema, TABLE_NAME):
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
