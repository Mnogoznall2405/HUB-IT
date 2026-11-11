"""Add object_ref to monitoring targets: the IT object a monitored device belongs to.

Revision ID: 20261030_0153
Revises: 20261030_0152

Additive and nullable, added "if missing". The monitoring model selects the column, so apply this
migration explicitly at release time before restarting the backend.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261030_0153"
down_revision = "20261030_0152"
branch_labels = None
depends_on = None

TABLE = "monitoring_targets"
COLUMN = "object_ref"
INDEX = "ix_monitoring_targets_object_ref"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _inspect(schema: str | None):
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return None, set(), set()
    columns = {item["name"] for item in inspector.get_columns(TABLE, schema=schema)}
    indexes = {item["name"] for item in inspector.get_indexes(TABLE, schema=schema)}
    return inspector, columns, indexes


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector, columns, indexes = _inspect(schema)
    if inspector is None:
        return
    if COLUMN not in columns:
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(length=128), nullable=True), schema=schema)
    if INDEX not in indexes:
        op.create_index(INDEX, TABLE, [COLUMN], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector, columns, indexes = _inspect(schema)
    if inspector is None:
        return
    if INDEX in indexes:
        op.drop_index(INDEX, table_name=TABLE, schema=schema)
    if COLUMN in columns:
        with op.batch_alter_table(TABLE, schema=schema) as batch:
            batch.drop_column(COLUMN)
