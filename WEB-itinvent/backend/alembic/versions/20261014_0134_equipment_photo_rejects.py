"""Add reject columns to equipment_photo_checks (a checker may refuse a photo with a reason).

Revision ID: 20261014_0134
Revises: 20261013_0133

Four nullable columns, added "if missing". The application probes for them and leaves them out
of every query until they exist, so the code can be deployed before this migration is run
explicitly at release time (rejecting then answers 503).
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261014_0134"
down_revision = "20261013_0133"
branch_labels = None
depends_on = None

TABLE = "equipment_photo_checks"
COLUMNS = (
    ("rejected_by_user_id", sa.Integer()),
    ("rejected_by_name", sa.String(length=255)),
    ("rejected_at", sa.DateTime(timezone=True)),
    ("reject_reason", sa.String(length=500)),
)


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _existing_columns(schema: str | None) -> set[str] | None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE, schema=schema):
        return None
    return {str(column["name"]) for column in inspector.get_columns(TABLE, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _existing_columns(schema)
    if existing is None:
        return
    for name, column_type in COLUMNS:
        if name not in existing:
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _existing_columns(schema)
    if existing is None:
        return
    present = [name for name, _ in COLUMNS if name in existing]
    if not present:
        return
    with op.batch_alter_table(TABLE, schema=schema) as batch:
        for name in present:
            batch.drop_column(name)
