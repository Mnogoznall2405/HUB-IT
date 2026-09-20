"""Add department/city targeting columns for feed announcements.

Revision ID: 20260919_0119
Revises: 20260918_0118
Create Date: 2026-09-19 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260919_0119"
down_revision = "20260918_0118"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


_COLUMNS = ("audience_department_codes", "audience_cities")


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("hub_announcements", schema=schema):
        return
    existing = {
        str(column.get("name")).lower()
        for column in inspector.get_columns("hub_announcements", schema=schema)
    }
    for column_name in _COLUMNS:
        if column_name not in existing:
            op.add_column(
                "hub_announcements",
                sa.Column(column_name, sa.Text(), nullable=False, server_default="[]"),
                schema=schema,
            )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("hub_announcements", schema=schema):
        return
    existing = {
        str(column.get("name")).lower()
        for column in inspector.get_columns("hub_announcements", schema=schema)
    }
    for column_name in _COLUMNS:
        if column_name in existing:
            op.drop_column("hub_announcements", column_name, schema=schema)
