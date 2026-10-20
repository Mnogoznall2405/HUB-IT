"""Add chat_group_restrictions (single members barred from writing in a group).

Revision ID: 20261013_0132
Revises: 20261013_0131

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
The application tolerates the missing table: restricting a member answers 400 until the migration is
run explicitly at release time; ordinary chat work is unaffected.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261013_0132"
down_revision = "20261013_0131"
branch_labels = None
depends_on = None

TABLE = "chat_group_restrictions"
INDEX = "ix_chat_group_restrictions_user_id"


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
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("restricted_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("restricted_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id", "user_id"),
        schema=schema,
    )
    op.create_index(INDEX, TABLE, ["user_id"], schema=schema)


def downgrade() -> None:
    # Dropping the table would only forget restrictions; keep the downgrade a no-op like its siblings.
    pass
