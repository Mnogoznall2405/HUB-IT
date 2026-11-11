"""Add generic AI metadata, rolling context, and personal memory.

Revision ID: 20260814_0098
Revises: 20260814_0097
Create Date: 2026-08-14 13:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260814_0098"
down_revision = "20260814_0097"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(name: str, schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=schema)


def _columns(name: str, schema: str | None) -> set[str]:
    if not _has_table(name, schema):
        return set()
    return {str(item.get("name") or "") for item in sa.inspect(op.get_bind()).get_columns(name, schema=schema)}


def _indexes(name: str, schema: str | None) -> set[str]:
    if not _has_table(name, schema):
        return set()
    return {str(item.get("name") or "") for item in sa.inspect(op.get_bind()).get_indexes(name, schema=schema)}


def _add_columns(table_name: str, schema: str | None, definitions: list[sa.Column]) -> None:
    existing = _columns(table_name, schema)
    if not existing:
        return
    with op.batch_alter_table(table_name, schema=schema) as batch_op:
        for column in definitions:
            if column.name not in existing:
                batch_op.add_column(column)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    _add_columns(
        "ai_bots",
        schema,
        [
            sa.Column("surface", sa.String(length=32), nullable=False, server_default="corporate"),
            sa.Column("placement", sa.String(length=24), nullable=False, server_default="pinned"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("required_permission", sa.String(length=128), nullable=False, server_default="chat.ai.use"),
            sa.Column("use_personal_memory", sa.Boolean(), nullable=False, server_default=sa.true()),
        ],
    )
    if _has_table("ai_bots", schema):
        bot_indexes = _indexes("ai_bots", schema)
        if "ix_app_ai_bots_surface" not in bot_indexes:
            op.create_index("ix_app_ai_bots_surface", "ai_bots", ["surface"], schema=schema)
        if "ix_app_ai_bots_placement" not in bot_indexes:
            op.create_index("ix_app_ai_bots_placement", "ai_bots", ["placement"], schema=schema)
    _add_columns(
        "ai_bot_conversations",
        schema,
        [
            sa.Column("rolling_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("summary_until_seq", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("context_reset_seq", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("use_personal_memory", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("title_source", sa.String(length=24), nullable=False, server_default="assistant"),
        ],
    )
    _add_columns(
        "user_settings",
        schema,
        [sa.Column("ai_personal_memory_enabled", sa.Boolean(), nullable=False, server_default=sa.true())],
    )

    if not _has_table("ai_user_memories", schema):
        op.create_table(
            "ai_user_memories",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("category", sa.String(length=48), nullable=False, server_default="preference"),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("normalized_hash", sa.String(length=64), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("user_id", "normalized_hash", name="uq_app_ai_user_memories_user_hash"),
            schema=schema,
        )
        op.create_index("ix_app_ai_user_memories_user_id", "ai_user_memories", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_user_memories_category", "ai_user_memories", ["category"], schema=schema)
        op.create_index("ix_app_ai_user_memories_normalized_hash", "ai_user_memories", ["normalized_hash"], schema=schema)
        op.create_index("ix_app_ai_user_memories_is_active", "ai_user_memories", ["is_active"], schema=schema)
        op.create_index(
            "ix_app_ai_user_memories_user_active_updated",
            "ai_user_memories",
            ["user_id", "is_active", "updated_at"],
            schema=schema,
        )

    if not _has_table("ai_user_memory_sources", schema):
        op.create_table(
            "ai_user_memory_sources",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("memory_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("message_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("memory_id", "message_id", name="uq_app_ai_user_memory_sources_memory_message"),
            schema=schema,
        )
        op.create_index("ix_app_ai_user_memory_sources_memory_id", "ai_user_memory_sources", ["memory_id"], schema=schema)
        op.create_index("ix_app_ai_user_memory_sources_conversation_id", "ai_user_memory_sources", ["conversation_id"], schema=schema)
        op.create_index("ix_app_ai_user_memory_sources_message_id", "ai_user_memory_sources", ["message_id"], schema=schema)
        op.create_index(
            "ix_app_ai_user_memory_sources_conversation",
            "ai_user_memory_sources",
            ["conversation_id", "created_at"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if _has_table("ai_user_memory_sources", schema):
        op.drop_table("ai_user_memory_sources", schema=schema)
    if _has_table("ai_user_memories", schema):
        op.drop_table("ai_user_memories", schema=schema)

    if _has_table("ai_bots", schema):
        bot_indexes = _indexes("ai_bots", schema)
        for index_name in ("ix_app_ai_bots_placement", "ix_app_ai_bots_surface"):
            if index_name in bot_indexes:
                op.drop_index(index_name, table_name="ai_bots", schema=schema)

    for table_name, names in (
        ("user_settings", ["ai_personal_memory_enabled"]),
        (
            "ai_bot_conversations",
            ["title_source", "use_personal_memory", "context_reset_seq", "summary_until_seq", "rolling_summary"],
        ),
        (
            "ai_bots",
            ["use_personal_memory", "required_permission", "sort_order", "placement", "surface"],
        ),
    ):
        existing = _columns(table_name, schema)
        if not existing:
            continue
        with op.batch_alter_table(table_name, schema=schema) as batch_op:
            for name in names:
                if name in existing:
                    batch_op.drop_column(name)
