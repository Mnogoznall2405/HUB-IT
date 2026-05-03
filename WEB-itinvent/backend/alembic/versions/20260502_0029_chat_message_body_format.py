"""Move chat message body format schema ownership into Alembic."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260502_0029"
down_revision = "20260502_0028"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _chat_messages_schema() -> str | None:
    inspector = sa.inspect(op.get_bind())
    for schema in ("chat", None, "public"):
        if inspector.has_table("chat_messages", schema=schema):
            return schema
    return None


def _column_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("chat_messages", schema=schema):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_columns("chat_messages", schema=schema)
    }


def _index_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("chat_messages", schema=schema):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_indexes("chat_messages", schema=schema)
    }


def upgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _chat_messages_schema()
    if chat_schema is None:
        return

    columns = _column_names(chat_schema)
    if "body_format" not in columns:
        op.add_column(
            "chat_messages",
            sa.Column("body_format", sa.String(length=16), nullable=False, server_default="plain"),
            schema=chat_schema,
        )

    indexes = _index_names(chat_schema)
    accepted_index_names = {
        "ix_chat_messages_body_format",
        "idx_chat_messages_body_format",
        "ix_chat_chat_messages_body_format",
    }
    if not accepted_index_names.intersection(indexes):
        op.create_index(
            "ix_chat_messages_body_format",
            "chat_messages",
            ["body_format"],
            unique=False,
            schema=chat_schema,
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _chat_messages_schema()
    if chat_schema is None:
        return

    indexes = _index_names(chat_schema)
    if "ix_chat_messages_body_format" in indexes:
        op.drop_index("ix_chat_messages_body_format", table_name="chat_messages", schema=chat_schema)
    columns = _column_names(chat_schema)
    if "body_format" in columns:
        op.drop_column("chat_messages", "body_format", schema=chat_schema)
