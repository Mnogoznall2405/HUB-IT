"""Add equipment_one_c_marks.kind («ok» reconciled by hand / «mismatch» does not match 1C).

Revision ID: 20261020_0141
Revises: 20261020_0140

One column, added "if missing", existing marks become «ok». The code probes for it and works
without it (only «mismatch» marks answer 503), so it can be deployed before this migration
is run explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261020_0141"
down_revision = "20261020_0140"
branch_labels = None
depends_on = None

TABLE = "equipment_one_c_marks"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns(schema: str | None) -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return None
    return {str(column["name"]) for column in inspector.get_columns(TABLE, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    columns = _columns(schema)
    if columns is None or "kind" in columns:
        return
    op.add_column(
        TABLE,
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="ok"),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    columns = _columns(schema)
    if columns is None or "kind" not in columns:
        return
    with op.batch_alter_table(TABLE, schema=schema) as batch:
        batch.drop_column("kind")
