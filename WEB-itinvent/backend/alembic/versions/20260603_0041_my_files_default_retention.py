"""my files default retention one day

Revision ID: 20260603_0041
Revises: 20260603_0040
Create Date: 2026-06-03 18:40:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0041"
down_revision = "20260603_0040"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if not _has_table(app_schema, "my_files"):
        return
    op.alter_column(
        "my_files",
        "retention_days",
        server_default="1",
        existing_type=sa.Integer(),
        existing_nullable=False,
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if not _has_table(app_schema, "my_files"):
        return
    op.alter_column(
        "my_files",
        "retention_days",
        server_default="10",
        existing_type=sa.Integer(),
        existing_nullable=False,
        schema=app_schema,
    )
