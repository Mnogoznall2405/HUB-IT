"""Удаление вложений Hub-задачи: права, закрытые задачи, физическое удаление файла.

Фикстура task_env и хелперы переиспользуются из test_hub_tasks; границы проверяются через реальный
TestClient роутера. Пользователи: 1 постановщик, 2 исполнитель, 3 контролёр, 4 посторонний.
"""

from __future__ import annotations

from pathlib import Path

from test_hub_tasks import _approve_task, _create_task, _submit_task, task_env  # noqa: F401  (фикстура)


AUTHOR = 1
ASSIGNEE = 2
CONTROLLER = 3
OUTSIDER = 4


def _task(client, set_user, title: str) -> dict:
    set_user(AUTHOR)
    return _create_task(client, assignee_user_id=ASSIGNEE, controller_user_id=CONTROLLER, title=title)


def _upload(client, set_user, task_id: str, user_id: int, name: str = "scan.txt") -> dict:
    set_user(user_id)
    response = client.post(f"/hub/tasks/{task_id}/attachments", files={"file": (name, b"payload", "text/plain")})
    assert response.status_code == 200, response.text
    return response.json()


def _attachment_ids(client, task_id: str) -> list[str]:
    response = client.get(f"/hub/tasks/{task_id}")
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json().get("attachments") or []]


def _delete(client, task_id: str, attachment_id: str):
    return client.delete(f"/hub/tasks/{task_id}/attachments/{attachment_id}")


def test_file_author_and_task_creator_delete_but_other_participants_cannot(task_env):
    client, set_user, service = task_env["client"], task_env["set_user"], task_env["service"]
    task = _task(client, set_user, "Attachment rights")
    own = _upload(client, set_user, task["id"], ASSIGNEE, "mine.txt")
    foreign = _upload(client, set_user, task["id"], CONTROLLER, "controller.txt")
    disk_path = Path(service.get_task_attachment(task_id=task["id"], attachment_id=own["id"])["file_abs_path"])
    assert disk_path.is_file()

    # Исполнитель не может удалить файл контролёра, посторонний не видит задачу вовсе.
    set_user(ASSIGNEE)
    assert _delete(client, task["id"], foreign["id"]).status_code == 403
    set_user(OUTSIDER)
    assert _delete(client, task["id"], own["id"]).status_code == 403
    set_user(AUTHOR)
    assert set(_attachment_ids(client, task["id"])) == {own["id"], foreign["id"]}

    # Автор файла удаляет свой, файл исчезает и с диска.
    set_user(ASSIGNEE)
    response = _delete(client, task["id"], own["id"])
    assert response.status_code == 200, response.text
    assert response.json() == {"deleted": True, "id": own["id"]}
    assert not disk_path.exists()

    # Постановщик удаляет чужой файл; повторное удаление — 404.
    set_user(AUTHOR)
    assert _delete(client, task["id"], foreign["id"]).status_code == 200
    assert _attachment_ids(client, task["id"]) == []
    assert _delete(client, task["id"], foreign["id"]).status_code == 404


def test_completed_task_and_report_files_stay_untouched(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    task = _task(client, set_user, "Attachment closed")
    kept = _upload(client, set_user, task["id"], ASSIGNEE, "kept.txt")

    # Файл отчёта лежит в задаче, но удалять его нельзя: он подтверждает сдачу.
    set_user(ASSIGNEE)
    _submit_task(client, task["id"])
    set_user(AUTHOR)
    report = next(item for item in _attachment_list(client, task["id"]) if item["id"] != kept["id"])
    assert _delete(client, task["id"], report["id"]).status_code == 409

    set_user(CONTROLLER)
    _approve_task(client, task["id"])
    set_user(AUTHOR)
    assert _delete(client, task["id"], kept["id"]).status_code == 409
    assert kept["id"] in _attachment_ids(client, task["id"])


def test_deleting_unknown_attachment_or_task_returns_not_found(task_env):
    client, set_user = task_env["client"], task_env["set_user"]
    task = _task(client, set_user, "Attachment missing")
    assert _delete(client, task["id"], "missing").status_code == 404
    assert _delete(client, "missing-task", "missing").status_code == 404


def _attachment_list(client, task_id: str) -> list[dict]:
    return client.get(f"/hub/tasks/{task_id}").json().get("attachments") or []
