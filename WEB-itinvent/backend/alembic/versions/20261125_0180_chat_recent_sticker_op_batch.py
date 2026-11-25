"""Add applied op-batch id history to the per-user recents-sync state.

Revision ID: 20261125_0180
Revises: 20261124_0179
Create Date: 2026-11-25 10:00:00.000000

``chat_user_recent_sticker_state.applied_op_batch_ids`` stores a JSON array
of the ``op_batch_id`` values of ``PUT /chat/stickers/recent`` ops batches
the server actually applied (bounded — the service keeps only the most
recent ids). Clients keep one batch id per journal flush and retry it
unchanged after a lost response; the server treats an already-recorded
batch id as an idempotent replay and returns the current
``{items, version}`` without reapplying the delta (no version bump, no
rail mutation). A history rather than a single last id is required
because the replayed batch is not necessarily the most recent write:
another device may have landed a different batch while the original
response was in flight. Added "if missing" in the schema where the chat
tables really live (logical ``chat`` schema, or ``public`` on the legacy
PostgreSQL runtime); skipped only when the database has no chat tables at
all, never by ``itinvent_scope``.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261125_0180"
down_revision = "20261124_0179"
branch_labels = None
depends_on = None


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

    if _has_table(schema, "chat_user_recent_sticker_state") and not _has_column(
        schema, "chat_user_recent_sticker_state", "applied_op_batch_ids"
    ):
        op.add_column(
            "chat_user_recent_sticker_state",
            sa.Column("applied_op_batch_ids", sa.Text(), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if not _chat_tables_present():
        return
    schema = _chat_tables_schema()
    if _has_column(schema, "chat_user_recent_sticker_state", "applied_op_batch_ids"):
        op.drop_column("chat_user_recent_sticker_state", "applied_op_batch_ids", schema=schema)
