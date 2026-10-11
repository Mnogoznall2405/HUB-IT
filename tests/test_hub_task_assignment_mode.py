"""Режимы назначения исполнителей при POST /hub/tasks: общая задача или отдельная каждому.

Фикстура task_env (sqlite во временном каталоге, пользователи 1..8) переиспользуется
из test_hub_tasks; HTTP-граница проверяется через реальный TestClient роутера.
"""

from __future__ import annotations

from uuid import uuid4

from test_hub_tasks import task_env  # noqa: F401  (фикстура)


CONTROLLER_ID = 3
ASSIGNEE_A = 2
ASSIGNEE_B = 4
MISSING_USER_ID = 999


def _create_project(client) -> str:
    code = f"mode-{uuid4().hex[:10]}"
    response = client.post("/hub/task-projects", json={"name": f"Project {code}", "code": code})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _post_task(client, *, project_id: str, assignee_ids: list[int], assignment_mode=None, title="Mode task"):
    body = {
        "title": title,
        "description": "Task body",
        "assignee_user_ids": assignee_ids,
        "controller_user_id": CONTROLLER_ID,
        "project_id": project_id,
        "protocol_date": "2026-03-01",
        "priority": "high",
    }
    if assignment_mode is not None:
        body["assignment_mode"] = assignment_mode
    return client.post("/hub/tasks", json=body)


def _controller_task_total(client, set_user) -> int:
    set_user(CONTROLLER_ID)
    response = client.get("/hub/tasks", params={"scope": "my", "role_scope": "controller"})
    assert response.status_code == 200, response.text
    return int(response.json()["total"])


def test_separate_mode_creates_one_task_per_assignee(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B],
        assignment_mode="separate",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] == 2
    assert len(payload["items"]) == 2
    assert len({item["id"] for item in payload["items"]}) == 2
    assignees_per_task = sorted(sorted(item["assignee_user_ids"]) for item in payload["items"])
    assert assignees_per_task == [[ASSIGNEE_A], [ASSIGNEE_B]]
    assert _controller_task_total(client, set_user) == 2


def test_shared_mode_creates_single_task_with_all_assignees(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B],
        assignment_mode="shared",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] == 1
    assert sorted(payload["items"][0]["assignee_user_ids"]) == [ASSIGNEE_A, ASSIGNEE_B]
    assert _controller_task_total(client, set_user) == 1


def test_missing_or_unknown_mode_behaves_as_shared(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    omitted = _post_task(client, project_id=project_id, assignee_ids=[ASSIGNEE_A, ASSIGNEE_B], title="Omitted mode")
    unknown = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B],
        assignment_mode="something-else",
        title="Unknown mode",
    )

    for response in (omitted, unknown):
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["created"] == 1
        assert sorted(payload["items"][0]["assignee_user_ids"]) == [ASSIGNEE_A, ASSIGNEE_B]
    assert _controller_task_total(client, set_user) == 2


def test_separate_mode_with_unknown_assignee_creates_nothing(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, MISSING_USER_ID],
        assignment_mode="separate",
    )

    assert 400 <= response.status_code < 500, response.text
    assert _controller_task_total(client, set_user) == 0


def test_separate_mode_with_single_assignee_creates_one_task(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A],
        assignment_mode="separate",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] == 1
    assert payload["items"][0]["assignee_user_ids"] == [ASSIGNEE_A]
    assert _controller_task_total(client, set_user) == 1


ASSIGNEE_C = 6


def _failing_create_task(service, monkeypatch, *, fail_assignee_ids: set[int], exc_factory):
    original = service.create_task

    def _wrapper(*args, **kwargs):
        if int(kwargs["assignee_user_id"]) in fail_assignee_ids:
            raise exc_factory()
        return original(*args, **kwargs)

    monkeypatch.setattr(service, "create_task", _wrapper)


def test_separate_mode_partial_failure_keeps_created_tasks(task_env, monkeypatch):
    client = task_env["client"]
    set_user = task_env["set_user"]
    service = task_env["service"]
    set_user(1)
    project_id = _create_project(client)
    _failing_create_task(
        service,
        monkeypatch,
        fail_assignee_ids={ASSIGNEE_B},
        exc_factory=lambda: RuntimeError("db connection reset: secret-dsn-value"),
    )

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B, ASSIGNEE_C],
        assignment_mode="separate",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["partial"] is True
    assert payload["created"] == 2
    assert len(payload["items"]) == 2
    assert sorted(sorted(item["assignee_user_ids"]) for item in payload["items"]) == [[ASSIGNEE_A], [ASSIGNEE_C]]
    assert payload["failed"] == [
        {"assignee_user_id": ASSIGNEE_B, "detail": "Внутренняя ошибка при создании задачи"}
    ]
    assert "secret-dsn-value" not in response.text
    assert _controller_task_total(client, set_user) == 2


def test_separate_mode_all_failures_return_error_and_create_nothing(task_env, monkeypatch):
    client = task_env["client"]
    set_user = task_env["set_user"]
    service = task_env["service"]
    set_user(1)
    project_id = _create_project(client)
    _failing_create_task(
        service,
        monkeypatch,
        fail_assignee_ids={ASSIGNEE_A, ASSIGNEE_B},
        exc_factory=lambda: ValueError("Исполнитель недоступен"),
    )

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B],
        assignment_mode="separate",
    )

    assert response.status_code == 400, response.text
    assert "partial" not in response.text
    assert _controller_task_total(client, set_user) == 0


def test_separate_mode_success_has_no_failed_or_partial_keys(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    set_user(1)
    project_id = _create_project(client)

    response = _post_task(
        client,
        project_id=project_id,
        assignee_ids=[ASSIGNEE_A, ASSIGNEE_B],
        assignment_mode="separate",
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] == 2
    assert "failed" not in payload
    assert "partial" not in payload
