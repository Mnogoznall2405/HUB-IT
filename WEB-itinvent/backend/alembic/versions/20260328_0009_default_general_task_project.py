"""Backfill default project for legacy hub tasks without project links."""
from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260328_0009"
down_revision = "20260328_0008"
branch_labels = None
depends_on = None

DEFAULT_PROJECT_ID = "general-tasks"
DEFAULT_PROJECT_NAME = "Общие задачи"
DEFAULT_PROJECT_CODE = "GENERAL"
DEFAULT_PROJECT_DESCRIPTION = "Базовый проект для задач, созданных до введения проектного учёта."


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _qualified(schema: str | None, table_name: str) -> str:
    if schema:
        return f'"{schema}"."{table_name}"'
    return table_name


def upgrade() -> None:
    if _scope() == "chat":
        return

    bind = op.get_bind()
    app_schema = _schema("app")
    projects_table = _qualified(app_schema, "hub_task_projects")
    tasks_table = _qualified(app_schema, "hub_tasks")
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = bind.execute(
        sa.text(
            f"""
            SELECT id
            FROM {projects_table}
            WHERE LOWER(name) = LOWER(:name)
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """
        ),
        {"name": DEFAULT_PROJECT_NAME},
    ).scalar()

    project_id = str(existing or "").strip()
    if not project_id:
        existing = bind.execute(
            sa.text(f"SELECT id FROM {projects_table} WHERE id = :project_id LIMIT 1"),
            {"project_id": DEFAULT_PROJECT_ID},
        ).scalar()
        project_id = str(existing or "").strip()

    if project_id:
        bind.execute(
            sa.text(
                f"""
                UPDATE {projects_table}
                SET name = :name,
                    code = :code,
                    description = :description,
                    is_active = 1,
                    updated_at = :updated_at
                WHERE id = :project_id
                """
            ),
            {
                "project_id": project_id,
                "name": DEFAULT_PROJECT_NAME,
                "code": DEFAULT_PROJECT_CODE,
                "description": DEFAULT_PROJECT_DESCRIPTION,
                "updated_at": now_iso,
            },
        )
    else:
        project_id = DEFAULT_PROJECT_ID
        bind.execute(
            sa.text(
                f"""
                INSERT INTO {projects_table}(id, name, code, description, is_active, created_at, updated_at)
                VALUES (:project_id, :name, :code, :description, 1, :created_at, :updated_at)
                """
            ),
            {
                "project_id": project_id,
                "name": DEFAULT_PROJECT_NAME,
                "code": DEFAULT_PROJECT_CODE,
                "description": DEFAULT_PROJECT_DESCRIPTION,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        )

    bind.execute(
        sa.text(
            f"""
            UPDATE {tasks_table}
            SET project_id = :project_id
            WHERE project_id IS NULL OR TRIM(project_id) = ''
            """
        ),
        {"project_id": project_id},
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    bind = op.get_bind()
    app_schema = _schema("app")
    projects_table = _qualified(app_schema, "hub_task_projects")
    tasks_table = _qualified(app_schema, "hub_tasks")

    bind.execute(
        sa.text(
            f"""
            UPDATE {tasks_table}
            SET project_id = NULL
            WHERE project_id = :project_id
            """
        ),
        {"project_id": DEFAULT_PROJECT_ID},
    )
    bind.execute(
        sa.text(f"DELETE FROM {projects_table} WHERE id = :project_id"),
        {"project_id": DEFAULT_PROJECT_ID},
    )
