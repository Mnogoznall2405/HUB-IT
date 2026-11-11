"""Add versioned project roles (team) of IT objects.

Revision ID: 20261102_0154
Revises: 20261030_0153

Created "if missing". The object card answers 503 until this migration is applied explicitly at
release time (the card reads the team), so apply it before restarting the backend with this code.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261102_0154"
down_revision = "20261030_0153"
branch_labels = None
depends_on = None

TABLE = "it_object_role_assignments"
ROLE_KEYS = "'project_lead', 'pto_manager', 'umto_coordinator', 'chief_project_engineer'"


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
    if _has_table(schema, TABLE):
        return
    now = sa.func.now()
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("object_id", sa.String(length=64), nullable=False),
        sa.Column("role_key", sa.String(length=32), nullable=False),
        sa.Column("employee_code", sa.String(length=128), nullable=False),
        sa.Column("employee_name", sa.String(length=255), nullable=False),
        sa.Column("employee_position", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("employee_department", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("employee_department_location", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("id", name="pk_app_it_object_role_assignments"),
        sa.CheckConstraint(f"role_key IN ({ROLE_KEYS})", name="ck_app_it_object_role_key"),
        schema=schema,
    )
    op.create_index("ix_app_it_object_roles_object", TABLE, ["object_id", "role_key"], schema=schema)
    op.create_index(
        "uq_app_it_object_active_role",
        TABLE,
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
    if not _has_table(schema, TABLE):
        return
    op.drop_index("uq_app_it_object_active_role", table_name=TABLE, schema=schema)
    op.drop_index("ix_app_it_object_roles_object", table_name=TABLE, schema=schema)
    op.drop_table(TABLE, schema=schema)
