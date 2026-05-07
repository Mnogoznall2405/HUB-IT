"""Add chat message reactions."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260506_0031"
down_revision = "20260506_0030"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _chat_messages_schema() -> str | None:
    inspector = sa.inspect(op.get_bind())
    for schema in ("chat", None, "public"):
        if inspector.has_table("chat_messages", schema=schema):
            return schema
    return "chat" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _column_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "app":
        return

    chat_schema = _chat_messages_schema()
    table_name = "chat_message_reactions"
    if not _has_table(chat_schema, table_name):
        op.create_table(
            table_name,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("message_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("reaction_emoji", sa.String(length=16), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["message_id"], [f"{chat_schema + '.' if chat_schema else ''}chat_messages.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("message_id", "user_id", name="uq_chat_message_reactions_message_user"),
            schema=chat_schema,
        )

    columns = _column_names(chat_schema, table_name)
    if "updated_at" not in columns:
        op.add_column(
            table_name,
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            schema=chat_schema,
        )
        bind = op.get_bind()
        qualified_table = f"{chat_schema}.{table_name}" if chat_schema else table_name
        bind.execute(sa.text(f"UPDATE {qualified_table} SET updated_at = created_at WHERE updated_at IS NULL"))
        op.alter_column(table_name, "updated_at", nullable=False, schema=chat_schema)

    index_names = _index_names(chat_schema, table_name)
    if "ix_chat_message_reactions_message_id" not in index_names:
        op.create_index("ix_chat_message_reactions_message_id", table_name, ["message_id"], unique=False, schema=chat_schema)
    if "ix_chat_message_reactions_user_id" not in index_names:
        op.create_index("ix_chat_message_reactions_user_id", table_name, ["user_id"], unique=False, schema=chat_schema)
    if "ix_chat_message_reactions_message_id_reaction" not in index_names:
        op.create_index("ix_chat_message_reactions_message_id_reaction", table_name, ["message_id", "reaction_emoji"], unique=False, schema=chat_schema)


def downgrade() -> None:
    if _scope() == "app":
        return

    chat_schema = _chat_messages_schema()
    table_name = "chat_message_reactions"
    if not _has_table(chat_schema, table_name):
        return

    index_names = _index_names(chat_schema, table_name)
    for index_name in (
        "ix_chat_message_reactions_message_id_reaction",
        "ix_chat_message_reactions_user_id",
        "ix_chat_message_reactions_message_id",
    ):
        if index_name in index_names:
            op.drop_index(index_name, table_name=table_name, schema=chat_schema)
    op.drop_table(table_name, schema=chat_schema)
