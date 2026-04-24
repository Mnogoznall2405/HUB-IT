"""Add task completed tracking source and backfill legacy completed_at."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260328_0011"
down_revision = "20260328_0010"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _qualified_table(schema_name: str | None, table_name: str) -> str:
    if schema_name:
        return f'"{schema_name}"."{table_name}"'
    return table_name


def _has_column(table_name: str, column_name: str, schema_name: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(str(column.get("name") or "") == column_name for column in inspector.get_columns(table_name, schema=schema_name))


def _has_index(table_name: str, index_name: str, schema_name: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(str(index.get("name") or "") == index_name for index in inspector.get_indexes(table_name, schema=schema_name))


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    table_name = _qualified_table(app_schema, "hub_tasks")

    if not _has_column("hub_tasks", "completed_at_source", app_schema):
        with op.batch_alter_table("hub_tasks", schema=app_schema) as batch_op:
            batch_op.add_column(sa.Column("completed_at_source", sa.Text(), nullable=True))

    if not _has_index("hub_tasks", "idx_hub_tasks_completed_at", app_schema):
        op.create_index("idx_hub_tasks_completed_at", "hub_tasks", ["completed_at"], unique=False, schema=app_schema)

    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET completed_at = CASE
                    WHEN LOWER(COALESCE(status, '')) = 'done'
                        THEN COALESCE(NULLIF(completed_at, ''), NULLIF(reviewed_at, ''), NULLIF(submitted_at, ''), NULLIF(updated_at, ''), NULLIF(created_at, ''))
                    ELSE NULL
                END,
                completed_at_source = CASE
                    WHEN LOWER(COALESCE(status, '')) != 'done' THEN NULL
                    WHEN NULLIF(completed_at, '') IS NOT NULL THEN COALESCE(NULLIF(completed_at_source, ''), 'explicit')
                    WHEN NULLIF(reviewed_at, '') IS NOT NULL THEN 'reviewed_at'
                    WHEN NULLIF(submitted_at, '') IS NOT NULL THEN 'submitted_at'
                    WHEN NULLIF(updated_at, '') IS NOT NULL THEN 'updated_at'
                    WHEN NULLIF(created_at, '') IS NOT NULL THEN 'backfill'
                    ELSE NULL
                END
            """
        )
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if _has_index("hub_tasks", "idx_hub_tasks_completed_at", app_schema):
        op.drop_index("idx_hub_tasks_completed_at", table_name="hub_tasks", schema=app_schema)
    if _has_column("hub_tasks", "completed_at_source", app_schema):
        with op.batch_alter_table("hub_tasks", schema=app_schema) as batch_op:
            batch_op.drop_column("completed_at_source")
