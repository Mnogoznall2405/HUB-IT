"""Add HUB-owned construction object passports and project teams.

Revision ID: 20260901_0106
Revises: 20260901_0105
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260901_0106"
down_revision = "20260901_0105"
branch_labels = None
depends_on = None


OBJECTS_TABLE = "construction_objects"
GROUPS_TABLE = "construction_object_1c_groups"
ROLES_TABLE = "construction_object_role_assignments"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, OBJECTS_TABLE):
        op.create_table(
            OBJECTS_TABLE,
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False),
            sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id", name="pk_app_construction_objects"),
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_objects_active_name",
            OBJECTS_TABLE,
            ["is_active", "name"],
            schema=schema,
        )

    if not _has_table(schema, GROUPS_TABLE):
        op.create_table(
            GROUPS_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("group_ref", sa.String(length=64), nullable=False),
            sa.Column("group_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id", name="pk_app_construction_object_1c_groups"),
            sa.UniqueConstraint("group_ref", name="uq_app_construction_object_1c_group_ref"),
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_object_1c_groups_object",
            GROUPS_TABLE,
            ["object_id"],
            schema=schema,
        )

    if not _has_table(schema, ROLES_TABLE):
        op.create_table(
            ROLES_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("role_key", sa.String(length=32), nullable=False),
            sa.Column("employee_code", sa.String(length=128), nullable=False),
            sa.Column("employee_name", sa.String(length=255), nullable=False),
            sa.Column("employee_position", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("employee_department", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("employee_department_location", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
            sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.CheckConstraint(
                "role_key IN ('project_lead', 'pto_manager', 'umto_coordinator')",
                name="ck_app_construction_object_role_key",
            ),
            sa.PrimaryKeyConstraint("id", name="pk_app_construction_object_role_assignments"),
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_object_roles_object",
            ROLES_TABLE,
            ["object_id", "role_key"],
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_object_roles_employee",
            ROLES_TABLE,
            ["employee_code"],
            schema=schema,
        )
        op.create_index(
            "uq_app_construction_object_active_role",
            ROLES_TABLE,
            ["object_id", "role_key"],
            unique=True,
            schema=schema,
            postgresql_where=sa.text("valid_to IS NULL"),
            sqlite_where=sa.text("valid_to IS NULL"),
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in (ROLES_TABLE, GROUPS_TABLE, OBJECTS_TABLE):
        if _has_table(schema, table_name):
            op.drop_table(table_name, schema=schema)
