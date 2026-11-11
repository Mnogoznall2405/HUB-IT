"""Add likes and comments for the company feed.

Revision ID: 20260806_0088
Revises: 20260806_0087
Create Date: 2026-08-06 19:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260806_0088"
down_revision = "20260806_0087"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table("hub_announcement_likes", schema=schema):
        op.create_table(
            "hub_announcement_likes",
            sa.Column("announcement_id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("username", sa.Text(), nullable=False, server_default=""),
            sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint("announcement_id", "user_id"),
            schema=schema,
        )
        op.create_index(
            "idx_hub_announcement_likes_announcement",
            "hub_announcement_likes",
            ["announcement_id", "created_at"],
            unique=False,
            schema=schema,
        )

    if not inspector.has_table("hub_announcement_comments", schema=schema):
        op.create_table(
            "hub_announcement_comments",
            sa.Column("id", sa.Text(), nullable=False),
            sa.Column("announcement_id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("username", sa.Text(), nullable=False, server_default=""),
            sa.Column("full_name", sa.Text(), nullable=False, server_default=""),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
        op.create_index(
            "idx_hub_announcement_comments_announcement",
            "hub_announcement_comments",
            ["announcement_id", "created_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("hub_announcement_comments", schema=schema):
        op.drop_index(
            "idx_hub_announcement_comments_announcement",
            table_name="hub_announcement_comments",
            schema=schema,
        )
        op.drop_table("hub_announcement_comments", schema=schema)
    if inspector.has_table("hub_announcement_likes", schema=schema):
        op.drop_index(
            "idx_hub_announcement_likes_announcement",
            table_name="hub_announcement_likes",
            schema=schema,
        )
        op.drop_table("hub_announcement_likes", schema=schema)
