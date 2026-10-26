"""Add chat_message_pins (several pinned messages per conversation).

Revision ID: 20261023_0144
Revises: 20261022_0143

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
The single pin that conversations already have (``chat_conversations.pinned_message_id``) is copied
into the new table, so nothing disappears from the chat. The application tolerates the missing table:
a conversation keeps one pin (a new pin replaces it) until the migration is run explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261023_0144"
down_revision = "20261022_0143"
branch_labels = None
depends_on = None

TABLE = "chat_message_pins"


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_conversations_schema() -> tuple[bool, str | None]:
    chat_schema = _schema("chat")
    if _has_table(chat_schema, "chat_conversations"):
        return True, chat_schema
    if _has_table(None, "chat_conversations"):
        return True, None
    return False, chat_schema


def upgrade() -> None:
    present, schema = _chat_conversations_schema()
    if not present:
        return
    if _has_table(schema, TABLE):
        return
    prefix = f"{schema}." if schema else ""
    op.create_table(
        TABLE,
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("message_id", sa.String(36), nullable=False),
        sa.Column("pinned_by_user_id", sa.Integer(), nullable=True),
        sa.Column("pinned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], [f"{prefix}chat_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id", "message_id"),
        schema=schema,
    )
    op.create_index(
        "ix_chat_message_pins_conversation_id_pinned_at",
        TABLE,
        ["conversation_id", "pinned_at"],
        schema=schema,
    )
    # Carry over the existing single pins; only messages that still exist in the same conversation.
    op.execute(
        sa.text(
            f"INSERT INTO {prefix}{TABLE} (conversation_id, message_id, pinned_by_user_id, pinned_at) "
            f"SELECT c.id, c.pinned_message_id, c.pinned_by_user_id, COALESCE(c.pinned_at, CURRENT_TIMESTAMP) "
            f"FROM {prefix}chat_conversations c "
            f"JOIN {prefix}chat_messages m ON m.id = c.pinned_message_id AND m.conversation_id = c.id "
            f"WHERE c.pinned_message_id IS NOT NULL AND m.is_deleted = {'false' if op.get_bind().dialect.name == 'postgresql' else '0'}"
        )
    )


def downgrade() -> None:
    # Dropping the table would only forget the extra pins; keep the downgrade a no-op like its siblings.
    pass
