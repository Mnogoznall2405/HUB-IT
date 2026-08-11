"""Add Telegram sticker packs for Chat.

Revision ID: 20260806_0086
Revises: 20260806_0085
Create Date: 2026-08-06 16:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260806_0086"
down_revision = "20260806_0085"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "chat" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "app":
        return
    schema = _schema()

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


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _schema()
    for table_name in ("chat_user_sticker_packs", "chat_stickers", "chat_sticker_packs"):
        if _has_table(schema, table_name):
            op.drop_table(table_name, schema=schema)
