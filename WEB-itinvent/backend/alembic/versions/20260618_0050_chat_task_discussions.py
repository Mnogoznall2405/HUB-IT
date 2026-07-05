"""Add task_id to chat conversations for task discussion chats.

Revision ID: 20260618_0050
Revises: 20260613_0049
Create Date: 2026-06-18 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260618_0050"
down_revision = "20260613_0049"
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
    table_name = "chat_conversations"
    chat_schema = _chat_table_schema(table_name)
    if not _has_table(chat_schema, table_name):
        return
    columns = _column_names(chat_schema, table_name)
    if "task_id" not in columns:
        op.add_column(
            table_name,
            sa.Column("task_id", sa.String(length=64), nullable=True),
            schema=chat_schema,
        )
    index_name = "uq_chat_conversations_task_id"
    op.create_index(
        index_name,
        table_name,
        ["task_id"],
        unique=True,
        schema=chat_schema,
        postgresql_where=sa.text("task_id IS NOT NULL"),
        sqlite_where=sa.text("task_id IS NOT NULL"),
    )
    op.create_index(
        "ix_chat_conversations_kind_task_id",
        table_name,
        ["kind", "task_id"],
        unique=False,
        schema=chat_schema,
    )


def downgrade() -> None:
    if _scope() == "app":
        return
    table_name = "chat_conversations"
    chat_schema = _chat_table_schema(table_name)
    if not _has_table(chat_schema, table_name):
        return
    op.drop_index("ix_chat_conversations_kind_task_id", table_name=table_name, schema=chat_schema)
    op.drop_index("uq_chat_conversations_task_id", table_name=table_name, schema=chat_schema)
    if "task_id" in _column_names(chat_schema, table_name):
        op.drop_column(table_name, "task_id", schema=chat_schema)
