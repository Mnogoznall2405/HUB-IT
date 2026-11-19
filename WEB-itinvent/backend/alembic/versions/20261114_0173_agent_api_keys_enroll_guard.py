"""Enrollment guard columns for per-agent API keys.

Revision ID: 20261114_0173
Revises: 20261114_0172

``enroll_ip`` records the observed source IP of the first ring-key contact that
minted the bound pair; ``rotate_key`` tasks are only delivered to polls from
the same observed IP, so a ring-key thief polling from a foreign network does
not receive the machine's credentials. ``contested_count`` bounds automatic
key re-mints when a delivered/completed rotation is followed by continued
ring-key requests (theft or failed application signal).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261114_0173"
down_revision = "20261114_0172"
branch_labels = None
depends_on = None

TABLE = "agent_api_keys"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE, schema=schema):
        return
    existing = {col["name"] for col in inspector.get_columns(TABLE, schema=schema)}
    if "enroll_ip" not in existing:
        op.add_column(
            TABLE,
            sa.Column("enroll_ip", sa.String(64), nullable=False, server_default=""),
            schema=schema,
        )
    if "contested_count" not in existing:
        op.add_column(
            TABLE,
            sa.Column("contested_count", sa.Integer(), nullable=False, server_default="0"),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE, schema=schema):
        return
    existing = {col["name"] for col in inspector.get_columns(TABLE, schema=schema)}
    if "contested_count" in existing:
        op.drop_column(TABLE, "contested_count", schema=schema)
    if "enroll_ip" in existing:
        op.drop_column(TABLE, "enroll_ip", schema=schema)
