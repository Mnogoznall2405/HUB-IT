"""Track mention push outbox jobs.

Revision ID: 20260609_0047
Revises: 20260608_0046
Create Date: 2026-06-09 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260609_0047"
down_revision = "20260608_0046"
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
    table_name = "chat_push_outbox"
    chat_schema = _chat_table_schema(table_name)
    if not _has_table(chat_schema, table_name):
        return
    if "is_mention" not in _column_names(chat_schema, table_name):
        op.add_column(
            table_name,
            sa.Column("is_mention", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema=chat_schema,
        )
        op.alter_column(table_name, "is_mention", server_default=None, schema=chat_schema)


def downgrade() -> None:
    if _scope() == "app":
        return
    table_name = "chat_push_outbox"
    chat_schema = _chat_table_schema(table_name)
    if not _has_table(chat_schema, table_name):
        return
    if "is_mention" in _column_names(chat_schema, table_name):
        op.drop_column(table_name, "is_mention", schema=chat_schema)
