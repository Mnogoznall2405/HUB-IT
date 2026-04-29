"""add native forward tracking to chat messages

Revision ID: 20260417_0019
Revises: 20260409_0018
Create Date: 2026-04-17 18:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260417_0019"
down_revision = "20260409_0018"
branch_labels = None
depends_on = None


def _column_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_columns(table_name, schema=schema)
    }


def _index_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_indexes(table_name, schema=schema)
    }


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def upgrade() -> None:
    if _scope() == "app":
        return
    columns = _column_names("chat", "chat_messages")
    indexes = _index_names("chat", "chat_messages")
    if "forward_from_message_id" not in columns:
        op.add_column(
            "chat_messages",
            sa.Column("forward_from_message_id", sa.String(length=36), nullable=True),
            schema="chat",
        )
    if "ix_chat_messages_forward_from_message_id" not in indexes:
        op.create_index(
            "ix_chat_messages_forward_from_message_id",
            "chat_messages",
            ["forward_from_message_id"],
            unique=False,
            schema="chat",
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    indexes = _index_names("chat", "chat_messages")
    columns = _column_names("chat", "chat_messages")
    if "ix_chat_messages_forward_from_message_id" in indexes:
        op.drop_index("ix_chat_messages_forward_from_message_id", table_name="chat_messages", schema="chat")
    if "forward_from_message_id" in columns:
        op.drop_column("chat_messages", "forward_from_message_id", schema="chat")
