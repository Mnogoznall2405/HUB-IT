"""Store multiple assignees on one HUB task.

Revision ID: 20260901_0105
Revises: 20260827_0104
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0105"
down_revision = "20260827_0104"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_tasks"
COLUMN_NAME = "assignee_user_ids"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == column_name.lower()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        return
    if not _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.add_column(
            TABLE_NAME,
            sa.Column(COLUMN_NAME, sa.Text(), nullable=False, server_default="[]"),
            schema=schema,
        )
    qualified_table = f"{schema}.{TABLE_NAME}" if schema else TABLE_NAME
    op.execute(
        sa.text(
            f"""
            UPDATE {qualified_table}
            SET {COLUMN_NAME} = '[' || CAST(assignee_user_id AS TEXT) || ']'
            WHERE assignee_user_id > 0
              AND ({COLUMN_NAME} IS NULL OR TRIM({COLUMN_NAME}) IN ('', '[]'))
            """
        )
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(schema, TABLE_NAME, COLUMN_NAME):
        op.drop_column(TABLE_NAME, COLUMN_NAME, schema=schema)
