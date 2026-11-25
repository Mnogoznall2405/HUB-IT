"""Add per-user recents-sync state for chat stickers.

Revision ID: 20261124_0179
Revises: 20261124_0178
Create Date: 2026-11-24 13:00:00.000000

``chat_user_recent_sticker_state`` holds one row per user: a monotonic
``version`` bumped on every ``PUT /chat/stickers/recent``. It backs the
versioned merge-sync contract (clients detect cross-device writes via
``base_version`` mismatch) and distinguishes "never synced" from "explicitly
cleared". Created "if missing" in the schema where the chat tables really
live (logical ``chat`` schema, or ``public`` on the legacy PostgreSQL
runtime); skipped only when the database has no chat tables at all, never by
``itinvent_scope``.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261124_0179"
down_revision = "20261124_0178"
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_tables_schema() -> str | None:
    """Schema where the chat tables live: logical ``chat`` or legacy ``public``."""
    chat_schema = _schema("chat")
    if _has_table(chat_schema, "chat_conversations"):
        return chat_schema
    if _has_table(None, "chat_conversations"):
        return None
    return chat_schema


def _chat_tables_present() -> bool:
    """Skip only when the database has no chat tables at all (logical ``chat`` schema or
    legacy ``public``), never by ``itinvent_scope``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if bind.dialect.name == "postgresql" and inspector.has_table("chat_conversations", schema="chat"):
        return True
    return bool(inspector.has_table("chat_conversations"))


def upgrade() -> None:
    if not _chat_tables_present():
        return
    schema = _chat_tables_schema()

    if not _has_table(schema, "chat_user_recent_sticker_state"):
        op.create_table(
            "chat_user_recent_sticker_state",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("user_id"),
            schema=schema,
        )


def downgrade() -> None:
    if not _chat_tables_present():
        return
    schema = _chat_tables_schema()
    if _has_table(schema, "chat_user_recent_sticker_state"):
        op.drop_table("chat_user_recent_sticker_state", schema=schema)
