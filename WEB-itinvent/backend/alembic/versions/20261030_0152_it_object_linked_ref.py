"""Add linked_ref to IT objects: the ITINVENT branch of an object created in HUB-IT.

Revision ID: 20261030_0152
Revises: 20261029_0151

Additive and nullable. The IT objects API answers 503 until this migration is applied explicitly at
release time (the model selects the column); nothing else depends on it.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261030_0152"
down_revision = "20261029_0151"
branch_labels = None
depends_on = None

TABLE = "it_objects"
COLUMN = "linked_ref"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return True  # nothing to alter: the registry itself is created by 0149
    return any(column["name"] == COLUMN for column in inspector.get_columns(TABLE, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_column(schema):
        op.add_column(TABLE, sa.Column(COLUMN, sa.String(length=128), nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE, schema=schema) and any(
        column["name"] == COLUMN for column in inspector.get_columns(TABLE, schema=schema)
    ):
        with op.batch_alter_table(TABLE, schema=schema) as batch:
            batch.drop_column(COLUMN)
