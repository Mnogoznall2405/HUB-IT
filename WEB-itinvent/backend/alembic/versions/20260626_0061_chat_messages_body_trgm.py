"""Add pg_trgm GIN index for chat message body search.

Revision ID: 20260626_0061
Revises: 20260626_0060
Create Date: 2026-06-26 16:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260626_0061"
down_revision = "20260626_0060"
branch_labels = None
depends_on = None


TABLE_NAME = "chat_messages"
BODY_INDEX = "idx_chat_messages_body_trgm"
ATTACHMENTS_TABLE = "chat_message_attachments"
ATTACHMENTS_INDEX = "ix_chat_message_attachments_conversation_created_id"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "chat" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == index_name.lower()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "app":
        return
    if op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if not _has_index(schema, TABLE_NAME, BODY_INDEX):
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        qualified = f"{schema}.{TABLE_NAME}" if schema else TABLE_NAME
        op.execute(
            f"CREATE INDEX {BODY_INDEX} ON {qualified} "
            f"USING gin (lower(body) gin_trgm_ops)"
        )
    if _has_table(schema, ATTACHMENTS_TABLE) and not _has_index(schema, ATTACHMENTS_TABLE, ATTACHMENTS_INDEX):
        op.create_index(
            ATTACHMENTS_INDEX,
            ATTACHMENTS_TABLE,
            ["conversation_id", "created_at", "id"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    if op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if _has_index(schema, TABLE_NAME, BODY_INDEX):
        op.drop_index(BODY_INDEX, table_name=TABLE_NAME, schema=schema)
    if _has_index(schema, ATTACHMENTS_TABLE, ATTACHMENTS_INDEX):
        op.drop_index(ATTACHMENTS_INDEX, table_name=ATTACHMENTS_TABLE, schema=schema)
