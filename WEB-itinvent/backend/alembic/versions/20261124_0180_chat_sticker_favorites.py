"""Add chat sticker favorites, recents and per-user pack ordering.

Revision ID: 20261124_0180
Revises: 20261124_0179
Create Date: 2026-11-24 12:00:00.000000

Created "if missing" in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime); skipped only when the database has no chat tables at all,
never by ``itinvent_scope``.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261124_0180"
down_revision = "20261124_0179"
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        col["name"] == column_name
        for col in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    )


def _chat_tables_schema() -> str | None:
    """Schema where the chat tables live: logical ``chat`` or legacy ``public``."""
    chat_schema = _schema("chat")
    if _has_table(chat_schema, "chat_conversations"):
        return chat_schema
    if _has_table(None, "chat_conversations"):
        return None
    return chat_schema


def _chat_tables_present() -> bool:
    """Skip only when the database has no chat tables at all (logical ``chat`` schema or
    legacy ``public``), never by ``itinvent_scope``."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if bind.dialect.name == "postgresql" and inspector.has_table("chat_conversations", schema="chat"):
        return True
    return bool(inspector.has_table("chat_conversations"))


def _sticker_fk(schema: str | None) -> str:
    return f"{schema + '.' if schema else ''}chat_stickers.id"


def _ensure_base_sticker_tables(schema: str | None) -> None:
    """Repair guard: create the 0086 base tables if they are missing.

    The pre-release 0086 detection looked only at ``chat.chat_conversations``
    and silently skipped databases whose chat tables live in ``public``;
    such environments carry the 0086 stamp without the tables, and the
    foreign keys below would abort the release upgrade. 0178 has not been
    applied anywhere yet (production sits at 0176), so healing here is
    safe and forward-only: existing tables are untouched, missing ones are
    created next to ``chat_conversations`` — exactly where the runtime ORM
    resolves them.
    """
    if not _has_table(schema, "chat_sticker_packs"):
        op.create_table(
            "chat_sticker_packs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("short_name", sa.String(length=128), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("sticker_type", sa.String(length=32), nullable=False, server_default="regular"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("short_name"),
            schema=schema,
        )
        op.create_index(
            "ix_chat_sticker_packs_short_name",
            "chat_sticker_packs",
            ["short_name"],
            unique=True,
            schema=schema,
        )

    if not _has_table(schema, "chat_stickers"):
        op.create_table(
            "chat_stickers",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("pack_id", sa.String(length=36), nullable=False),
            sa.Column("telegram_file_id", sa.Text(), nullable=False),
            sa.Column("telegram_file_unique_id", sa.String(length=128), nullable=False),
            sa.Column("emoji", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("format", sa.String(length=20), nullable=False),
            sa.Column("mime_type", sa.String(length=64), nullable=False),
            sa.Column("storage_name", sa.String(length=255), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("width", sa.Integer(), nullable=True),
            sa.Column("height", sa.Integer(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["pack_id"],
                [f"{schema + '.' if schema else ''}chat_sticker_packs.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("pack_id", "telegram_file_unique_id", name="uq_chat_stickers_pack_file_unique"),
            schema=schema,
        )
        op.create_index("ix_chat_stickers_pack_id", "chat_stickers", ["pack_id"], schema=schema)
        op.create_index("ix_chat_stickers_pack_sort", "chat_stickers", ["pack_id", "sort_order"], schema=schema)

    if not _has_table(schema, "chat_user_sticker_packs"):
        op.create_table(
            "chat_user_sticker_packs",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("pack_id", sa.String(length=36), nullable=False),
            sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["pack_id"],
                [f"{schema + '.' if schema else ''}chat_sticker_packs.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "pack_id", name="uq_chat_user_sticker_packs_user_pack"),
            schema=schema,
        )
        op.create_index("ix_chat_user_sticker_packs_user_id", "chat_user_sticker_packs", ["user_id"], schema=schema)
        op.create_index("ix_chat_user_sticker_packs_pack_id", "chat_user_sticker_packs", ["pack_id"], schema=schema)
        op.create_index("ix_chat_user_sticker_packs_user_added", "chat_user_sticker_packs", ["user_id", "added_at"], schema=schema)


def upgrade() -> None:
    if not _chat_tables_present():
        return
    schema = _chat_tables_schema()
    _ensure_base_sticker_tables(schema)

    if not _has_table(schema, "chat_user_favorite_stickers"):
        op.create_table(
            "chat_user_favorite_stickers",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("sticker_id", sa.String(length=36), nullable=False),
            sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["sticker_id"],
                [_sticker_fk(schema)],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "sticker_id",
                name="uq_chat_user_favorite_stickers_user_sticker",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_chat_user_favorite_stickers_sticker_id",
            "chat_user_favorite_stickers",
            ["sticker_id"],
            schema=schema,
        )
        op.create_index(
            "ix_chat_user_favorite_stickers_user_added",
            "chat_user_favorite_stickers",
            ["user_id", "added_at"],
            schema=schema,
        )

    if not _has_table(schema, "chat_user_recent_stickers"):
        op.create_table(
            "chat_user_recent_stickers",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("sticker_id", sa.String(length=36), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(
                ["sticker_id"],
                [_sticker_fk(schema)],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "sticker_id",
                name="uq_chat_user_recent_stickers_user_sticker",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_chat_user_recent_stickers_sticker_id",
            "chat_user_recent_stickers",
            ["sticker_id"],
            schema=schema,
        )
        op.create_index(
            "ix_chat_user_recent_stickers_user_position",
            "chat_user_recent_stickers",
            ["user_id", "position"],
            schema=schema,
        )

    if _has_table(schema, "chat_user_sticker_packs") and not _has_column(
        schema, "chat_user_sticker_packs", "position"
    ):
        op.add_column(
            "chat_user_sticker_packs",
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            schema=schema,
        )


def downgrade() -> None:
    if not _chat_tables_present():
        return
    schema = _chat_tables_schema()
    if _has_column(schema, "chat_user_sticker_packs", "position"):
        op.drop_column("chat_user_sticker_packs", "position", schema=schema)
    for table_name in ("chat_user_recent_stickers", "chat_user_favorite_stickers"):
        if _has_table(schema, table_name):
            op.drop_table(table_name, schema=schema)
