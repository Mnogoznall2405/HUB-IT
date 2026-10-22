"""Make monitoring_targets.network_device_id optional (devices are connected without a «Сети» card).

Revision ID: 20261022_0143
Revises: 20261021_0142

Only drops NOT NULL; the UNIQUE constraint stays (several NULLs are allowed), existing targets keep their card ids.
Downgrade refuses to run while unlinked targets exist, so no target or history is ever dropped or invented.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261022_0143"
down_revision = "20261021_0142"
branch_labels = None
depends_on = None

TABLE = "monitoring_targets"


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _column(schema: str | None):
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return None
    return next((column for column in inspector.get_columns(TABLE, schema=schema) if column["name"] == "network_device_id"), None)


def upgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    column = _column(schema)
    if column is None or column["nullable"]:
        return
    with op.batch_alter_table(TABLE, schema=schema) as batch:
        batch.alter_column("network_device_id", existing_type=sa.Integer(), nullable=True)


def downgrade():
    if _scope() == "chat":
        return
    schema = _schema()
    column = _column(schema)
    if column is None or not column["nullable"]:
        return
    table = f"{schema}.{TABLE}" if schema else TABLE
    unlinked = op.get_bind().exec_driver_sql(f"SELECT COUNT(*) FROM {table} WHERE network_device_id IS NULL").scalar_one()
    if unlinked:
        raise RuntimeError(f"Downgrade blocked: {unlinked} monitoring target(s) have no network_device_id; delete or link them first.")
    with op.batch_alter_table(TABLE, schema=schema) as batch:
        batch.alter_column("network_device_id", existing_type=sa.Integer(), nullable=False)
