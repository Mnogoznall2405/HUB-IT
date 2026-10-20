"""Add chat_group_settings (group description and posting policy).

Revision ID: 20261012_0128
Revises: 20261008_0127

The table is created in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime). Per the chat migration rule the DDL is NOT skipped by
``itinvent_scope``: it is skipped only when the database has no chat tables at all. The object is created
"if it is missing", so a repeated run is harmless.

The application tolerates the missing table (groups behave as before, saving settings answers 400), so the
code can be deployed before this migration is run explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261012_0128"
down_revision = "20261008_0127"
branch_labels = None
depends_on = None

TABLE = "chat_group_settings"


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_conversations_schema() -> tuple[bool, str | None]:
    """(chat tables are in this database, schema they live in)."""
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
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("posting_policy", sa.String(16), nullable=False, server_default="all"),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id"),
        schema=schema,
    )


def downgrade() -> None:
    # Data-bearing table: dropping it would lose group descriptions; keep the downgrade a no-op.
    pass
