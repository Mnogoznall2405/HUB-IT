"""Separate monitoring-only registry cards from the Networks workspace.

Revision ID: 20261016_0137
Revises: 20261015_0136

Existing equipment stays visible. The exact enrolled MikroTik cards are marked
by a separate, reviewed release operation, never by vendor or IP heuristics.
"""
from alembic import op
import sqlalchemy as sa

revision = "20261016_0137"
down_revision = "20261015_0136"
branch_labels = None
depends_on = None


def _schema():
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns():
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("network_devices", schema=_schema())}


def upgrade():
    if op.get_context().config.attributes.get("itinvent_scope") == "chat":
        return
    # "Create if missing": a database whose network tables are created elsewhere (fresh/test DB) has nothing to alter.
    if not sa.inspect(op.get_bind()).has_table("network_devices", schema=_schema()):
        return
    if "monitoring_only" not in _columns():
        op.add_column("network_devices", sa.Column("monitoring_only", sa.Integer(), nullable=False, server_default="0"), schema=_schema())


def downgrade():
    if op.get_context().config.attributes.get("itinvent_scope") == "chat":
        return
    if "monitoring_only" in _columns():
        op.drop_column("network_devices", "monitoring_only", schema=_schema())
