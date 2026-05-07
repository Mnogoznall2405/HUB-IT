"""Add user avatar_url column."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260506_0032"
down_revision = "20260506_0031"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _column_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "").strip().lower()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = "app"
    table_name = "users"
    if not _has_table(schema, table_name):
        return

    columns = _column_names(schema, table_name)
    if "avatar_url" in columns:
        return

    op.add_column(
        table_name,
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = "app"
    table_name = "users"
    if not _has_table(schema, table_name):
        return

    columns = _column_names(schema, table_name)
    if "avatar_url" not in columns:
        return

    op.drop_column(table_name, "avatar_url", schema=schema)
