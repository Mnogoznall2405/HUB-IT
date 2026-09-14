"""Add missing purge_token to ai_sandbox_sessions.

Revision ID: 20260909_0112
Revises: 20260909_0111
Create Date: 2026-09-09 15:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260909_0112"
down_revision = "20260909_0111"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(name: str, schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=schema)


def _column_names(table: str, schema: str | None) -> set[str]:
    if not _has_table(table, schema):
        return set()
    return {str(col["name"]) for col in sa.inspect(op.get_bind()).get_columns(table, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table("ai_sandbox_sessions", schema):
        raise RuntimeError("ai_sandbox_sessions is required")
    if "purge_token" not in _column_names("ai_sandbox_sessions", schema):
        op.add_column(
            "ai_sandbox_sessions",
            sa.Column("purge_token", sa.String(length=64), nullable=True),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table("ai_sandbox_sessions", schema) and "purge_token" in _column_names("ai_sandbox_sessions", schema):
        op.drop_column("ai_sandbox_sessions", "purge_token", schema=schema)
