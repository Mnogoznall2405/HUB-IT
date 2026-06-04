"""My-files security scan metadata

Revision ID: 20260604_0044
Revises: 20260603_0043
Create Date: 2026-06-04 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260604_0044"
down_revision = "20260603_0043"
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
        sa.Column("security_scan_status", sa.String(length=32), nullable=False, server_default="pending"),
        schema=app_schema,
    )
    op.add_column(
        "my_files",
        sa.Column("security_scan_engine", sa.String(length=64), nullable=False, server_default=""),
        schema=app_schema,
    )
    op.add_column(
        "my_files",
        sa.Column("security_scanned_at", sa.DateTime(timezone=True), nullable=True),
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    op.drop_column("my_files", "security_scanned_at", schema=app_schema)
    op.drop_column("my_files", "security_scan_engine", schema=app_schema)
    op.drop_column("my_files", "security_scan_status", schema=app_schema)
