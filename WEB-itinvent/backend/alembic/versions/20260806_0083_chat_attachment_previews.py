"""Add durable Chat attachment preview queue.

Revision ID: 20260806_0083
Revises: 20260805_0082
Create Date: 2026-08-06 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260806_0083"
down_revision = "20260805_0082"
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
    table_name = "chat_attachment_previews"
    if _has_table(schema, table_name):
        return
    op.create_table(
        table_name,
        sa.Column("attachment_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", sa.String(length=64), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("artifact_rel_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("pdf_filename", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("source_kind", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sheets_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["attachment_id"],
            [f"{schema + '.' if schema else ''}chat_message_attachments.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("attachment_id"),
        schema=schema,
    )
    op.create_index(
        "ix_chat_attachment_previews_status_next_attempt",
        table_name,
        ["status", "next_attempt_at"],
        unique=False,
        schema=schema,
    )
    op.create_index(
        "ix_chat_attachment_previews_lease_expires",
        table_name,
        ["lease_expires_at"],
        unique=False,
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "app":
        return
    schema = _schema()
    table_name = "chat_attachment_previews"
    if not _has_table(schema, table_name):
        return
    op.drop_index(
        "ix_chat_attachment_previews_lease_expires",
        table_name=table_name,
        schema=schema,
    )
    op.drop_index(
        "ix_chat_attachment_previews_status_next_attempt",
        table_name=table_name,
        schema=schema,
    )
    op.drop_table(table_name, schema=schema)
