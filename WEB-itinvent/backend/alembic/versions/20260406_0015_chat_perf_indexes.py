"""add composite indexes for chat hot paths

Revision ID: 20260406_0015
Revises: 20260402_0014
Create Date: 2026-04-06 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260406_0015"
down_revision = "20260402_0014"
branch_labels = None
depends_on = None


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
    chat_message_indexes = _index_names("chat", "chat_messages")
    if "ix_chat_messages_conversation_id_created_at_id" not in chat_message_indexes:
        op.create_index(
            "ix_chat_messages_conversation_id_created_at_id",
            "chat_messages",
            ["conversation_id", "created_at", "id"],
            unique=False,
            schema="chat",
        )

    chat_member_indexes = _index_names("chat", "chat_members")
    if "ix_chat_members_user_id_left_at_conversation_id" not in chat_member_indexes:
        op.create_index(
            "ix_chat_members_user_id_left_at_conversation_id",
            "chat_members",
            ["user_id", "left_at", "conversation_id"],
            unique=False,
            schema="chat",
        )
    if "ix_chat_members_conversation_id_left_at_user_id" not in chat_member_indexes:
        op.create_index(
            "ix_chat_members_conversation_id_left_at_user_id",
            "chat_members",
            ["conversation_id", "left_at", "user_id"],
            unique=False,
            schema="chat",
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    chat_message_indexes = _index_names("chat", "chat_messages")
    if "ix_chat_messages_conversation_id_created_at_id" in chat_message_indexes:
        op.drop_index(
            "ix_chat_messages_conversation_id_created_at_id",
            table_name="chat_messages",
            schema="chat",
        )

    chat_member_indexes = _index_names("chat", "chat_members")
    if "ix_chat_members_user_id_left_at_conversation_id" in chat_member_indexes:
        op.drop_index(
            "ix_chat_members_user_id_left_at_conversation_id",
            table_name="chat_members",
            schema="chat",
        )
    if "ix_chat_members_conversation_id_left_at_user_id" in chat_member_indexes:
        op.drop_index(
            "ix_chat_members_conversation_id_left_at_user_id",
            table_name="chat_members",
            schema="chat",
        )
