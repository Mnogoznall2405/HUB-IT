"""add chat_message_reactions table

Revision ID: 20260508_0030
Revises: 20260502_0029
Create Date: 2026-05-08 21:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260508_0030"
down_revision = "20260502_0029"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _table_exists(schema: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return inspector.has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "app":
        return
    if _table_exists("chat", "chat_message_reactions"):
        return
    op.create_table(
        "chat_message_reactions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("message_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["chat.chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat.chat_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_message_reactions_message_user_emoji"),
        schema="chat",
    )
    op.create_index("ix_chat_message_reactions_message_id", "chat_message_reactions", ["message_id"], schema="chat")
    op.create_index("ix_chat_message_reactions_user_id", "chat_message_reactions", ["user_id"], schema="chat")
    op.create_index("ix_chat_message_reactions_conversation_id", "chat_message_reactions", ["conversation_id"], schema="chat")


def downgrade() -> None:
    if _scope() == "app":
        return
    if not _table_exists("chat", "chat_message_reactions"):
        return
    op.drop_index("ix_chat_message_reactions_conversation_id", table_name="chat_message_reactions", schema="chat")
    op.drop_index("ix_chat_message_reactions_user_id", table_name="chat_message_reactions", schema="chat")
    op.drop_index("ix_chat_message_reactions_message_id", table_name="chat_message_reactions", schema="chat")
    op.drop_table("chat_message_reactions", schema="chat")
