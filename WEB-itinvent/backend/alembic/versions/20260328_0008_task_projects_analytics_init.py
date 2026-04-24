"""Add task projects, task objects, protocol fields, and task delegates."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260328_0008"
down_revision = "20260328_0007"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")

    op.create_table(
        "task_delegate_user_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("delegate_user_id", sa.Integer(), nullable=False),
        sa.Column("role_type", sa.String(length=32), nullable=False, server_default="assistant"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "delegate_user_id", name="uq_app_task_delegate_owner_delegate"),
        schema=app_schema,
    )
    op.create_index("ix_task_delegate_user_links_owner_user_id", "task_delegate_user_links", ["owner_user_id"], schema=app_schema)
    op.create_index("ix_task_delegate_user_links_delegate_user_id", "task_delegate_user_links", ["delegate_user_id"], schema=app_schema)
    op.create_index("ix_task_delegate_user_links_is_active", "task_delegate_user_links", ["is_active"], schema=app_schema)

    op.create_table(
        "hub_task_projects",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index("idx_hub_task_projects_active", "hub_task_projects", ["is_active", "name"], unique=False, schema=app_schema)

    op.create_table(
        "hub_task_objects",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("project_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_active", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index("idx_hub_task_objects_project", "hub_task_objects", ["project_id", "is_active", "name"], unique=False, schema=app_schema)

    with op.batch_alter_table("hub_tasks", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("object_id", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("protocol_date", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("completed_at", sa.Text(), nullable=True))

    op.create_index("idx_hub_tasks_project", "hub_tasks", ["project_id", "updated_at"], unique=False, schema=app_schema)
    op.create_index("idx_hub_tasks_object", "hub_tasks", ["object_id", "updated_at"], unique=False, schema=app_schema)
    op.create_index("idx_hub_tasks_protocol_date", "hub_tasks", ["protocol_date"], unique=False, schema=app_schema)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text('UPDATE "app"."hub_tasks" SET protocol_date = substr(created_at, 1, 10) WHERE protocol_date IS NULL OR protocol_date = \'\''))
    else:
        op.execute(sa.text("UPDATE hub_tasks SET protocol_date = substr(created_at, 1, 10) WHERE protocol_date IS NULL OR protocol_date = ''"))


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    op.drop_index("idx_hub_tasks_protocol_date", table_name="hub_tasks", schema=app_schema)
    op.drop_index("idx_hub_tasks_object", table_name="hub_tasks", schema=app_schema)
    op.drop_index("idx_hub_tasks_project", table_name="hub_tasks", schema=app_schema)
    with op.batch_alter_table("hub_tasks", schema=app_schema) as batch_op:
        batch_op.drop_column("completed_at")
        batch_op.drop_column("protocol_date")
        batch_op.drop_column("object_id")
        batch_op.drop_column("project_id")

    op.drop_index("idx_hub_task_objects_project", table_name="hub_task_objects", schema=app_schema)
    op.drop_table("hub_task_objects", schema=app_schema)
    op.drop_index("idx_hub_task_projects_active", table_name="hub_task_projects", schema=app_schema)
    op.drop_table("hub_task_projects", schema=app_schema)

    op.drop_index("ix_task_delegate_user_links_is_active", table_name="task_delegate_user_links", schema=app_schema)
    op.drop_index("ix_task_delegate_user_links_delegate_user_id", table_name="task_delegate_user_links", schema=app_schema)
    op.drop_index("ix_task_delegate_user_links_owner_user_id", table_name="task_delegate_user_links", schema=app_schema)
    op.drop_table("task_delegate_user_links", schema=app_schema)
