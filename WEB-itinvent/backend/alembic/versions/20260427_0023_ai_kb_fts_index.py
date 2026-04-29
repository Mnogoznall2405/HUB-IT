"""add PostgreSQL FTS index for AI KB chunks

Revision ID: 20260427_0023
Revises: 20260424_0022
Create Date: 2026-04-27 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260427_0023"
down_revision = "20260424_0022"
branch_labels = None
depends_on = None

INDEX_NAME = "ix_app_ai_kb_chunks_fts_simple"


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    if not _is_postgres():
        return
    if not _has_table("app", "ai_kb_chunks"):
        return
    if INDEX_NAME in _index_names("app", "ai_kb_chunks"):
        return
    op.execute(
        f"""
        CREATE INDEX {INDEX_NAME}
        ON app.ai_kb_chunks
        USING GIN (
            to_tsvector('simple', concat_ws(' ', title, content))
        )
        """
    )


def downgrade() -> None:
    if not _is_postgres():
        return
    op.execute(f"DROP INDEX IF EXISTS app.{INDEX_NAME}")
