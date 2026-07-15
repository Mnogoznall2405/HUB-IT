"""Add shared mail runtime snapshots.

Revision ID: 20260714_0067
Revises: 20260714_0066
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260714_0067"
down_revision = "20260714_0066"
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
    if inspector.has_table("mail_runtime_snapshots", schema=schema):
        return
    op.create_table(
        "mail_runtime_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("mailbox_id", sa.String(length=128), nullable=False, server_default="aggregate"),
        sa.Column("snapshot_type", sa.String(length=32), nullable=False),
        sa.Column("context_key", sa.String(length=255), nullable=False, server_default="default"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ok"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "user_id", "mailbox_id", "snapshot_type", "context_key",
            name="uq_app_mail_runtime_snapshot_scope",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_runtime_snapshots_expires",
        "mail_runtime_snapshots",
        ["expires_at"],
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_runtime_snapshots_user_type",
        "mail_runtime_snapshots",
        ["user_id", "snapshot_type"],
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table("mail_runtime_snapshots", schema=schema):
        op.drop_table("mail_runtime_snapshots", schema=schema)
