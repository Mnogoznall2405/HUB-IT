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
    / "20260827_0104_hub_task_canvas.py"
)


def test_hub_task_canvas_migration_up_and_down():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        for operation in (upgrade, downgrade):
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"

        upgrade()

        inspector = sa.inspect(connection)
        assert inspector.has_table("hub_task_canvases")
        assert {column["name"] for column in inspector.get_columns("hub_task_canvases")} == {
            "task_id",
            "scene_json",
            "revision",
            "updated_by_user_id",
            "updated_by_username",
            "created_at",
            "updated_at",
        }
        connection.execute(
            sa.text(
                """
                INSERT INTO hub_task_canvases(
                    task_id, updated_by_user_id, updated_by_username, created_at, updated_at
                ) VALUES (
                    'task-1', 1, 'author', '2026-08-27T10:00:00Z', '2026-08-27T10:00:00Z'
                )
                """
            )
        )
        stored = connection.execute(
            sa.text("SELECT scene_json, revision FROM hub_task_canvases WHERE task_id = 'task-1'")
        ).mappings().one()
        assert stored["scene_json"] == '{"elements":[],"appState":{},"files":{}}'
        assert stored["revision"] == 0

        downgrade()
        assert not sa.inspect(connection).has_table("hub_task_canvases")
