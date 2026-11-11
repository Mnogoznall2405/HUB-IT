"""Add a human readable ``details`` column to the My Files audit log.

Revision ID: 20261103_0157
Revises: 20261102_0156

Holds what exactly changed (who was added/removed, which version was saved or restored).
Added "if missing"; existing rows keep an empty value.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261103_0157"
down_revision = "20261102_0156"
branch_labels = None
depends_on = None

TABLE = "my_file_audit"
COLUMN = "details"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return True  # nothing to alter: the table is created with the column by its own migration/model
    return any(column["name"] == COLUMN for column in inspector.get_columns(TABLE, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(schema):
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.Text(), nullable=False, server_default=""),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE, schema=schema) and any(
        column["name"] == COLUMN for column in inspector.get_columns(TABLE, schema=schema)
    ):
        op.drop_column(TABLE, COLUMN, schema=schema)
