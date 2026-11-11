"""Add equipment_one_c_marks (manual «reconciled with 1C» mark on an equipment card).

Revision ID: 20261020_0138
Revises: 20261016_0137

The automatic 1C comparison is computed on read; this app-owned table only keeps the manual
mark (who, when, note) keyed by db_id and INV_NO. The code tolerates a missing table (marks
are empty, setting one answers 503), so it can be deployed before this migration is run
explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261020_0138"
down_revision = "20261016_0137"
branch_labels = None
depends_on = None

TABLE = "equipment_one_c_marks"
UNIQUE = "uq_app_equipment_one_c_marks_db_inv"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    if _has_table(schema):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("db_id", sa.String(length=128), nullable=False),
        sa.Column("inv_no", sa.String(length=64), nullable=False),
        sa.Column("marked_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("note", sa.String(length=500), nullable=False, server_default=""),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("db_id", "inv_no", name=UNIQUE),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    if _has_table(schema):
        op.drop_table(TABLE, schema=schema)
