"""Chat group moderation and soft deletes."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260501_0027"
down_revision = "20260501_0026"
branch_labels = None
depends_on = None


def _chat_messages_schema() -> str | None:
    inspector = sa.inspect(op.get_bind())
    for schema in (None, "public", "chat"):
        if inspector.has_table("chat_messages", schema=schema):
            return schema
    return None


def _column_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("chat_messages", schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_columns("chat_messages", schema=schema)}


def _index_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("chat_messages", schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes("chat_messages", schema=schema)}


def upgrade() -> None:
    chat_schema = _chat_messages_schema()
    columns = _column_names(chat_schema)
    if "is_deleted" not in columns:
        op.add_column(
            "chat_messages",
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema=chat_schema,
        )
    if "deleted_at" not in columns:
        op.add_column("chat_messages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True), schema=chat_schema)
    if "deleted_by_user_id" not in columns:
        op.add_column("chat_messages", sa.Column("deleted_by_user_id", sa.Integer(), nullable=True), schema=chat_schema)
    if "deleted_reason" not in columns:
        op.add_column("chat_messages", sa.Column("deleted_reason", sa.String(length=64), nullable=True), schema=chat_schema)

    indexes = _index_names(chat_schema)
    if "ix_chat_messages_is_deleted" not in indexes:
        op.create_index("ix_chat_messages_is_deleted", "chat_messages", ["is_deleted"], unique=False, schema=chat_schema)
    if "ix_chat_messages_deleted_by_user_id" not in indexes:
        op.create_index("ix_chat_messages_deleted_by_user_id", "chat_messages", ["deleted_by_user_id"], unique=False, schema=chat_schema)


def downgrade() -> None:
    chat_schema = _chat_messages_schema()
    indexes = _index_names(chat_schema)
    if "ix_chat_messages_deleted_by_user_id" in indexes:
        op.drop_index("ix_chat_messages_deleted_by_user_id", table_name="chat_messages", schema=chat_schema)
    if "ix_chat_messages_is_deleted" in indexes:
        op.drop_index("ix_chat_messages_is_deleted", table_name="chat_messages", schema=chat_schema)

    columns = _column_names(chat_schema)
    if "deleted_reason" in columns:
        op.drop_column("chat_messages", "deleted_reason", schema=chat_schema)
    if "deleted_by_user_id" in columns:
        op.drop_column("chat_messages", "deleted_by_user_id", schema=chat_schema)
    if "deleted_at" in columns:
        op.drop_column("chat_messages", "deleted_at", schema=chat_schema)
    if "is_deleted" in columns:
        op.drop_column("chat_messages", "is_deleted", schema=chat_schema)
