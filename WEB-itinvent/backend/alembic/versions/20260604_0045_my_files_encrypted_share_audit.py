"""Encrypt stable my-files share links and add append-only audit

Revision ID: 20260604_0045
Revises: 20260604_0044
Create Date: 2026-06-04 18:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260604_0045"
down_revision = "20260604_0044"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    op.add_column(
        "my_files",
        sa.Column("share_token_enc", sa.Text(), nullable=True),
        schema=app_schema,
    )
    op.create_table(
        "my_file_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("file_id", sa.String(length=64), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actor_username", sa.String(length=50), nullable=False, server_default=""),
        sa.Column("ip_address", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("user_agent", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_audit_file_created",
        "my_file_audit",
        ["file_id", "created_at"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_audit_actor_created",
        "my_file_audit",
        ["actor_user_id", "created_at"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_audit_action_created",
        "my_file_audit",
        ["action", "created_at"],
        unique=False,
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    op.drop_index("ix_app_my_file_audit_action_created", table_name="my_file_audit", schema=app_schema)
    op.drop_index("ix_app_my_file_audit_actor_created", table_name="my_file_audit", schema=app_schema)
    op.drop_index("ix_app_my_file_audit_file_created", table_name="my_file_audit", schema=app_schema)
    op.drop_table("my_file_audit", schema=app_schema)
    op.drop_column("my_files", "share_token_enc", schema=app_schema)
