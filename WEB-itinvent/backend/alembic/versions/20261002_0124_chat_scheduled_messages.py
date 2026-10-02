"""Add chat_scheduled_messages ("Send later").

Revision ID: 20261002_0124
Revises: 20260925_0123

The table is created in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime), like 20260925_0123. Not applied on production by the
code change: the feature stays off (CHAT_SCHEDULED_MESSAGES_ENABLED=0) until this migration is run.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261002_0124"
down_revision = "20260925_0123"
branch_labels = None
depends_on = None

TABLE = "chat_scheduled_messages"


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
    schema = _chat_table_schema("chat_conversations")
    if _has_table(schema, TABLE):
        return
    qualified_conversations = f"{schema}.chat_conversations" if schema else "chat_conversations"
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("body_format", sa.String(16), nullable=False, server_default="plain"),
        sa.Column("reply_to_message_id", sa.String(36), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="scheduled"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_message_id", sa.String(36), nullable=True),
        sa.Column("error_text", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{qualified_conversations}.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index(
        "ix_chat_scheduled_messages_status_scheduled_for",
        TABLE,
        ["status", "scheduled_for"],
        schema=schema,
    )
    op.create_index(
        "ix_chat_scheduled_messages_conversation_sender_status",
        TABLE,
        ["conversation_id", "sender_user_id", "status"],
        schema=schema,
    )
    op.create_index("ix_chat_scheduled_messages_sender_user_id", TABLE, ["sender_user_id"], schema=schema)


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema(TABLE)
    if not _has_table(schema, TABLE):
        return
    op.drop_index("ix_chat_scheduled_messages_sender_user_id", table_name=TABLE, schema=schema)
    op.drop_index("ix_chat_scheduled_messages_conversation_sender_status", table_name=TABLE, schema=schema)
    op.drop_index("ix_chat_scheduled_messages_status_scheduled_for", table_name=TABLE, schema=schema)
    op.drop_table(TABLE, schema=schema)
