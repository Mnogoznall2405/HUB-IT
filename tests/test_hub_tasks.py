from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib

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
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_tasks.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
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
    response = client.post(
        "/hub/tasks",
        json={
            "title": title,
            "description": "Task body",
            "assignee_user_ids": [assignee_user_id],
            "controller_user_id": controller_user_id,
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
    assert any(
        item["event_type"] == "task.comment_added" and item["entity_id"] == task_id and item["unread"] == 1
        for item in author_poll.json()["items"]
    )
    author_counts_before = client.get("/hub/notifications/unread-counts")
    assert author_counts_before.status_code == 200
    assert author_counts_before.json()["notifications_unread_total"] == 1

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
