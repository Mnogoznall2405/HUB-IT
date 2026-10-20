"""Add chat_group_invites (group invite links).

Revision ID: 20261013_0130
Revises: 20261012_0130 (equipment_photo_checks, parallel work), 20261012_0129 before it

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
The application tolerates the missing table: creating or using an invite link answers 400 until the
migration is run explicitly at release time; ordinary chat work is unaffected.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261013_0130"
down_revision = "20261012_0130"
branch_labels = None
depends_on = None

TABLE = "chat_group_invites"
INDEX = "ix_chat_group_invites_conversation_id_revoked_at"


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
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_chat_group_invites_token_hash"),
        schema=schema,
    )
    op.create_index(INDEX, TABLE, ["conversation_id", "revoked_at"], schema=schema)


def downgrade() -> None:
    # Dropping the table would only forget invite links; keep the downgrade a no-op like its siblings.
    pass
