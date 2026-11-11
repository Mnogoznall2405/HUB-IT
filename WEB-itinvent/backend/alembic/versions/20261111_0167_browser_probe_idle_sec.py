"""Add idle_sec to browser_probe_visits (schema=2 focus events split dwell vs idle).

Revision ID: 20261111_0167
Revises: 20261111_0166

Agent 1.4.19 reports time without keyboard/mouse input separately as idle_sec.
Nullable so pre-migration rows and History rows keep NULL.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261111_0167"
down_revision = "20261111_0166"
branch_labels = None
depends_on = None

TABLE = "browser_probe_visits"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns(schema: str | None, table_name: str) -> set[str]:
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        return
    if "idle_sec" in _columns(schema, TABLE):
        return
    op.add_column(TABLE, sa.Column("idle_sec", sa.Float(), nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        return
    if "idle_sec" in _columns(schema, TABLE):
        op.drop_column(TABLE, "idle_sec", schema=schema)
