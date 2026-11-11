"""Create transfer reminder and env audit tables."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0004"
down_revision = "20260327_0003"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _remote(schema: str | None, table_name: str, column_name: str = "id") -> str:
    if schema:
        return f"{schema}.{table_name}.{column_name}"
    return f"{table_name}.{column_name}"


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    system_schema = _schema("system")

    op.create_table(
        "equipment_transfer_act_reminders",
        sa.Column("reminder_id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=False),
        sa.Column("db_id", sa.Text(), nullable=True),
        sa.Column("assignee_user_id", sa.Integer(), nullable=False),
        sa.Column("controller_user_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("new_employee_no", sa.Text(), nullable=True),
        sa.Column("new_employee_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("reminder_id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_equipment_transfer_act_reminders_task_id",
        "equipment_transfer_act_reminders",
        ["task_id"],
        unique=True,
        schema=app_schema,
    )
    op.create_index(
        "idx_equipment_transfer_act_reminders_assignee_status",
        "equipment_transfer_act_reminders",
        ["assignee_user_id", "status", "updated_at"],
        unique=False,
        schema=app_schema,
    )
    op.create_index(
        "idx_equipment_transfer_act_reminders_db_status",
        "equipment_transfer_act_reminders",
        ["db_id", "status", "updated_at"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "equipment_transfer_act_reminder_groups",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("reminder_id", sa.Text(), nullable=False),
        sa.Column("generated_act_id", sa.Text(), nullable=True),
        sa.Column("old_employee_name", sa.Text(), nullable=False),
        sa.Column("inv_nos_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("equipment_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_doc_no", sa.Integer(), nullable=True),
        sa.Column("matched_doc_number", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["reminder_id"],
            [_remote(app_schema, "equipment_transfer_act_reminders", "reminder_id")],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index(
        "idx_equipment_transfer_act_reminder_groups_reminder",
        "equipment_transfer_act_reminder_groups",
        ["reminder_id"],
        unique=False,
        schema=app_schema,
    )

    op.create_table(
        "env_settings_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("old_value_masked", sa.Text(), nullable=False, server_default=""),
        sa.Column("new_value_masked", sa.Text(), nullable=False, server_default=""),
        sa.Column("actor_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actor_username", sa.Text(), nullable=False, server_default=""),
        sa.Column("changed_at", sa.Text(), nullable=False),
        sa.Column("apply_targets", sa.Text(), nullable=False, server_default=""),
        sa.Column("requires_frontend_build", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        schema=system_schema,
    )
    op.create_index(
        "idx_env_settings_audit_key_changed_at",
        "env_settings_audit",
        ["key", "changed_at"],
        unique=False,
        schema=system_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    system_schema = _schema("system")

    op.drop_index("idx_env_settings_audit_key_changed_at", table_name="env_settings_audit", schema=system_schema)
    op.drop_table("env_settings_audit", schema=system_schema)
    op.drop_index(
        "idx_equipment_transfer_act_reminder_groups_reminder",
        table_name="equipment_transfer_act_reminder_groups",
        schema=app_schema,
    )
    op.drop_table("equipment_transfer_act_reminder_groups", schema=app_schema)
    op.drop_index(
        "idx_equipment_transfer_act_reminders_db_status",
        table_name="equipment_transfer_act_reminders",
        schema=app_schema,
    )
    op.drop_index(
        "idx_equipment_transfer_act_reminders_assignee_status",
        table_name="equipment_transfer_act_reminders",
        schema=app_schema,
    )
    op.drop_index(
        "idx_equipment_transfer_act_reminders_task_id",
        table_name="equipment_transfer_act_reminders",
        schema=app_schema,
    )
    op.drop_table("equipment_transfer_act_reminders", schema=app_schema)
