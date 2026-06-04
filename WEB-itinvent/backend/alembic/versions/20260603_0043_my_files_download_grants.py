"""One-time short-lived download grants for native my-files downloads

Revision ID: 20260603_0043
Revises: 20260603_0042
Create Date: 2026-06-03 21:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0043"
down_revision = "20260603_0042"
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
    op.create_table(
        "my_file_download_grants",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("file_id", sa.String(length=64), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("token_hash"),
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_download_grants_file_id",
        "my_file_download_grants",
        ["file_id"],
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_download_grants_owner_created",
        "my_file_download_grants",
        ["owner_user_id", "created_at"],
        schema=app_schema,
    )
    op.create_index(
        "ix_app_my_file_download_grants_expires_at",
        "my_file_download_grants",
        ["expires_at"],
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    for index_name in (
        "ix_app_my_file_download_grants_expires_at",
        "ix_app_my_file_download_grants_owner_created",
        "ix_app_my_file_download_grants_file_id",
    ):
        op.drop_index(index_name, table_name="my_file_download_grants", schema=app_schema)
    op.drop_table("my_file_download_grants", schema=app_schema)
