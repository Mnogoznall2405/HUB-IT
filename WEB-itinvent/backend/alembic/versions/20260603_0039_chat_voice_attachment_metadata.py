"""chat voice attachment metadata

Revision ID: 20260603_0039
Revises: 20260528_0038
Create Date: 2026-06-03 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0039"
down_revision = "20260528_0038"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _column_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def _chat_table_schema(table_name: str) -> str | None:
    chat_schema = _schema("chat")
    if _has_table(chat_schema, table_name):
        return chat_schema
    if _has_table(None, table_name):
        return None
    return chat_schema


def upgrade() -> None:
    if _scope() == "app":
        return
    table_name = "chat_message_attachments"
    chat_schema = _chat_table_schema(table_name)
    columns = _column_names(chat_schema, table_name)
    if not columns:
        return
    if "media_kind" not in columns:
        op.add_column(table_name, sa.Column("media_kind", sa.String(length=20), nullable=True), schema=chat_schema)
    if "duration_seconds" not in columns:
        op.add_column(table_name, sa.Column("duration_seconds", sa.Integer(), nullable=True), schema=chat_schema)


def downgrade() -> None:
    if _scope() == "app":
        return
    table_name = "chat_message_attachments"
    chat_schema = _chat_table_schema(table_name)
    columns = _column_names(chat_schema, table_name)
    if not columns:
        return
    if "duration_seconds" in columns:
        op.drop_column(table_name, "duration_seconds", schema=chat_schema)
    if "media_kind" in columns:
        op.drop_column(table_name, "media_kind", schema=chat_schema)
