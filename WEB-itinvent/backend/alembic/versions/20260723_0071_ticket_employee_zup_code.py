"""ticket employees zup_employee_code

Revision ID: 20260723_0071
Revises: 20260722_0070
Create Date: 2026-07-23 12:45:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260723_0071"
down_revision = "20260722_0070"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(table_name, schema=schema):
        return False
    return any(col["name"] == column_name for col in inspector.get_columns(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "ticket_employees"):
        return
    if _has_column(schema, "ticket_employees", "zup_employee_code"):
        return
    op.add_column(
        "ticket_employees",
        sa.Column("zup_employee_code", sa.String(length=64), nullable=True),
        schema=schema,
    )
    op.create_index(
        "ix_ticket_employees_zup_employee_code",
        "ticket_employees",
        ["zup_employee_code"],
        unique=True,
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "ticket_employees"):
        return
    if not _has_column(schema, "ticket_employees", "zup_employee_code"):
        return
    op.drop_index("ix_ticket_employees_zup_employee_code", table_name="ticket_employees", schema=schema)
    op.drop_column("ticket_employees", "zup_employee_code", schema=schema)
