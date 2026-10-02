"""Add chat_message_mentions table and unread_mention_count counter.

Revision ID: 20260925_0123
Revises: 20260924_0122
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260925_0123"
down_revision = "20260924_0122"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        col["name"] == column_name
        for col in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    )


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
    state_schema = _chat_table_schema("chat_conversation_user_state")
    if _has_table(state_schema, "chat_conversation_user_state") and not _has_column(
        state_schema, "chat_conversation_user_state", "unread_mention_count"
    ):
        op.add_column(
            "chat_conversation_user_state",
            sa.Column("unread_mention_count", sa.Integer(), nullable=False, server_default="0"),
            schema=state_schema,
        )
    messages_schema = _chat_table_schema("chat_messages")
    qualified_messages = f"{messages_schema}.chat_messages" if messages_schema else "chat_messages"
    qualified_conversations = f"{messages_schema}.chat_conversations" if messages_schema else "chat_conversations"
    if not _has_table(messages_schema, "chat_message_mentions"):
        op.create_table(
            "chat_message_mentions",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("message_id", sa.String(36), nullable=False),
            sa.Column("conversation_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["message_id"], [f"{qualified_messages}.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["conversation_id"], [f"{qualified_conversations}.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("message_id", "user_id", name="uq_chat_message_mentions_message_user"),
            schema=messages_schema,
        )
        op.create_index(
            "ix_chat_message_mentions_message_id",
            "chat_message_mentions",
            ["message_id"],
            schema=messages_schema,
        )
        op.create_index(
            "ix_chat_message_mentions_conversation_user",
            "chat_message_mentions",
            ["conversation_id", "user_id"],
            schema=messages_schema,
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    messages_schema = _chat_table_schema("chat_message_mentions")
    if _has_table(messages_schema, "chat_message_mentions"):
        op.drop_index("ix_chat_message_mentions_conversation_user", table_name="chat_message_mentions", schema=messages_schema)
        op.drop_index("ix_chat_message_mentions_message_id", table_name="chat_message_mentions", schema=messages_schema)
        op.drop_table("chat_message_mentions", schema=messages_schema)
    state_schema = _chat_table_schema("chat_conversation_user_state")
    if _has_column(state_schema, "chat_conversation_user_state", "unread_mention_count"):
        op.drop_column("chat_conversation_user_state", "unread_mention_count", schema=state_schema)
