"""Add durable preview jobs for mail and document-flow files.

Revision ID: 20260806_0087
Revises: 20260806_0086
Create Date: 2026-08-06 18:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260806_0087"
down_revision = "20260806_0086"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    table_name = "document_preview_jobs"
    if _has_table(schema, table_name):
        return
    op.create_table(
        table_name,
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("resource_key", sa.String(length=64), nullable=False),
        sa.Column("source_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="queued"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_owner", sa.String(length=96), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("artifact_rel_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_filename", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("content_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
        sa.Column("pdf_filename", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("source_kind", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sheets_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "scope",
            "owner_user_id",
            "resource_key",
            name="uq_app_document_preview_jobs_resource",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_app_document_preview_jobs_status_next",
        table_name,
        ["status", "next_attempt_at"],
        unique=False,
        schema=schema,
    )
    op.create_index(
        "ix_app_document_preview_jobs_lease",
        table_name,
        ["lease_expires_at"],
        unique=False,
        schema=schema,
    )
    op.create_index(
        "ix_app_document_preview_jobs_expires",
        table_name,
        ["expires_at"],
        unique=False,
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    table_name = "document_preview_jobs"
    if not _has_table(schema, table_name):
        return
    op.drop_index("ix_app_document_preview_jobs_expires", table_name=table_name, schema=schema)
    op.drop_index("ix_app_document_preview_jobs_lease", table_name=table_name, schema=schema)
    op.drop_index("ix_app_document_preview_jobs_status_next", table_name=table_name, schema=schema)
    op.drop_table(table_name, schema=schema)
