from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str, *, active: bool = True) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": active,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
        3: _raw_user(3, "controller", "Task Controller", "admin"),
        4: _raw_user(4, "outsider", "Task Outsider", "viewer"),
    }
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    actor = {"id": 1, "username": "author", "full_name": "Task Author", "role": "operator"}
    project = hub_service.create_task_project(name="Chat Share Project", code="CHAT_SHARE")
    task = hub_service.create_task(
        title="Проверить акт",
        description="Task body",
        assignee_user_id=2,
        controller_user_id=3,
        due_at="2026-03-22T10:00:00Z",
        project_id=project["id"],
        priority="high",
        actor=actor,
    )
    yield {
        "service": service,
        "task": task,
        "direct": service.create_direct_conversation(current_user_id=1, peer_user_id=2),
        "restricted_direct": service.create_direct_conversation(current_user_id=1, peer_user_id=4),
        "chat_db_path": Path(temp_dir) / "chat.sqlite3",
        "hub_db_path": Path(temp_dir) / "hub.sqlite3",
    }
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_task_share_lists_and_persists_snapshot(chat_env):
    service = chat_env["service"]
    task = chat_env["task"]
    conversation = chat_env["direct"]

    shareable = service.list_shareable_tasks(
        current_user_id=1,
        conversation_id=conversation["id"],
        q="акт",
        limit=20,
    )

    assert [item["id"] for item in shareable] == [task["id"]]
    assert shareable[0]["priority"] == "high"

    created = service.send_task_share(
        current_user_id=1,
        conversation_id=conversation["id"],
        task_id=task["id"],
    )

    assert created["kind"] == "task_share"
    assert created["task_preview"]["id"] == task["id"]
    assert created["task_preview"]["title"] == "Проверить акт"

    messages = service.get_messages(current_user_id=2, conversation_id=conversation["id"], limit=20)
    assert len(messages["items"]) == 1
    assert messages["items"][0]["kind"] == "task_share"
    assert messages["items"][0]["task_preview"]["id"] == task["id"]

    conversations = service.list_conversations(current_user_id=2, limit=20)
    assert conversations[0]["last_message_preview"].startswith("Задача:")
    assert chat_env["chat_db_path"].exists()
    assert chat_env["hub_db_path"].exists()


def test_task_share_is_blocked_when_other_chat_member_has_no_task_access(chat_env):
    service = chat_env["service"]
    task = chat_env["task"]
    conversation = chat_env["restricted_direct"]

    shareable = service.list_shareable_tasks(
        current_user_id=1,
        conversation_id=conversation["id"],
        limit=20,
    )
    assert shareable == []

    with pytest.raises(PermissionError):
        service.send_task_share(
            current_user_id=1,
            conversation_id=conversation["id"],
            task_id=task["id"],
        )
