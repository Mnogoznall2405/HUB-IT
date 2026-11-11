"""Add GIP object role and per-direction site manager assignments.

Revision ID: 20260907_0107
Revises: 20260901_0106
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260907_0107"
down_revision = "20260901_0106"
branch_labels = None
depends_on = None


ROLES_TABLE = "construction_object_role_assignments"
DIRECTION_ROLES_TABLE = "construction_direction_role_assignments"
OLD_ROLE_CHECK = "ck_app_construction_object_role_key"
NEW_ROLE_CHECK = "ck_app_construction_object_role_key_v2"
DIRECTION_ROLE_CHECK = "ck_app_construction_direction_role_key"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_check(schema: str | None, table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    try:
        checks = inspector.get_check_constraints(table_name, schema=schema)
    except NotImplementedError:
        return False
    return any(str(item.get("name") or "") == constraint_name for item in checks)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    dialect = bind.dialect.name

    if _has_table(schema, ROLES_TABLE):
        if dialect == "postgresql":
            if _has_check(schema, ROLES_TABLE, OLD_ROLE_CHECK):
                op.drop_constraint(OLD_ROLE_CHECK, ROLES_TABLE, schema=schema, type_="check")
            if not _has_check(schema, ROLES_TABLE, NEW_ROLE_CHECK):
                op.create_check_constraint(
                    NEW_ROLE_CHECK,
                    ROLES_TABLE,
                    "role_key IN ("
                    "'project_lead', 'pto_manager', 'umto_coordinator', 'chief_project_engineer'"
                    ")",
                    schema=schema,
                )
        else:
            with op.batch_alter_table(ROLES_TABLE, schema=schema) as batch:
                batch.drop_constraint(OLD_ROLE_CHECK, type_="check")
                batch.create_check_constraint(
                    NEW_ROLE_CHECK,
                    "role_key IN ("
                    "'project_lead', 'pto_manager', 'umto_coordinator', 'chief_project_engineer'"
                    ")",
                )

    if not _has_table(schema, DIRECTION_ROLES_TABLE):
        op.create_table(
            DIRECTION_ROLES_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("group_ref", sa.String(length=64), nullable=False),
            sa.Column("role_key", sa.String(length=32), nullable=False),
            sa.Column("employee_code", sa.String(length=128), nullable=False),
            sa.Column("employee_name", sa.String(length=255), nullable=False),
            sa.Column("employee_position", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("employee_department", sa.String(length=255), nullable=False, server_default=""),
            sa.Column(
                "employee_department_location",
                sa.String(length=255),
                nullable=False,
                server_default="",
            ),
            sa.Column(
                "valid_from",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
            sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(
                "role_key IN ('site_manager')",
                name=DIRECTION_ROLE_CHECK,
            ),
            sa.PrimaryKeyConstraint("id", name="pk_app_construction_direction_role_assignments"),
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_direction_roles_object_group",
            DIRECTION_ROLES_TABLE,
            ["object_id", "group_ref", "role_key"],
            schema=schema,
        )
        op.create_index(
            "ix_app_construction_direction_roles_employee",
            DIRECTION_ROLES_TABLE,
            ["employee_code"],
            schema=schema,
        )
        op.create_index(
            "uq_app_construction_direction_active_role",
            DIRECTION_ROLES_TABLE,
            ["object_id", "group_ref", "role_key"],
            unique=True,
            schema=schema,
            postgresql_where=sa.text("valid_to IS NULL"),
            sqlite_where=sa.text("valid_to IS NULL"),
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    bind = op.get_bind()
    dialect = bind.dialect.name

    if _has_table(schema, DIRECTION_ROLES_TABLE):
        op.drop_table(DIRECTION_ROLES_TABLE, schema=schema)

    if _has_table(schema, ROLES_TABLE):
        if dialect == "postgresql":
            if _has_check(schema, ROLES_TABLE, NEW_ROLE_CHECK):
                op.drop_constraint(NEW_ROLE_CHECK, ROLES_TABLE, schema=schema, type_="check")
            if not _has_check(schema, ROLES_TABLE, OLD_ROLE_CHECK):
                op.create_check_constraint(
                    OLD_ROLE_CHECK,
                    ROLES_TABLE,
                    "role_key IN ('project_lead', 'pto_manager', 'umto_coordinator')",
                    schema=schema,
                )
        else:
            with op.batch_alter_table(ROLES_TABLE, schema=schema) as batch:
                batch.drop_constraint(NEW_ROLE_CHECK, type_="check")
                batch.create_check_constraint(
                    OLD_ROLE_CHECK,
                    "role_key IN ('project_lead', 'pto_manager', 'umto_coordinator')",
                )
