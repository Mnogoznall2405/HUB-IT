"""Add muted_until to chat_conversation_user_state (F-MUTE-TIMER).

Revision ID: 20260924_0122
Revises: 20260924_0121
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260924_0122"
down_revision = "20260924_0121"
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
    schema = _chat_table_schema("chat_conversation_user_state")
    if not _has_table(schema, "chat_conversation_user_state"):
        return
    if _has_column(schema, "chat_conversation_user_state", "muted_until"):
        return
    op.add_column(
        "chat_conversation_user_state",
        sa.Column("muted_until", sa.DateTime(timezone=True), nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _chat_table_schema("chat_conversation_user_state")
    if not _has_column(schema, "chat_conversation_user_state", "muted_until"):
        return
    op.drop_column("chat_conversation_user_state", "muted_until", schema=schema)
