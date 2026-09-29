"""Per-user My Files storage quota override (users.my_files_quota_bytes).

Revision ID: 20260922_0120
Revises: 20260919_0119
Create Date: 2026-09-22 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260922_0120"
down_revision = "20260919_0119"
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
    if not inspector.has_table("users", schema=schema):
        return
    existing = {
        str(column.get("name")).lower()
        for column in inspector.get_columns("users", schema=schema)
    }
    if "my_files_quota_bytes" not in existing:
        op.add_column(
            "users",
            sa.Column("my_files_quota_bytes", sa.BigInteger(), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("users", schema=schema):
        return
    existing = {
        str(column.get("name")).lower()
        for column in inspector.get_columns("users", schema=schema)
    }
    if "my_files_quota_bytes" in existing:
        op.drop_column("users", "my_files_quota_bytes", schema=schema)
