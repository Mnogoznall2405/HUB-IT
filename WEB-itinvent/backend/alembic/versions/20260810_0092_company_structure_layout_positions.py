"""Store manual positions for company-structure cards.

Revision ID: 20260810_0092
Revises: 20260807_0091
Create Date: 2026-08-10 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260810_0092"
down_revision = "20260807_0091"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _columns() -> set[str]:
    return {
        str(column.get("name") or "")
        for column in sa.inspect(op.get_bind()).get_columns(
            "org_structure_nodes",
            schema=_schema(),
        )
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table("org_structure_nodes", schema=schema):
        return
    columns = _columns()
    if "layout_x" not in columns:
        op.add_column(
            "org_structure_nodes",
            sa.Column("layout_x", sa.Float(), nullable=True),
            schema=schema,
        )
    if "layout_y" not in columns:
        op.add_column(
            "org_structure_nodes",
            sa.Column("layout_y", sa.Float(), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table("org_structure_nodes", schema=schema):
        return
    columns = _columns()
    if "layout_y" in columns:
        op.drop_column("org_structure_nodes", "layout_y", schema=schema)
    if "layout_x" in columns:
        op.drop_column("org_structure_nodes", "layout_x", schema=schema)
