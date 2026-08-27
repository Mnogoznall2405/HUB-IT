"""Add durable outbox for non-chat application push notifications.

Revision ID: 20260822_0101
Revises: 20260818_0100
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260822_0101"
down_revision = "20260818_0100"
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
    if not op.get_context().as_sql:
        inspector = sa.inspect(op.get_bind())
        if inspector.has_table("push_outbox", schema=schema):
            return
    op.create_table(
        "push_outbox",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dedupe_key", sa.String(length=64), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), nullable=False),
        sa.Column("channel", sa.String(length=32), nullable=False, server_default="system"),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("route", sa.String(length=1024), nullable=False, server_default="/"),
        sa.Column("tag", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("icon", sa.String(length=255), nullable=False, server_default="/pwa-192.png"),
        sa.Column("badge", sa.String(length=255), nullable=False, server_default="/hubit-badge.svg"),
        sa.Column("data_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("ttl_seconds", sa.Integer(), nullable=False, server_default="86400"),
        sa.Column("app_badge_count", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("dedupe_key", name="uq_app_push_outbox_dedupe_key"),
        schema=schema,
    )
    for name, columns in (
        ("ix_app_push_outbox_recipient_user_id", ["recipient_user_id"]),
        ("ix_app_push_outbox_channel", ["channel"]),
        ("ix_app_push_outbox_status", ["status"]),
        ("ix_app_push_outbox_status_next_attempt", ["status", "next_attempt_at"]),
        ("ix_app_push_outbox_recipient_status", ["recipient_user_id", "status"]),
        ("ix_app_push_outbox_updated_at", ["updated_at"]),
    ):
        op.create_index(name, "push_outbox", columns, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not op.get_context().as_sql:
        inspector = sa.inspect(op.get_bind())
        if not inspector.has_table("push_outbox", schema=schema):
            return
    for name in (
        "ix_app_push_outbox_updated_at",
        "ix_app_push_outbox_recipient_status",
        "ix_app_push_outbox_status_next_attempt",
        "ix_app_push_outbox_status",
        "ix_app_push_outbox_channel",
        "ix_app_push_outbox_recipient_user_id",
    ):
        op.drop_index(name, table_name="push_outbox", schema=schema)
    op.drop_table("push_outbox", schema=schema)
