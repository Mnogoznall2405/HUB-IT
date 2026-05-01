"""add departments and resource visibility scopes

Revision ID: 20260501_0026
Revises: 20260430_0025
Create Date: 2026-05-01 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260501_0026"
down_revision = "20260430_0025"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_column(schema: str | None, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return False
    return any(str(item.get("name") or "") == column_name for item in inspector.get_columns(table_name, schema=schema))


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return False
    return any(str(item.get("name") or "") == index_name for item in inspector.get_indexes(table_name, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "departments"):
        op.create_table(
            "departments",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
        op.create_index("ix_departments_name", "departments", ["name"], unique=False, schema=schema)
        op.create_index("ix_departments_is_active", "departments", ["is_active"], unique=False, schema=schema)
    if not _has_table(schema, "department_memberships"):
        op.create_table(
            "department_memberships",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("department_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("role", sa.String(length=32), nullable=False, server_default="member"),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("department_id", "user_id", "role", name="uq_app_department_membership_role"),
            schema=schema,
        )
        op.create_index("ix_app_department_memberships_user_active", "department_memberships", ["user_id", "is_active"], unique=False, schema=schema)
        op.create_index("ix_app_department_memberships_department_active", "department_memberships", ["department_id", "is_active"], unique=False, schema=schema)

    if _has_table(schema, "hub_tasks"):
        with op.batch_alter_table("hub_tasks", schema=schema) as batch_op:
            if not _has_column(schema, "hub_tasks", "department_id"):
                batch_op.add_column(sa.Column("department_id", sa.String(length=64), nullable=True))
            if not _has_column(schema, "hub_tasks", "visibility_scope"):
                batch_op.add_column(sa.Column("visibility_scope", sa.String(length=32), nullable=False, server_default="private"))
        if not _has_index(schema, "hub_tasks", "idx_hub_tasks_department"):
            op.create_index("idx_hub_tasks_department", "hub_tasks", ["department_id", "updated_at"], unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, "hub_tasks"):
        try:
            op.drop_index("idx_hub_tasks_department", table_name="hub_tasks", schema=schema)
        except Exception:
            pass
        with op.batch_alter_table("hub_tasks", schema=schema) as batch_op:
            if _has_column(schema, "hub_tasks", "visibility_scope"):
                batch_op.drop_column("visibility_scope")
            if _has_column(schema, "hub_tasks", "department_id"):
                batch_op.drop_column("department_id")
    if _has_table(schema, "department_memberships"):
        op.drop_index("ix_app_department_memberships_department_active", table_name="department_memberships", schema=schema)
        op.drop_index("ix_app_department_memberships_user_active", table_name="department_memberships", schema=schema)
        op.drop_table("department_memberships", schema=schema)
    if _has_table(schema, "departments"):
        op.drop_index("ix_departments_is_active", table_name="departments", schema=schema)
        op.drop_index("ix_departments_name", table_name="departments", schema=schema)
        op.drop_table("departments", schema=schema)
