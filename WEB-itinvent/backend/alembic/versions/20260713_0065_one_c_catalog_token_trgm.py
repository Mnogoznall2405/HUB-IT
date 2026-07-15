"""Add a trigram index for 1C catalogue token substring search.

Revision ID: 20260713_0065
Revises: 20260713_0064
Create Date: 2026-07-13 16:10:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260713_0065"
down_revision = "20260713_0064"
branch_labels = None
depends_on = None

TABLE_NAME = "one_c_catalog_tokens"
INDEX_NAME = "ix_app_one_c_catalog_tokens_token_trgm"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_index(schema: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE_NAME, schema=schema):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == INDEX_NAME.lower()
        for item in inspector.get_indexes(TABLE_NAME, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat" or op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if _has_index(schema):
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    qualified = f"{schema}.{TABLE_NAME}" if schema else TABLE_NAME
    op.execute(
        f"CREATE INDEX {INDEX_NAME} ON {qualified} "
        "USING gin (token gin_trgm_ops)"
    )


def downgrade() -> None:
    if _scope() == "chat" or op.get_bind().dialect.name != "postgresql":
        return
    schema = _schema()
    if _has_index(schema):
        op.drop_index(INDEX_NAME, table_name=TABLE_NAME, schema=schema)
