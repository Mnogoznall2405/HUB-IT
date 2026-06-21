from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
task_discussion_module = importlib.import_module("backend.chat.task_discussion")


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
def task_discussion_env(temp_dir, monkeypatch):
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
    monkeypatch.setattr(task_discussion_module, "hub_service", hub_service)

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

    chat_db_module.initialize_chat_schema()

    actor = {"id": 1, "username": "author", "full_name": "Task Author", "role": "operator"}
    project = hub_service.create_task_project(name="Task Discussion Project", code="TASK_DISC")
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
        "hub_service": hub_service,
        "chat_service": chat_service_module.ChatService(),
        "task": task,
        "chat_db_path": Path(temp_dir) / "chat.sqlite3",
    }
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_get_task_discussion_returns_placeholder_before_open(task_discussion_env):
    task = task_discussion_env["task"]
    payload = task_discussion_module.get_task_discussion(task_id=task["id"], actor_user_id=1)

    assert payload["conversation_id"] is None
    assert payload["created"] is False
    assert payload["kind"] == "task"
    assert payload["task_id"] == task["id"]
    assert payload["task_title"] == "Проверить акт"


def test_ensure_task_discussion_creates_members_and_message_channel(task_discussion_env):
    task = task_discussion_env["task"]
    chat_service = task_discussion_env["chat_service"]

    created = task_discussion_module.ensure_task_discussion(task_id=task["id"], actor_user_id=1)
    assert created["created"] is True
    assert created["kind"] == "task"
    assert created["conversation_id"]

    reopened = task_discussion_module.ensure_task_discussion(task_id=task["id"], actor_user_id=2)
    assert reopened["created"] is False
    assert reopened["conversation_id"] == created["conversation_id"]

    with chat_db_module.chat_session() as session:
        members = session.execute(
            select(chat_models_module.ChatMember).where(
                chat_models_module.ChatMember.conversation_id == created["conversation_id"],
                chat_models_module.ChatMember.left_at.is_(None),
            )
        ).scalars().all()
        conversation = session.get(chat_models_module.ChatConversation, created["conversation_id"])

    assert conversation.kind == "task"
    assert conversation.task_id == task["id"]
    assert {int(item.user_id) for item in members} == {1, 2, 3}

    message = task_discussion_module.send_task_discussion_message(
        task_id=task["id"],
        actor_user_id=1,
        body="Новый комментарий в чате",
    )
    assert message["body"] == "Новый комментарий в чате"

    listed = chat_service.list_conversations(current_user_id=2, limit=20)
    task_conversations = [item for item in listed if item.get("kind") == "task" or item.get("task_id") == task["id"]]
    assert len(task_conversations) == 1
    assert task_conversations[0]["task_title"] == "Проверить акт"


def test_ensure_task_discussion_denies_outsider(task_discussion_env):
    task = task_discussion_env["task"]
    with pytest.raises(PermissionError):
        task_discussion_module.ensure_task_discussion(task_id=task["id"], actor_user_id=4)


def test_hub_add_comment_blocked_when_task_discussion_enabled(task_discussion_env):
    hub_service = task_discussion_env["hub_service"]
    task = task_discussion_env["task"]

    with pytest.raises(ValueError, match="use_task_discussion_chat"):
        hub_service.add_task_comment(
            task_id=task["id"],
            body="legacy comment",
            user={"id": 1, "username": "author", "full_name": "Task Author", "role": "operator"},
        )
