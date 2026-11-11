"""Ensure chat_scheduled_messages exists (repairs 20261002_0124 recorded without its table).

Revision ID: 20261002_0125
Revises: 20261002_0124

Why: on production app and chat share one database and one ``system.alembic_version``. 20261002_0124
skips DDL when the run scope is ``app``; the app-scope start-up upgrade recorded the revision without
creating the table. A later ``chat`` upgrade then considers 0124 applied and never creates it.

This revision creates the table "if it is missing" in ANY scope, but only when the chat tables live in
this database (schema ``chat``, or ``public`` on the legacy PostgreSQL runtime). Idempotent: a database
where 0124 really created the table is left untouched.

Rule for chat migrations from now on: do not skip DDL by ``itinvent_scope`` when the chat tables are in
the same database; check for the tables instead.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261002_0125"
down_revision = "20261002_0124"
branch_labels = None
depends_on = None

TABLE = "chat_scheduled_messages"


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_conversations_schema() -> tuple[bool, str | None]:
    """(chat tables are in this database, schema they live in)."""
    chat_schema = _schema("chat")
    if _has_table(chat_schema, "chat_conversations"):
        return True, chat_schema
    if _has_table(None, "chat_conversations"):
        return True, None
    return False, chat_schema


def upgrade() -> None:
    present, schema = _chat_conversations_schema()
    if not present or _has_table(schema, TABLE):
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
    # The table belongs to 20261002_0124 (its downgrade drops it); 0125 only repairs a missing table.
    pass
