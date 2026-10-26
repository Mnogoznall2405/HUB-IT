"""Add chat_message_reports (complaints about messages of a group).

Revision ID: 20261026_0145
Revises: 20261023_0144

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
The application tolerates the missing table: reporting answers 400 until the migration is run
explicitly at release time; ordinary chat work is unaffected.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261026_0145"
down_revision = "20261023_0144"
branch_labels = None
depends_on = None

TABLE = "chat_message_reports"


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
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("message_id", sa.String(36), nullable=False),
        sa.Column("reporter_user_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("comment", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), server_default="open", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], [f"{prefix}chat_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "reporter_user_id", name="uq_chat_message_reports_message_reporter"),
        schema=schema,
    )
    op.create_index(
        "ix_chat_message_reports_conversation_id_status",
        TABLE,
        ["conversation_id", "status"],
        schema=schema,
    )


def downgrade() -> None:
    # Dropping the table would only forget the complaints; keep the downgrade a no-op like its siblings.
    pass
