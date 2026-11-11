"""Add polls to company feed publications.

Revision ID: 20260807_0090
Revises: 20260807_0089
Create Date: 2026-08-07 11:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260807_0090"
down_revision = "20260807_0089"
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
    if not inspector.has_table("hub_announcement_polls", schema=schema):
        op.create_table(
            "hub_announcement_polls",
            sa.Column("id", sa.Text(), nullable=False),
            sa.Column("announcement_id", sa.Text(), nullable=False),
            sa.Column("question", sa.Text(), nullable=False, server_default=""),
            sa.Column("allows_multiple", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_anonymous", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("closes_at", sa.Text(), nullable=True),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.Column("updated_at", sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("announcement_id"),
            schema=schema,
        )
    if not inspector.has_table("hub_announcement_poll_options", schema=schema):
        op.create_table(
            "hub_announcement_poll_options",
            sa.Column("id", sa.Text(), nullable=False),
            sa.Column("poll_id", sa.Text(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    if not inspector.has_table("hub_announcement_poll_votes", schema=schema):
        op.create_table(
            "hub_announcement_poll_votes",
            sa.Column("poll_id", sa.Text(), nullable=False),
            sa.Column("option_id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint("poll_id", "option_id", "user_id"),
            schema=schema,
        )
    op.create_index("idx_hub_poll_options_poll", "hub_announcement_poll_options", ["poll_id", "sort_order"], unique=False, schema=schema)
    op.create_index("idx_hub_poll_votes_poll_user", "hub_announcement_poll_votes", ["poll_id", "user_id"], unique=False, schema=schema)
    op.create_index("idx_hub_poll_votes_option", "hub_announcement_poll_votes", ["option_id"], unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    for table in (
        "hub_announcement_poll_votes",
        "hub_announcement_poll_options",
        "hub_announcement_polls",
    ):
        if inspector.has_table(table, schema=schema):
            op.drop_table(table, schema=schema)
