"""Add chat_group_join_settings and chat_group_join_requests (join by approval for invite links).

Revision ID: 20261027_0146
Revises: 20261026_0145

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
The application tolerates the missing tables: switching a group to approval answers 400 until the
migration is run explicitly at release time; the invite link and ordinary chat work are unaffected.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261027_0146"
down_revision = "20261026_0145"
branch_labels = None
depends_on = None

SETTINGS_TABLE = "chat_group_join_settings"
REQUESTS_TABLE = "chat_group_join_requests"


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
    prefix = f"{schema}." if schema else ""
    if not _has_table(schema, SETTINGS_TABLE):
        op.create_table(
            SETTINGS_TABLE,
            sa.Column("conversation_id", sa.String(36), nullable=False),
            sa.Column("approval_required", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("conversation_id"),
            schema=schema,
        )
    if not _has_table(schema, REQUESTS_TABLE):
        op.create_table(
            REQUESTS_TABLE,
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("conversation_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(16), server_default="pending", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_group_join_requests_conversation_user"),
            schema=schema,
        )
        op.create_index(
            "ix_chat_group_join_requests_conversation_id_status",
            REQUESTS_TABLE,
            ["conversation_id", "status"],
            schema=schema,
        )


def downgrade() -> None:
    # Dropping the tables would only forget the waiting requests; keep the downgrade a no-op like its siblings.
    pass
