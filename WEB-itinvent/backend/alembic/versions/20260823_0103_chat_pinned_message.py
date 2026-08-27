"""Add shared pinned message fields to chat conversations.

Revision ID: 20260823_0103
Revises: 20260823_0102
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260823_0103"
down_revision = "20260823_0102"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_table_schema(table_name: str) -> str | None:
    chat_schema = _schema("chat")
    if _has_table(chat_schema, table_name):
        return chat_schema
    if _has_table(None, table_name):
        return None
    return chat_schema


def _column_names(schema: str | None, table_name: str) -> set[str]:
    return {
        str(column.get("name") or "")
        for column in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def _index_names(schema: str | None, table_name: str) -> set[str]:
    return {
        str(index.get("name") or "")
        for index in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema("chat_conversations")
    table_name = "chat_conversations"
    if not _has_table(schema, table_name):
        return
    columns = _column_names(schema, table_name)
    if "pinned_message_id" not in columns:
        op.add_column(table_name, sa.Column("pinned_message_id", sa.String(length=36), nullable=True), schema=schema)
    if "pinned_at" not in columns:
        op.add_column(table_name, sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True), schema=schema)
    if "pinned_by_user_id" not in columns:
        op.add_column(table_name, sa.Column("pinned_by_user_id", sa.Integer(), nullable=True), schema=schema)
    indexes = _index_names(schema, table_name)
    if "ix_chat_conversations_pinned_message_id" not in indexes:
        op.create_index(
            "ix_chat_conversations_pinned_message_id",
            table_name,
            ["pinned_message_id"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema("chat_conversations")
    table_name = "chat_conversations"
    if not _has_table(schema, table_name):
        return
    indexes = _index_names(schema, table_name)
    if "ix_chat_conversations_pinned_message_id" in indexes:
        op.drop_index("ix_chat_conversations_pinned_message_id", table_name=table_name, schema=schema)
    columns = _column_names(schema, table_name)
    if "pinned_by_user_id" in columns:
        op.drop_column(table_name, "pinned_by_user_id", schema=schema)
    if "pinned_at" in columns:
        op.drop_column(table_name, "pinned_at", schema=schema)
    if "pinned_message_id" in columns:
        op.drop_column(table_name, "pinned_message_id", schema=schema)
