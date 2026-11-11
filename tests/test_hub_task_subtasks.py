"""Подзадачи Hub-задач: создание участником родителя, видимость, счётчики, запрет удаления родителя.

Фикстура task_env (sqlite во временном каталоге, пользователи 1..8) переиспользуется из test_hub_tasks;
границы проверяются через реальный TestClient роутера. Пользователи: 1 автор, 2 исполнитель (только
tasks.read), 3 контролёр, 4 посторонний, 6 «только задачи», 7 наблюдатель.
"""

from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from test_hub_tasks import _approve_task, _create_task, _submit_task, task_env  # noqa: F401  (фикстура)


AUTHOR = 1
ASSIGNEE = 2
CONTROLLER = 3
OUTSIDER = 4
SUB_ASSIGNEE = 6
OBSERVER = 7

REVISION = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20261027_0147_hub_task_parent.py"
)


def _parent(client, set_user, **kwargs) -> dict:
    set_user(AUTHOR)
    return _create_task(client, assignee_user_id=ASSIGNEE, controller_user_id=CONTROLLER, **kwargs)


def _post_subtask(client, parent_id: str, **overrides):
    body = {"title": "Subtask Alpha", "description": "Part of the parent", "assignee_user_ids": [SUB_ASSIGNEE]}
    body.update(overrides)
    return client.post(f"/hub/tasks/{parent_id}/subtasks", json=body)


def _detail(client, task_id: str) -> dict:
    response = client.get(f"/hub/tasks/{task_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_assignee_without_create_permission_adds_subtask_seen_by_parent_participants(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent visibility")

    set_user(ASSIGNEE)
    response = _post_subtask(client, parent["id"])

    assert response.status_code == 200, response.text
    subtask = response.json()
    assert subtask["parent_task_id"] == parent["id"]
    assert subtask["created_by_user_id"] == ASSIGNEE
    assert subtask["project_id"] == parent["project_id"]
    assert subtask["controller_user_id"] == CONTROLLER

    # Автор и контролёр родителя видят подзадачу без участия в ней как исполнители.
    for user_id in (AUTHOR, CONTROLLER):
        set_user(user_id)
        assert _detail(client, subtask["id"])["parent_task_id"] == parent["id"]
    set_user(AUTHOR)
    parent_detail = _detail(client, parent["id"])
    assert [item["id"] for item in parent_detail["subtasks"]] == [subtask["id"]]
    assert (parent_detail["subtasks_total"], parent_detail["subtasks_done"]) == (1, 0)
    assert parent_detail["capabilities"]["can_create_subtask"] is True

    # Посторонний подзадачу не видит.
    set_user(OUTSIDER)
    assert client.get(f"/hub/tasks/{subtask['id']}").status_code == 403


def test_subtask_assignee_sees_parent_only_as_reference(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent reference")
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    set_user(SUB_ASSIGNEE)
    detail = _detail(client, subtask["id"])

    assert detail["parent"] == {"id": parent["id"], "can_view": False}
    assert client.get(f"/hub/tasks/{parent['id']}").status_code == 403


def test_non_participant_and_observer_cannot_add_subtask(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent guard", observer_user_ids=[OBSERVER])

    for user_id in (OUTSIDER, OBSERVER):
        set_user(user_id)
        assert _post_subtask(client, parent["id"]).status_code == 403

    set_user(AUTHOR)
    assert _detail(client, parent["id"])["subtasks_total"] == 0
    set_user(OBSERVER)
    assert _detail(client, parent["id"])["capabilities"]["can_create_subtask"] is False


def test_subtask_cannot_have_own_subtasks_and_closed_parent_rejects_new_ones(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent depth")
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    set_user(SUB_ASSIGNEE)
    assert _post_subtask(client, subtask["id"], assignee_user_ids=[ASSIGNEE]).status_code == 400
    assert _detail(client, subtask["id"])["capabilities"]["can_create_subtask"] is False

    set_user(ASSIGNEE)
    _submit_task(client, parent["id"])
    set_user(CONTROLLER)
    _approve_task(client, parent["id"])
    set_user(ASSIGNEE)
    assert _post_subtask(client, parent["id"], title="Too late").status_code == 400


def test_parent_progress_counts_and_closing_with_open_subtasks_is_allowed(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent progress")
    set_user(ASSIGNEE)
    first = _post_subtask(client, parent["id"], title="Step one").json()
    _post_subtask(client, parent["id"], title="Step two")

    set_user(SUB_ASSIGNEE)
    _submit_task(client, first["id"])
    set_user(CONTROLLER)
    _approve_task(client, first["id"])

    # Родитель уходит на проверку при открытой второй подзадаче: блокировки нет.
    set_user(ASSIGNEE)
    _submit_task(client, parent["id"])
    listed = client.get("/hub/tasks", params={"scope": "my"}).json()["items"]
    parent_row = next(item for item in listed if item["id"] == parent["id"])
    assert (parent_row["subtasks_total"], parent_row["subtasks_done"]) == (2, 1)
    assert parent_row["parent_task_id"] is None


def test_list_filters_by_parent_and_top_level(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent filters")
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    set_user(AUTHOR)
    children = client.get("/hub/tasks", params={"parent_task_id": parent["id"]}).json()
    top_level = client.get("/hub/tasks", params={"top_level_only": "true"}).json()

    assert [item["id"] for item in children["items"]] == [subtask["id"]]
    top_ids = {item["id"] for item in top_level["items"]}
    assert parent["id"] in top_ids and subtask["id"] not in top_ids


def test_parent_with_subtasks_cannot_be_deleted_until_they_are_gone(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent delete")
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    set_user(AUTHOR)
    blocked = client.delete(f"/hub/tasks/{parent['id']}")
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "task_has_subtasks"
    assert _detail(client, parent["id"])["id"] == parent["id"]

    set_user(ASSIGNEE)
    assert client.delete(f"/hub/tasks/{subtask['id']}").status_code == 200
    set_user(AUTHOR)
    assert client.delete(f"/hub/tasks/{parent['id']}").status_code == 200


def test_patch_cannot_move_subtask_to_another_parent(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent patch")
    other = _parent(client, set_user, title="Other parent")
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    response = client.patch(
        f"/hub/tasks/{subtask['id']}",
        json={"title": "Renamed subtask", "parent_task_id": other["id"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["parent_task_id"] == parent["id"]


def test_subtask_change_notifies_parent_viewers_without_touching_parent_updated_at(task_env, monkeypatch):
    from backend.realtime.hub import hub_realtime_publisher

    client, set_user = task_env["client"], task_env["set_user"]
    parent = _parent(client, set_user, title="Parent realtime")
    published: list[dict] = []

    def _record(**kwargs):
        if kwargs["event_type"].startswith("tasks.task."):
            published.append(kwargs["payload"])
        return True

    monkeypatch.setattr(hub_realtime_publisher, "publish_user_event", _record)
    set_user(ASSIGNEE)
    subtask = _post_subtask(client, parent["id"]).json()

    parent_events = [item for item in published if item["task_id"] == parent["id"]]
    assert parent_events and all(item["operation"] == "updated" for item in parent_events)
    assert any(item["task_id"] == subtask["id"] and item["operation"] == "created" for item in published)
    set_user(AUTHOR)
    assert _detail(client, parent["id"])["updated_at"] == parent["updated_at"]


def test_parent_task_id_migration_adds_column_and_index_and_downgrades():
    namespace = runpy.run_path(str(REVISION))
    upgrade, downgrade = namespace["upgrade"], namespace["downgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE hub_tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)"))
        connection.execute(sa.text("INSERT INTO hub_tasks(id, title) VALUES ('task-1', 'Existing')"))
        operations = Operations(MigrationContext.configure(connection))
        for operation in (upgrade, downgrade):
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"

        upgrade()
        upgrade()  # повторный запуск безопасен

        inspector = sa.inspect(connection)
        assert "parent_task_id" in {column["name"] for column in inspector.get_columns("hub_tasks")}
        assert "idx_hub_tasks_parent" in {index["name"] for index in inspector.get_indexes("hub_tasks")}
        assert connection.execute(sa.text("SELECT parent_task_id FROM hub_tasks")).scalar_one() is None

        downgrade()
        inspector = sa.inspect(connection)
        assert "parent_task_id" not in {column["name"] for column in inspector.get_columns("hub_tasks")}
        assert "idx_hub_tasks_parent" not in {index["name"] for index in inspector.get_indexes("hub_tasks")}
