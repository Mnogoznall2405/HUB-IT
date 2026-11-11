"""add discoverable flag for passkey-first trusted devices

Revision ID: 20260408_0017
Revises: 20260407_0016
Create Date: 2026-04-08 22:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260408_0017"
down_revision = "20260407_0016"
branch_labels = None
depends_on = None


def _column_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {str(item.get("name") or "").strip().lower() for item in inspector.get_columns(table_name, schema=schema)}


def upgrade() -> None:
    columns = _column_names("app", "trusted_devices")
    if "is_discoverable" not in columns:
        op.add_column(
            "trusted_devices",
            sa.Column("is_discoverable", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema="app",
        )
        op.alter_column("trusted_devices", "is_discoverable", server_default=None, schema="app")


def downgrade() -> None:
    columns = _column_names("app", "trusted_devices")
    if "is_discoverable" in columns:
        op.drop_column("trusted_devices", "is_discoverable", schema="app")
