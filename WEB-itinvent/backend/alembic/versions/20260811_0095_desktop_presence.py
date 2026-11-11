"""Add session-bound HUB Desktop presence.

Revision ID: 20260811_0095
Revises: 20260811_0094
Create Date: 2026-08-11 21:15:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260811_0095"
down_revision = "20260811_0094"
branch_labels = None
depends_on = None


TABLE_NAME = "desktop_presence"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE_NAME, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema):
        return
    op.create_table(
        TABLE_NAME,
        sa.Column("session_id", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        schema=schema,
    )
    op.create_index("ix_app_desktop_presence_user_id", TABLE_NAME, ["user_id"], schema=schema)
    op.create_index("ix_app_desktop_presence_expires_at", TABLE_NAME, ["expires_at"], schema=schema)
    op.create_index(
        "ix_app_desktop_presence_user_expires",
        TABLE_NAME,
        ["user_id", "expires_at"],
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema):
        op.drop_table(TABLE_NAME, schema=schema)
