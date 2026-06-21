"""Add configurable mobile bottom navigation items.

Revision ID: 20260621_0052
Revises: 20260618_0051
Create Date: 2026-06-21 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260621_0052"
down_revision = "20260618_0051"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _column_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if "mobile_bottom_nav_items" not in _column_names(schema, "user_settings"):
        op.add_column(
            "user_settings",
            sa.Column("mobile_bottom_nav_items", sa.Text(), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if "mobile_bottom_nav_items" in _column_names(schema, "user_settings"):
        op.drop_column("user_settings", "mobile_bottom_nav_items", schema=schema)
