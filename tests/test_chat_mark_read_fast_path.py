"""Unit tests for mark_read fast path (no conversation FOR UPDATE / no sync hub)."""
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

hub_service_module = importlib.import_module("backend.services.hub_service")
chat_service_module = importlib.import_module("backend.chat.service")
chat_db_module = importlib.import_module("backend.chat.db")


def _raw_user(user_id: int, username: str, full_name: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
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
    monkeypatch.setattr(hub_service_module, "hub_service", hub_service)
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    yield {"service": service, "hub_service": hub_service, "direct": direct}
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_mark_read_does_not_lock_conversation_or_call_hub_sync(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="hello for mark_read fast path",
    )
    service.apply_delivery_state_for_message(message_id=created["id"])

    called = {"lock": 0, "hub": 0}

    def _boom_lock(**kwargs):
        called["lock"] += 1
        raise AssertionError("mark_read must not call _lock_conversation_for_write")

    def _boom_hub(**kwargs):
        called["hub"] += 1
        raise AssertionError("mark_read must not call hub_service synchronously")

    monkeypatch.setattr(service, "_lock_conversation_for_write", _boom_lock)
    monkeypatch.setattr(
        "backend.chat.service.hub_service.mark_chat_notifications_read",
        _boom_hub,
    )

    payload = service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert payload["changed"] is True
    assert payload["clear_hub_notifications"] is True
    assert called["lock"] == 0
    assert called["hub"] == 0

    cleared = service.clear_hub_notifications_after_mark_read(
        conversation_id=conversation["id"],
        user_id=2,
    )
    assert int(cleared) >= 0

    again = service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert again["changed"] is False
    assert again["clear_hub_notifications"] is False
