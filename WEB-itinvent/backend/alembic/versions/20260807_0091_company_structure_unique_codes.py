"""Keep every ZUP department code on one company-structure card.

Revision ID: 20260807_0091
Revises: 20260807_0090
Create Date: 2026-08-07 15:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260807_0091"
down_revision = "20260807_0090"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_index(name: str) -> bool:
    indexes = sa.inspect(op.get_bind()).get_indexes(
        "org_structure_department_links",
        schema=_schema(),
    )
    return any(index.get("name") == name for index in indexes)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table("org_structure_department_links", schema=schema):
        return
    index_name = "uq_app_org_structure_department_code"
    if not _has_index(index_name):
        op.create_index(
            index_name,
            "org_structure_department_links",
            ["department_code"],
            unique=True,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table("org_structure_department_links", schema=schema):
        index_name = "uq_app_org_structure_department_code"
        if _has_index(index_name):
            op.drop_index(
                index_name,
                table_name="org_structure_department_links",
                schema=schema,
            )
