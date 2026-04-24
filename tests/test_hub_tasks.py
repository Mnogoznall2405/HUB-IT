from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib
from openpyxl import load_workbook

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")


TASKS_READ = "tasks.read"
TASKS_WRITE = "tasks.write"
TASKS_REVIEW = "tasks.review"
DASHBOARD_READ = "dashboard.read"


def _raw_user(
    user_id: int,
    username: str,
    full_name: str,
    role: str,
    permissions: list[str],
) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def task_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator", [DASHBOARD_READ, TASKS_READ, TASKS_WRITE]),
        2: _raw_user(2, "assignee", "Task Assignee", "viewer", [DASHBOARD_READ, TASKS_READ]),
        3: _raw_user(3, "controller", "Task Controller", "viewer", [DASHBOARD_READ, TASKS_READ, TASKS_REVIEW]),
        4: _raw_user(4, "outsider", "Task Outsider", "viewer", [DASHBOARD_READ, TASKS_READ]),
        5: _raw_user(5, "admin", "Task Admin", "admin", [DASHBOARD_READ, TASKS_READ, TASKS_WRITE, TASKS_REVIEW]),
        6: _raw_user(6, "taskonly", "Task Only User", "viewer", [TASKS_READ]),
        7: _raw_user(7, "assistant", "Task Assistant", "viewer", [TASKS_READ]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_tasks.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")

    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    return {
        "client": client,
        "set_user": set_user,
        "raw_users": raw_users,
        "service": service,
    }


def _create_task(client: TestClient, *, assignee_user_id: int = 2, controller_user_id: int = 3, title: str = "Task Alpha") -> dict:
    project_code = f"{title.lower().replace(' ', '-')}-{uuid4().hex[:8]}"
    project_response = client.post(
        "/hub/task-projects",
        json={"name": f"Project for {title} {project_code[-4:]}", "code": project_code},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()
    response = client.post(
        "/hub/tasks",
        json={
            "title": title,
            "description": "Task body",
            "assignee_user_ids": [assignee_user_id],
            "controller_user_id": controller_user_id,
            "project_id": project["id"],
            "protocol_date": "2026-03-01",
            "priority": "high",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] == 1
    return payload["items"][0]


def _submit_task(client: TestClient, task_id: str, *, comment: str = "Report done") -> dict:
    response = client.post(
        f"/hub/tasks/{task_id}/submit",
        data={"comment": comment},
        files={"file": ("report.txt", b"report-bytes", "text/plain")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_task_detail_access_and_role_scopes(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    created = _create_task(client, title="Task Access")
    task_id = created["id"]

    set_user(3)
    controller_view = client.get("/hub/tasks", params={"scope": "my", "role_scope": "controller"})
    assert controller_view.status_code == 200
    assert controller_view.json()["total"] == 1

    both_view = client.get("/hub/tasks", params={"scope": "my", "role_scope": "both"})
    assert both_view.status_code == 200
    assert both_view.json()["total"] == 1

    detail_response = client.get(f"/hub/tasks/{task_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["controller_user_id"] == 3
    assert detail_payload["created_by_user_id"] == 1
    assert "attachments_count" in detail_payload

    set_user(4)
    denied = client.get(f"/hub/tasks/{task_id}")
    assert denied.status_code == 403


def test_existing_tasks_without_project_are_backfilled_to_general_project(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    service = task_env["service"]

    set_user(1)
    created = _create_task(client, title="Legacy Project Backfill")
    task_id = created["id"]

    with service._connect() as conn:
        conn.execute(f"UPDATE {service._TASKS_TABLE} SET project_id = NULL WHERE id = ?", (task_id,))
        conn.commit()

    service._ensure_schema()

    task = service.get_task(task_id, user_id=1)
    assert task is not None
    assert task["project_id"] == service._DEFAULT_TASK_PROJECT_ID
    assert task["project_name"] == service._DEFAULT_TASK_PROJECT_NAME

    projects = service.list_task_projects(include_inactive=True)
    assert any(item["id"] == service._DEFAULT_TASK_PROJECT_ID for item in projects)


def test_opening_task_marks_task_notifications_read(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    created = _create_task(client, assignee_user_id=2, title="Read On Open")
    task_id = created["id"]

    set_user(2)
    unread_before = client.get("/hub/notifications/unread-counts")
    assert unread_before.status_code == 200
    assert unread_before.json()["notifications_unread_total"] == 1

    detail_response = client.get(f"/hub/tasks/{task_id}")
    assert detail_response.status_code == 200

    unread_after = client.get("/hub/notifications/unread-counts")
    assert unread_after.status_code == 200
    assert unread_after.json()["notifications_unread_total"] == 0


def test_task_only_user_can_access_notification_endpoints(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    _create_task(client, assignee_user_id=6, title="Task Only Notification")

    set_user(6)
    unread_counts = client.get("/hub/notifications/unread-counts")
    assert unread_counts.status_code == 200
    assert unread_counts.json()["notifications_unread_total"] == 1

    notification_poll = client.get("/hub/notifications/poll", params={"limit": 20})
    assert notification_poll.status_code == 200
    items = notification_poll.json()["items"]
    assert any(item["entity_type"] == "task" for item in items)


def test_author_can_review_and_outsider_cannot_access_task_artifacts(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    raw_users = task_env["raw_users"]

    set_user(1)
    created = _create_task(client, title="Author Review")
    task_id = created["id"]
    deletable = _create_task(client, title="Author Delete")

    attachment_response = client.post(
        f"/hub/tasks/{task_id}/attachments",
        files={"file": ("spec.txt", b"spec-bytes", "text/plain")},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    attachment_id = attachment_response.json()["id"]

    set_user(2)
    submitted = _submit_task(client, task_id, comment="Need approval")
    report_id = submitted["latest_report"]["id"]
    assert submitted["status"] == "review"

    set_user(1)
    reviewed = client.post(
        f"/hub/tasks/{task_id}/review",
        json={"decision": "approve", "comment": "Accepted by author"},
    )
    assert reviewed.status_code == 200, reviewed.text
    reviewed_payload = reviewed.json()
    assert reviewed_payload["status"] == "done"
    assert reviewed_payload["reviewer_user_id"] == 1
    assert reviewed_payload["reviewer_full_name"] == "Task Author"

    raw_users[1]["permissions"] = [DASHBOARD_READ, TASKS_READ]
    raw_users[1]["custom_permissions"] = [DASHBOARD_READ, TASKS_READ]
    set_user(1)
    assignee_users = client.get("/hub/users/assignees")
    assert assignee_users.status_code == 200, assignee_users.text
    controller_users = client.get("/hub/users/controllers")
    assert controller_users.status_code == 200, controller_users.text
    author_update = client.patch(f"/hub/tasks/{task_id}", json={"title": "Author Review Updated"})
    assert author_update.status_code == 200, author_update.text
    assert author_update.json()["title"] == "Author Review Updated"
    author_delete = client.delete(f"/hub/tasks/{deletable['id']}")
    assert author_delete.status_code == 200, author_delete.text

    comments_response = client.post(f"/hub/tasks/{task_id}/comments", json={"body": "Looks good"})
    assert comments_response.status_code == 200

    history_response = client.get(f"/hub/tasks/{task_id}/status-log")
    assert history_response.status_code == 200
    transitions = [item["new_status"] for item in history_response.json()["items"]]
    assert "review" in transitions
    assert "done" in transitions

    set_user(4)
    assert client.patch(f"/hub/tasks/{task_id}", json={"title": "Intrusion"}).status_code == 403
    assert client.post(f"/hub/tasks/{task_id}/comments", json={"body": "I should not see this"}).status_code == 403
    assert client.get(f"/hub/tasks/{task_id}/comments").status_code == 403
    assert client.get(f"/hub/tasks/{task_id}/status-log").status_code == 403
    assert client.get(f"/hub/tasks/reports/{report_id}/file").status_code == 403
    assert client.get(f"/hub/tasks/{task_id}/attachments/{attachment_id}/file").status_code == 403


def test_controller_review_and_counts_include_author_and_controller_roles(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    review_task = _create_task(client, title="Review Required")
    open_task = _create_task(client, title="Still Open")

    set_user(2)
    submitted = _submit_task(client, review_task["id"], comment="Ready for controller")
    assert submitted["status"] == "review"

    set_user(3)
    reviewed = client.post(
        f"/hub/tasks/{review_task['id']}/review",
        json={"decision": "reject", "comment": "Controller rejected"},
    )
    assert reviewed.status_code == 200, reviewed.text
    reviewed_payload = reviewed.json()
    assert reviewed_payload["status"] == "in_progress"
    assert reviewed_payload["reviewer_user_id"] == 3
    assert reviewed_payload["reviewer_full_name"] == "Task Controller"

    set_user(1)
    counts = client.get("/hub/notifications/unread-counts")
    assert counts.status_code == 200
    counts_payload = counts.json()
    assert counts_payload["tasks_created_open"] == 2
    assert counts_payload["tasks_open_total"] == 2
    assert counts_payload["tasks_open"] == 2
    assert counts_payload["tasks_review_required"] == 0

    dashboard = client.get("/hub/dashboard", params={"tasks_limit": 10, "announcements_limit": 5})
    assert dashboard.status_code == 200
    assert dashboard.json()["my_tasks"]["total"] == 2

    set_user(3)
    controller_counts = client.get("/hub/notifications/unread-counts")
    assert controller_counts.status_code == 200
    controller_payload = controller_counts.json()
    assert controller_payload["tasks_controller_open"] == 2
    assert controller_payload["tasks_open_total"] == 2

    set_user(4)
    denied_review = client.post(
        f"/hub/tasks/{open_task['id']}/review",
        json={"decision": "approve", "comment": "Outsider"},
    )
    assert denied_review.status_code == 403


def test_assignee_cannot_submit_task_twice_while_waiting_for_review(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    created = _create_task(client, title="Single Submit")

    set_user(2)
    first_submit = _submit_task(client, created["id"], comment="Initial report")
    assert first_submit["status"] == "review"

    second_submit = client.post(
        f"/hub/tasks/{created['id']}/submit",
        data={"comment": "Second report"},
        files={"file": ("report-2.txt", b"second-report", "text/plain")},
    )
    assert second_submit.status_code == 400
    assert second_submit.json()["detail"] == "Task is already waiting for review"


def test_task_comment_summary_unread_seen_and_notifications(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    created = _create_task(client, title="Comment Visibility")
    task_id = created["id"]

    set_user(2)
    comment_response = client.post(
        f"/hub/tasks/{task_id}/comments",
        json={"body": "Need update\nline 2"},
    )
    assert comment_response.status_code == 200, comment_response.text

    assignee_tasks = client.get("/hub/tasks", params={"scope": "my", "role_scope": "assignee"})
    assert assignee_tasks.status_code == 200
    assignee_item = assignee_tasks.json()["items"][0]
    assert assignee_item["comments_count"] == 1
    assert assignee_item["latest_comment_preview"] == "Need update line 2"
    assert assignee_item["latest_comment_user_id"] == 2
    assert assignee_item["latest_comment_full_name"] == "Task Assignee"
    assert assignee_item["has_unread_comments"] is False

    assignee_poll = client.get("/hub/notifications/poll", params={"limit": 20})
    assert assignee_poll.status_code == 200
    assert not any(
        item["event_type"] == "task.comment_added" and item["entity_id"] == task_id
        for item in assignee_poll.json()["items"]
    )

    set_user(1)
    author_detail = client.get(f"/hub/tasks/{task_id}")
    assert author_detail.status_code == 200
    author_payload = author_detail.json()
    assert author_payload["comments_count"] == 1
    assert author_payload["latest_comment_preview"] == "Need update line 2"
    assert author_payload["latest_comment_user_id"] == 2
    assert author_payload["latest_comment_full_name"] == "Task Assignee"
    assert author_payload["has_unread_comments"] is True

    author_poll = client.get("/hub/notifications/poll", params={"limit": 20})
    assert author_poll.status_code == 200
    assert not any(
        item["event_type"] == "task.comment_added" and item["entity_id"] == task_id and item["unread"] == 1
        for item in author_poll.json()["items"]
    )
    author_counts_before = client.get("/hub/notifications/unread-counts")
    assert author_counts_before.status_code == 200
    assert author_counts_before.json()["notifications_unread_total"] == 0

    mark_seen = client.post(f"/hub/tasks/{task_id}/comments/mark-seen")
    assert mark_seen.status_code == 200, mark_seen.text
    assert mark_seen.json()["has_unread_comments"] is False

    author_detail_after = client.get(f"/hub/tasks/{task_id}")
    assert author_detail_after.status_code == 200
    assert author_detail_after.json()["has_unread_comments"] is False

    author_counts_after = client.get("/hub/notifications/unread-counts")
    assert author_counts_after.status_code == 200
    assert author_counts_after.json()["notifications_unread_total"] == 0

    set_user(3)
    controller_tasks = client.get("/hub/tasks", params={"scope": "my", "role_scope": "controller"})
    assert controller_tasks.status_code == 200
    controller_item = controller_tasks.json()["items"][0]
    assert controller_item["comments_count"] == 1
    assert controller_item["has_unread_comments"] is True

    set_user(4)
    assert client.post(f"/hub/tasks/{task_id}/comments/mark-seen").status_code == 403


def test_notifications_poll_unread_only_excludes_read_items(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    created = _create_task(client, title="Unread Only")
    task_id = created["id"]

    set_user(2)
    comment_response = client.post(
        f"/hub/tasks/{task_id}/comments",
        json={"body": "Fresh comment"},
    )
    assert comment_response.status_code == 200, comment_response.text

    set_user(1)
    unread_poll = client.get("/hub/notifications/poll", params={"limit": 20, "unread_only": True})
    assert unread_poll.status_code == 200, unread_poll.text
    unread_items = unread_poll.json()["items"]
    target_item = next(
        item for item in unread_items
        if item["event_type"] == "task.comment_added" and item["entity_id"] == task_id
    )
    assert target_item["unread"] == 1

    mark_read = client.post(f"/hub/notifications/{target_item['id']}/read")
    assert mark_read.status_code == 200, mark_read.text

    unread_poll_after = client.get("/hub/notifications/poll", params={"limit": 20, "unread_only": True})
    assert unread_poll_after.status_code == 200, unread_poll_after.text
    assert not any(item["id"] == target_item["id"] for item in unread_poll_after.json()["items"])


def test_notifications_read_all_marks_everything_read(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    first_task = _create_task(client, title="Read all 1")
    second_task = _create_task(client, title="Read all 2")

    set_user(2)
    for task_id in (first_task["id"], second_task["id"]):
        comment_response = client.post(
            f"/hub/tasks/{task_id}/comments",
            json={"body": f"Update for {task_id}"},
        )
        assert comment_response.status_code == 200, comment_response.text

    set_user(1)
    unread_before = client.get("/hub/notifications/unread-counts")
    assert unread_before.status_code == 200
    assert unread_before.json()["notifications_unread_total"] >= 2

    read_all = client.post("/hub/notifications/read-all")
    assert read_all.status_code == 200, read_all.text
    assert read_all.json()["marked_count"] >= 2

    unread_after = client.get("/hub/notifications/unread-counts")
    assert unread_after.status_code == 200
    assert unread_after.json()["notifications_unread_total"] == 0

    unread_poll_after = client.get("/hub/notifications/poll", params={"limit": 20, "unread_only": True})
    assert unread_poll_after.status_code == 200, unread_poll_after.text
    assert unread_poll_after.json()["items"] == []


def test_task_projects_protocol_date_and_analytics(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    project_response = client.post(
        "/hub/task-projects",
        json={"name": "Проект Север", "code": "north"},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()

    object_response = client.post(
        "/hub/task-objects",
        json={"project_id": project["id"], "name": "Объект 17", "code": "obj-17"},
    )
    assert object_response.status_code == 200, object_response.text
    task_object = object_response.json()

    missing_project = client.post(
        "/hub/tasks",
        json={
            "title": "No Project",
            "description": "Should fail",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "protocol_date": "2026-03-01",
        },
    )
    assert missing_project.status_code == 400
    assert missing_project.json()["detail"] == "project_id is required"

    created = client.post(
        "/hub/tasks",
        json={
            "title": "Task With Project",
            "description": "Task body",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
                "project_id": project["id"],
                "object_id": task_object["id"],
                "protocol_date": "2026-03-01",
                "due_at": "2030-04-10T12:00:00+00:00",
                "priority": "high",
            },
        )
    assert created.status_code == 200, created.text
    task = created.json()["items"][0]
    assert task["project_id"] == project["id"]
    assert task["project_name"] == "Проект Север"
    assert task["object_id"] == task_object["id"]
    assert task["object_name"] == "Объект 17"
    assert task["protocol_date"] == "2026-03-01"

    set_user(2)
    submit = client.post(
        f"/hub/tasks/{task['id']}/submit",
        data={"comment": "Ready"},
        files={"file": ("report.txt", b"ok", "text/plain")},
    )
    assert submit.status_code == 200, submit.text

    set_user(3)
    review = client.post(
        f"/hub/tasks/{task['id']}/review",
        json={"decision": "approve", "comment": "Approved"},
    )
    assert review.status_code == 200, review.text
    reviewed = review.json()
    assert reviewed["status"] == "done"
    assert reviewed["completed_at"]
    assert reviewed["completed_on_time"] is True

    set_user(1)
    analytics = client.get(
        "/hub/tasks/analytics",
        params={
            "start_date": "2026-03-01",
            "end_date": "2026-03-31",
            "date_basis": "protocol_date",
            "project_id": project["id"],
        },
    )
    assert analytics.status_code == 200, analytics.text
    payload = analytics.json()
    assert payload["summary"]["total"] == 1
    assert payload["summary"]["done"] == 1
    assert payload["summary"]["done_on_time"] == 1
    assert payload["summary"]["completion_percent"] == 100.0
    assert payload["summary"]["completion_on_time_percent"] == 100.0
    assert payload["by_project"][0]["project_id"] == project["id"]
    assert payload["by_project"][0]["project_name"] == "Проект Север"
    assert payload["by_object"][0]["object_id"] == task_object["id"]
    assert payload["by_object"][0]["object_name"] == "Объект 17"
    assert payload["by_participant"][0]["participant_user_id"] == 2


def test_task_analytics_backfills_completed_at_and_returns_extended_metrics(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]
    service = task_env["service"]

    now_utc = datetime.now(timezone.utc)
    protocol_day = now_utc.date().isoformat()
    on_time_due = (now_utc + timedelta(days=10)).isoformat()
    overdue_due = (now_utc - timedelta(days=2)).isoformat()
    legacy_completed_at = (now_utc - timedelta(days=1)).isoformat()

    set_user(1)
    project_response = client.post(
        "/hub/task-projects",
        json={"name": "Проект Аналитика", "code": "analytics"},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()

    object_response = client.post(
        "/hub/task-objects",
        json={"project_id": project["id"], "name": "Объект А1", "code": "a1"},
    )
    assert object_response.status_code == 200, object_response.text
    task_object = object_response.json()

    on_time_created = client.post(
        "/hub/tasks",
        json={
            "title": "On Time Task",
            "description": "Done on time",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "project_id": project["id"],
            "object_id": task_object["id"],
            "protocol_date": protocol_day,
            "due_at": on_time_due,
        },
    )
    assert on_time_created.status_code == 200, on_time_created.text
    on_time_task = on_time_created.json()["items"][0]

    set_user(2)
    submit = client.post(
        f"/hub/tasks/{on_time_task['id']}/submit",
        data={"comment": "Ready"},
        files={"file": ("report.txt", b"ok", "text/plain")},
    )
    assert submit.status_code == 200, submit.text

    set_user(3)
    review = client.post(
        f"/hub/tasks/{on_time_task['id']}/review",
        json={"decision": "approve", "comment": "Approved"},
    )
    assert review.status_code == 200, review.text

    set_user(1)
    legacy_created = client.post(
        "/hub/tasks",
        json={
            "title": "Legacy Done Without Due",
            "description": "Legacy done task",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "project_id": project["id"],
            "object_id": task_object["id"],
            "protocol_date": protocol_day,
        },
    )
    assert legacy_created.status_code == 200, legacy_created.text
    legacy_task = legacy_created.json()["items"][0]

    overdue_created = client.post(
        "/hub/tasks",
        json={
            "title": "Overdue Task",
            "description": "Still open",
            "assignee_user_ids": [6],
            "controller_user_id": 3,
            "project_id": project["id"],
            "protocol_date": protocol_day,
            "due_at": overdue_due,
        },
    )
    assert overdue_created.status_code == 200, overdue_created.text
    overdue_task = overdue_created.json()["items"][0]

    with service._connect() as conn:
        conn.execute(
            f"""
            UPDATE {service._TASKS_TABLE}
            SET status = 'done',
                reviewed_at = ?,
                completed_at = NULL,
                completed_at_source = NULL,
                due_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (legacy_completed_at, legacy_completed_at, legacy_task["id"]),
        )
        conn.commit()

    service._ensure_schema()

    legacy_detail = service.get_task(legacy_task["id"], user_id=1)
    assert legacy_detail is not None
    assert legacy_detail["completed_at"] == legacy_completed_at
    assert legacy_detail["completed_at_source"] == "reviewed_at"
    assert legacy_detail["done_without_due"] is True

    analytics = client.get(
        "/hub/tasks/analytics",
        params={
            "start_date": protocol_day,
            "end_date": protocol_day,
            "date_basis": "protocol_date",
            "project_id": project["id"],
        },
    )
    assert analytics.status_code == 200, analytics.text
    payload = analytics.json()
    assert payload["summary"]["total"] == 3
    assert payload["summary"]["open"] == 1
    assert payload["summary"]["new"] == 1
    assert payload["summary"]["in_progress"] == 0
    assert payload["summary"]["review"] == 0
    assert payload["summary"]["done"] == 2
    assert payload["summary"]["done_on_time"] == 1
    assert payload["summary"]["done_without_due"] == 1
    assert payload["summary"]["overdue"] == 1
    assert payload["summary"]["with_due_total"] == 2
    assert payload["summary"]["completion_percent"] == pytest.approx(66.67, abs=0.01)
    assert payload["summary"]["completion_on_time_percent"] == pytest.approx(50.0, abs=0.01)
    assert payload["trend"]["granularity"] == "day"
    assert payload["trend"]["items"]
    assert {item["status"]: item["value"] for item in payload["status_breakdown"]} == {
        "new": 1,
        "in_progress": 0,
        "review": 0,
        "done": 2,
    }

    participant_filtered = client.get(
        "/hub/tasks/analytics",
        params={
            "start_date": protocol_day,
            "end_date": protocol_day,
            "date_basis": "protocol_date",
            "project_id": project["id"],
            "object_id": task_object["id"],
            "participant_user_id": 2,
        },
    )
    assert participant_filtered.status_code == 200, participant_filtered.text
    filtered_payload = participant_filtered.json()
    assert filtered_payload["summary"]["total"] == 2
    assert filtered_payload["summary"]["done"] == 2
    assert filtered_payload["summary"]["done_without_due"] == 1
    assert filtered_payload["by_participant"][0]["participant_user_id"] == 2
    assert filtered_payload["by_object"][0]["object_id"] == task_object["id"]

    overdue_detail = service.get_task(overdue_task["id"], user_id=1)
    assert overdue_detail is not None
    assert overdue_detail["is_overdue"] is True


def test_task_analytics_export_returns_excel(task_env):
    client = task_env["client"]
    set_user = task_env["set_user"]

    set_user(1)
    project_response = client.post(
        "/hub/task-projects",
        json={"name": "Проект Экспорт", "code": "export"},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()

    object_response = client.post(
        "/hub/task-objects",
        json={"project_id": project["id"], "name": "Объект Экспорт", "code": "exp-1"},
    )
    assert object_response.status_code == 200, object_response.text
    task_object = object_response.json()

    created = client.post(
        "/hub/tasks",
        json={
            "title": "Exported Task",
            "description": "Task for excel export",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "project_id": project["id"],
            "object_id": task_object["id"],
            "protocol_date": "2026-03-10",
            "due_at": "2026-03-20T10:00:00+00:00",
        },
    )
    assert created.status_code == 200, created.text
    task = created.json()["items"][0]

    set_user(2)
    submit = client.post(
        f"/hub/tasks/{task['id']}/submit",
        data={"comment": "Ready"},
        files={"file": ("report.txt", b"ok", "text/plain")},
    )
    assert submit.status_code == 200, submit.text

    set_user(3)
    review = client.post(
        f"/hub/tasks/{task['id']}/review",
        json={"decision": "approve", "comment": "Approved"},
    )
    assert review.status_code == 200, review.text

    set_user(1)
    response = client.get(
        "/hub/tasks/analytics/export",
        params={
            "start_date": "2026-03-01",
            "end_date": "2026-03-31",
            "date_basis": "protocol_date",
            "project_id": project["id"],
            "object_id": task_object["id"],
            "participant_user_id": 2,
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment; filename=" in response.headers.get("content-disposition", "")

    workbook = load_workbook(filename=BytesIO(response.content))
    assert workbook.sheetnames == ["Сводка", "По участникам", "По проектам", "По объектам", "Тренд"]

    summary_sheet = workbook["Сводка"]
    summary_rows = list(summary_sheet.iter_rows(values_only=True))
    flattened = [value for row in summary_rows for value in row if value not in (None, "")]
    assert "Аналитика задач" in flattened
    assert "Фильтры отчёта" in flattened
    assert "Ключевые показатели" in flattened

    assert workbook["По участникам"].max_row >= 1
    assert workbook["По проектам"].max_row >= 1
    assert workbook["По объектам"].max_row >= 1
    assert workbook["Тренд"].max_row >= 1


def test_delegate_receives_task_notifications_and_read_only_access(task_env, monkeypatch):
    client = task_env["client"]
    set_user = task_env["set_user"]

    monkeypatch.setattr(hub_service_module.user_service, "get_delegate_user_ids", lambda owner_user_id, active_only=True: [7] if int(owner_user_id) == 2 else [])
    monkeypatch.setattr(hub_service_module.user_service, "get_delegate_owner_ids", lambda delegate_user_id, active_only=True: [2] if int(delegate_user_id) == 7 else [])

    set_user(1)
    project_response = client.post(
        "/hub/task-projects",
        json={"name": "Проект Делегат", "code": "delegate"},
    )
    assert project_response.status_code == 200, project_response.text
    project = project_response.json()

    created = client.post(
        "/hub/tasks",
        json={
            "title": "Delegate Visible Task",
            "description": "Task body",
            "assignee_user_ids": [2],
            "controller_user_id": 3,
            "project_id": project["id"],
            "protocol_date": "2026-03-05",
        },
    )
    assert created.status_code == 200, created.text
    task = created.json()["items"][0]

    set_user(7)
    unread = client.get("/hub/notifications/unread-counts")
    assert unread.status_code == 200
    assert unread.json()["notifications_unread_total"] == 1

    polled = client.get("/hub/notifications/poll", params={"limit": 20, "unread_only": True})
    assert polled.status_code == 200, polled.text
    items = polled.json()["items"]
    assert any(item["event_type"] == "task.assigned" and item["entity_id"] == task["id"] for item in items)

    my_tasks = client.get("/hub/tasks", params={"scope": "my", "role_scope": "assignee"})
    assert my_tasks.status_code == 200, my_tasks.text
    assert any(item["id"] == task["id"] for item in my_tasks.json()["items"])

    detail = client.get(f"/hub/tasks/{task['id']}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["id"] == task["id"]

    update = client.patch(f"/hub/tasks/{task['id']}", json={"title": "Delegate Edit"})
    assert update.status_code == 403
