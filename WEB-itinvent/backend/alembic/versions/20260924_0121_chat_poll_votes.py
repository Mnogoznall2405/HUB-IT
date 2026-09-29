"""Add chat_poll_votes table for kind='poll' messages (F-POLL).

Revision ID: 20260924_0121
Revises: 20260922_0120
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260924_0121"
down_revision = "20260922_0120"
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


def upgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema("chat_messages")
    if _has_table(schema, "chat_poll_votes"):
        return
    if not _has_table(schema, "chat_messages"):
        return
    op.create_table(
        "chat_poll_votes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("message_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("option_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["message_id"],
            [f"{schema}.chat_messages.id" if schema else "chat_messages.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            [f"{schema}.chat_conversations.id" if schema else "chat_conversations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_chat_poll_votes_message_user"),
        schema=schema,
    )
    op.create_index(
        "ix_chat_poll_votes_conversation",
        "chat_poll_votes",
        ["conversation_id", "message_id"],
        schema=schema,
    )
    op.create_index(
        "ix_chat_poll_votes_message_id",
        "chat_poll_votes",
        ["message_id"],
        schema=schema,
    )
    op.create_index(
        "ix_chat_poll_votes_user_id",
        "chat_poll_votes",
        ["user_id"],
        schema=schema,
    )
    op.create_index(
        "ix_chat_poll_votes_created_at",
        "chat_poll_votes",
        ["created_at"],
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema("chat_poll_votes")
    if not _has_table(schema, "chat_poll_votes"):
        return
    op.drop_index("ix_chat_poll_votes_created_at", table_name="chat_poll_votes", schema=schema)
    op.drop_index("ix_chat_poll_votes_user_id", table_name="chat_poll_votes", schema=schema)
    op.drop_index("ix_chat_poll_votes_message_id", table_name="chat_poll_votes", schema=schema)
    op.drop_index("ix_chat_poll_votes_conversation", table_name="chat_poll_votes", schema=schema)
    op.drop_table("chat_poll_votes", schema=schema)
