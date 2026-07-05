"""Add per-database branch filters to user settings.

Revision ID: 20260623_0053
Revises: 20260621_0052
Create Date: 2026-06-23 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_0053"
down_revision = "20260621_0052"
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
    if "database_branch_filters" not in _column_names(schema, "user_settings"):
        op.add_column(
            "user_settings",
            sa.Column("database_branch_filters", sa.Text(), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if "database_branch_filters" in _column_names(schema, "user_settings"):
        op.drop_column("user_settings", "database_branch_filters", schema=schema)
