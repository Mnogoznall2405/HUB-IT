from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")
chat_db_module = importlib.import_module("backend.chat.db")
chat_service_module = importlib.import_module("backend.chat.service")
task_discussion_module = importlib.import_module("backend.chat.task_discussion")

TASKS_READ = "tasks.read"


def _raw_user(user_id: int, username: str, full_name: str, role: str, permissions: list[str]) -> dict:
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
def discussion_api_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator", [TASKS_READ]),
        2: _raw_user(2, "assignee", "Task Assignee", "operator", [TASKS_READ]),
        3: _raw_user(3, "controller", "Task Controller", "admin", [TASKS_READ]),
        4: _raw_user(4, "outsider", "Task Outsider", "viewer", [TASKS_READ]),
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
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)
    monkeypatch.setattr(chat_service_module, "hub_service", service)
    monkeypatch.setattr(task_discussion_module, "hub_service", service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "task_discussion_enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)
    monkeypatch.setattr(task_discussion_module.config.chat, "task_discussion_enabled", True, raising=False)

    monkeypatch.setattr(task_discussion_module.config.chat, "task_discussion_enabled", True, raising=False)

    chat_db_module.initialize_chat_schema()

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")
    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    actor = {"id": 1, "username": "author", "full_name": "Task Author", "role": "operator"}
    project = service.create_task_project(name="API Discussion Project", code="API_DISC")
    task = service.create_task(
        title="API task discussion",
        description="Task body",
        assignee_user_id=2,
        controller_user_id=3,
        due_at="2026-03-22T10:00:00Z",
        project_id=project["id"],
        actor=actor,
    )

    yield {
        "client": client,
        "set_user": set_user,
        "task": task,
    }
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_task_discussion_api_get_and_open(discussion_api_env):
    client = discussion_api_env["client"]
    task = discussion_api_env["task"]
    task_id = task["id"]

    get_response = client.get(f"/hub/tasks/{task_id}/discussion")
    assert get_response.status_code == 200
    assert get_response.json()["conversation_id"] is None

    open_response = client.post(f"/hub/tasks/{task_id}/discussion")
    assert open_response.status_code == 200
    payload = open_response.json()
    assert payload["created"] is True
    assert payload["conversation_id"]

    second_open = client.post(f"/hub/tasks/{task_id}/discussion")
    assert second_open.status_code == 200
    assert second_open.json()["created"] is False

    comment_response = client.post(
        f"/hub/tasks/{task_id}/comments",
        json={"body": "legacy"},
    )
    assert comment_response.status_code == 400
    assert comment_response.json()["detail"] == "use_task_discussion_chat"


def test_task_discussion_api_forbidden_for_outsider(discussion_api_env):
    client = discussion_api_env["client"]
    task_id = discussion_api_env["task"]["id"]
    discussion_api_env["set_user"](4)

    response = client.post(f"/hub/tasks/{task_id}/discussion")
    assert response.status_code == 403
