from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


ROOT = Path(__file__).resolve().parents[1]
REVISION = (
    ROOT
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20260901_0105_hub_task_multi_assignees.py"
)


def test_hub_task_multi_assignees_migration_backfills_and_downgrades():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
                CREATE TABLE hub_tasks (
                    id TEXT PRIMARY KEY,
                    assignee_user_id INTEGER NOT NULL
                )
                """
            )
        )
        connection.execute(
            sa.text("INSERT INTO hub_tasks(id, assignee_user_id) VALUES ('task-1', 7)")
        )
        operations = Operations(MigrationContext.configure(connection))
        for operation in (upgrade, downgrade):
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"

        upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("hub_tasks")}
        assert "assignee_user_ids" in columns
        stored = connection.execute(
            sa.text("SELECT assignee_user_ids FROM hub_tasks WHERE id = 'task-1'")
        ).scalar_one()
        assert stored == "[7]"

        downgrade()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("hub_tasks")}
        assert "assignee_user_ids" not in columns
