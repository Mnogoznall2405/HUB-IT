"""Track the live Document Server session key on My Files documents.

Revision ID: 20261110_0165
Revises: 20261110_0164

With ``forcesave`` enabled a mid-session save can retire content into a version while the
editing session keeps running; new editors must then reuse the running session's key instead
of a fresh revision-derived key, or they would open a parallel session whose saves end up
stale. The column stores that key while a session is open (empty once it is closed).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261110_0165"
down_revision = "20261110_0164"
branch_labels = None
depends_on = None

TABLE = "my_files"
COLUMN = "office_session_key"


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
        sa.Column(COLUMN, sa.String(64), nullable=False, server_default=""),
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
