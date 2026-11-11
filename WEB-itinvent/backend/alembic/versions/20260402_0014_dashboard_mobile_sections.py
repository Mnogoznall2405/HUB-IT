"""add dashboard mobile sections to user settings

Revision ID: 20260402_0014
Revises: 20260330_0013
Create Date: 2026-04-02 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260402_0014"
down_revision = "20260330_0013"
branch_labels = None
depends_on = None


def _column_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {str(item.get("name") or "").strip().lower() for item in inspector.get_columns(table_name, schema=schema)}


def upgrade() -> None:
    user_settings_columns = _column_names("app", "user_settings")
    if "dashboard_mobile_sections" not in user_settings_columns:
        op.add_column(
            "user_settings",
            sa.Column("dashboard_mobile_sections", sa.Text(), nullable=True),
            schema="app",
        )


def downgrade() -> None:
    user_settings_columns = _column_names("app", "user_settings")
    if "dashboard_mobile_sections" in user_settings_columns:
        op.drop_column("user_settings", "dashboard_mobile_sections", schema="app")
