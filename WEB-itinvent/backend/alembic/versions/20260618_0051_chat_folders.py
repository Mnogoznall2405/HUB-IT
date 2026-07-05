"""Add per-user chat folders and folder conversation memberships.

Revision ID: 20260618_0051
Revises: 20260618_0050
Create Date: 2026-06-18 18:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260618_0051"
down_revision = "20260618_0050"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _chat_table_schema(table_name: str) -> str | None:
    chat_schema = _schema("chat")
    if _has_table(chat_schema, table_name):
        return chat_schema
    if _has_table(None, table_name):
        return None
    return chat_schema


def upgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _chat_table_schema("chat_conversations")
    folders_table = "chat_folders"
    memberships_table = "chat_folder_conversations"
    if not _has_table(chat_schema, "chat_conversations"):
        return

    if not _has_table(chat_schema, folders_table):
        op.create_table(
            folders_table,
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("id"),
            schema=chat_schema,
        )
        op.create_index("ix_chat_folders_user_id", folders_table, ["user_id"], unique=False, schema=chat_schema)
        op.create_index(
            "ix_chat_folders_user_id_sort_order",
            folders_table,
            ["user_id", "sort_order"],
            unique=False,
            schema=chat_schema,
        )

    if not _has_table(chat_schema, memberships_table):
        op.create_table(
            memberships_table,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("folder_id", sa.String(length=36), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.ForeignKeyConstraint(["folder_id"], [f"{chat_schema}.{folders_table}.id" if chat_schema else f"{folders_table}.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["conversation_id"], [f"{chat_schema}.chat_conversations.id" if chat_schema else "chat_conversations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("folder_id", "conversation_id", name="uq_chat_folder_conversations_folder_conversation"),
            schema=chat_schema,
        )
        op.create_index("ix_chat_folder_conversations_folder_id", memberships_table, ["folder_id"], unique=False, schema=chat_schema)
        op.create_index("ix_chat_folder_conversations_conversation_id", memberships_table, ["conversation_id"], unique=False, schema=chat_schema)
        op.create_index("ix_chat_folder_conversations_user_id", memberships_table, ["user_id"], unique=False, schema=chat_schema)
        op.create_index(
            "ix_chat_folder_conversations_user_id_folder_id",
            memberships_table,
            ["user_id", "folder_id"],
            unique=False,
            schema=chat_schema,
        )


def downgrade() -> None:
    if _scope() == "app":
        return
    chat_schema = _chat_table_schema("chat_conversations")
    memberships_table = "chat_folder_conversations"
    folders_table = "chat_folders"
    if _has_table(chat_schema, memberships_table):
        op.drop_index("ix_chat_folder_conversations_user_id_folder_id", table_name=memberships_table, schema=chat_schema)
        op.drop_index("ix_chat_folder_conversations_user_id", table_name=memberships_table, schema=chat_schema)
        op.drop_index("ix_chat_folder_conversations_conversation_id", table_name=memberships_table, schema=chat_schema)
        op.drop_index("ix_chat_folder_conversations_folder_id", table_name=memberships_table, schema=chat_schema)
        op.drop_table(memberships_table, schema=chat_schema)
    if _has_table(chat_schema, folders_table):
        op.drop_index("ix_chat_folders_user_id_sort_order", table_name=folders_table, schema=chat_schema)
        op.drop_index("ix_chat_folders_user_id", table_name=folders_table, schema=chat_schema)
        op.drop_table(folders_table, schema=chat_schema)
