"""Track completion of the HUB-IT introduction.

Revision ID: 20260813_0096
Revises: 20260811_0095
Create Date: 2026-08-13 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260813_0096"
down_revision = "20260811_0095"
branch_labels = None
depends_on = None


TABLE_NAME = "users"
COLUMN_NAME = "about_onboarding_completed_at"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _column_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE_NAME, schema=schema):
        return set()
    return {str(item["name"]) for item in inspector.get_columns(TABLE_NAME, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if COLUMN_NAME not in _column_names(schema):
        op.add_column(
            TABLE_NAME,
            sa.Column(COLUMN_NAME, sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )
    table = sa.table(
        TABLE_NAME,
        sa.column(COLUMN_NAME, sa.DateTime(timezone=True)),
        schema=schema,
    )
    op.execute(
        table.update()
        .where(table.c.about_onboarding_completed_at.is_(None))
        .values(about_onboarding_completed_at=sa.func.now())
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if COLUMN_NAME in _column_names(schema):
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
