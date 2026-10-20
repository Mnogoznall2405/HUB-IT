"""add image dimensions to chat attachments

Revision ID: 20260409_0018
Revises: 20260408_0017
Create Date: 2026-04-09 19:40:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260409_0018"
down_revision = "20260408_0017"
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


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _chat_tables_present() -> bool:
    """Skip only when the database has no chat tables at all, never by ``itinvent_scope``."""
    bind = op.get_bind()
    schema = "chat" if bind.dialect.name == "postgresql" else None
    return bool(sa.inspect(bind).has_table("chat_conversations", schema=schema))


def upgrade() -> None:
    if not _chat_tables_present():
        return
    columns = _column_names("chat", "chat_message_attachments")
    if "width" not in columns:
        op.add_column(
            "chat_message_attachments",
            sa.Column("width", sa.Integer(), nullable=True),
            schema="chat",
        )
    if "height" not in columns:
        op.add_column(
            "chat_message_attachments",
            sa.Column("height", sa.Integer(), nullable=True),
            schema="chat",
        )


def downgrade() -> None:
    if not _chat_tables_present():
        return
    columns = _column_names("chat", "chat_message_attachments")
    if "height" in columns:
        op.drop_column("chat_message_attachments", "height", schema="chat")
    if "width" in columns:
        op.drop_column("chat_message_attachments", "width", schema="chat")
