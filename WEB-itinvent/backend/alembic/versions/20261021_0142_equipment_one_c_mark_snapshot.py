"""Add equipment_one_c_marks.part_no_snapshot / model_snapshot (state of the card at marking time).

Revision ID: 20261021_0142
Revises: 20261020_0141

Two nullable columns, added "if missing". Existing marks keep NULL ("no snapshot"), which the
UI treats as "not stale". The code probes for the columns and works without them (marks just
carry no snapshot), so it can be deployed before this migration is run explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261021_0142"
down_revision = "20261020_0141"
branch_labels = None
depends_on = None

TABLE = "equipment_one_c_marks"
COLUMNS = (
    ("part_no_snapshot", sa.String(length=200)),
    ("model_snapshot", sa.String(length=255)),
)


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
    existing = _columns(schema)
    if existing is None:
        return
    for name, column_type in COLUMNS:
        if name not in existing:
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _columns(schema)
    if existing is None:
        return
    present = [name for name, _ in COLUMNS if name in existing]
    if not present:
        return
    with op.batch_alter_table(TABLE, schema=schema) as batch:
        for name in present:
            batch.drop_column(name)
