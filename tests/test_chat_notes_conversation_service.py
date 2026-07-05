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
        1: _raw_user(1, "author", "Notes Author", "operator"),
        2: _raw_user(2, "peer", "Notes Peer", "operator"),
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
    monkeypatch.setattr(hub_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
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

    yield {
        "service": service,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_get_or_create_notes_conversation_is_idempotent(chat_env):
    service = chat_env["service"]

    first = service.get_or_create_notes_conversation(current_user_id=1)
    second = service.get_or_create_notes_conversation(current_user_id=1)

    assert first["id"] == second["id"]
    assert first["kind"] == "notes"
    assert first["title"] == "Заметки"
    assert first["is_pinned"] is True
    assert first["direct_peer"] is None


def test_notes_message_does_not_increment_unread_for_author(chat_env):
    service = chat_env["service"]
    notes = service.get_or_create_notes_conversation(current_user_id=1)

    service.send_message(
        current_user_id=1,
        conversation_id=notes["id"],
        body="Напомнить себе про отчёт",
    )

    conversations = service.list_conversations(current_user_id=1, limit=50)["items"]
    notes_item = next(item for item in conversations if item["id"] == notes["id"])
    assert notes_item["unread_count"] == 0
    assert "отч" in notes_item["last_message_preview"].lower()


def test_notes_conversation_rejects_group_member_operations(chat_env):
    service = chat_env["service"]
    notes = service.get_or_create_notes_conversation(current_user_id=1)

    with pytest.raises(ValueError, match="Group conversation required"):
        service.add_group_members(
            current_user_id=1,
            conversation_id=notes["id"],
            member_user_ids=[2],
        )

    with pytest.raises(ValueError, match="Group conversation required"):
        service.leave_group(current_user_id=1, conversation_id=notes["id"])
