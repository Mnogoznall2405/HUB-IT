"""Add a role (edit / comment / view) to My Files collaborators.

Revision ID: 20261103_0158
Revises: 20261103_0157

Added "if missing"; every existing collaborator keeps full editing rights (``edit``).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261103_0158"
down_revision = "20261103_0157"
branch_labels = None
depends_on = None

TABLE = "my_file_collaborators"
COLUMN = "role"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_column(schema: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return True  # the table comes from migration 0156; nothing to alter before it exists
    return any(column["name"] == COLUMN for column in inspector.get_columns(TABLE, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(schema):
        return
    op.add_column(
        TABLE,
        sa.Column(COLUMN, sa.String(16), nullable=False, server_default="edit"),
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
