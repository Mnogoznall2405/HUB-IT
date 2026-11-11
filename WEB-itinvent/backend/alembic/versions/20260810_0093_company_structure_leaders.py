"""Bind org-structure leaders and version their photos.

Revision ID: 20260810_0093
Revises: 20260810_0092
Create Date: 2026-08-10 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260810_0093"
down_revision = "20260810_0092"
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
    if "person_employee_code" not in columns:
        op.add_column(
            "org_structure_nodes",
            sa.Column("person_employee_code", sa.String(length=128), nullable=True),
            schema=schema,
        )
    if "person_photo_updated_at" not in columns:
        op.add_column(
            "org_structure_nodes",
            sa.Column("person_photo_updated_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table("org_structure_nodes", schema=schema):
        return
    columns = _columns()
    if "person_photo_updated_at" in columns:
        op.drop_column("org_structure_nodes", "person_photo_updated_at", schema=schema)
    if "person_employee_code" in columns:
        op.drop_column("org_structure_nodes", "person_employee_code", schema=schema)
