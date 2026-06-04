"""Persist my-files share token for stable public URLs

Revision ID: 20260603_0042
Revises: 20260603_0041
Create Date: 2026-06-03 20:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0042"
down_revision = "20260603_0041"
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
        sa.Column("share_token", sa.String(length=128), nullable=True),
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    op.drop_column("my_files", "share_token", schema=app_schema)
