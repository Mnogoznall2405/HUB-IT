"""Add chat_group_admin_audit (journal of portal-admin actions on groups).

Revision ID: 20261012_0129
Revises: 20261012_0128

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all.
Portal-admin group actions are refused (400) until the table exists, so the code can be deployed before
this migration is run explicitly at release time; ordinary chat work is unaffected.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261012_0129"
down_revision = "20261012_0128"
branch_labels = None
depends_on = None

TABLE = "chat_group_admin_audit"
INDEX = "ix_chat_group_admin_audit_conversation_id_created_at"


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
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index(INDEX, TABLE, ["conversation_id", "created_at"], schema=schema)


def downgrade() -> None:
    # An audit journal must not be dropped by a downgrade.
    pass
