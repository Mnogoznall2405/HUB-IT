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
        2: _raw_user(2, "peer", "Task Peer", "operator"),
        3: _raw_user(3, "controller", "Task Controller", "admin"),
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
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)

    yield {
        "service": service,
        "hub_service": hub_service,
        "direct": direct,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_reply_preview_is_returned_and_message_search_finds_matches(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    original = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Нужно обсудить договор по поставке",
    )
    reply = service.send_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        body="Смотрю договор прямо сейчас",
        reply_to_message_id=original["id"],
    )

    messages = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=20)
    reply_payload = next(item for item in messages["items"] if item["id"] == reply["id"])
    assert reply_payload["reply_preview"]["id"] == original["id"]
    assert reply_payload["reply_preview"]["body"] == "Нужно обсудить договор по поставке"
    assert reply_payload["reply_preview"]["sender_name"] == "Task"

    search = service.search_messages(
        current_user_id=1,
        conversation_id=conversation["id"],
        q="договор",
        limit=10,
    )
    found_ids = [item["id"] for item in search["items"]]
    assert original["id"] in found_ids
    assert reply["id"] in found_ids


def test_forward_message_preserves_markdown_body_format(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    original = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="## Inventory\n\n| Name | Value |\n| --- | --- |\n| Printer | Ready |\n\n**Source:** ITinvent",
        body_format="markdown",
    )
    forwarded = service.forward_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        source_message_id=original["id"],
    )
    legacy_forwarded = service.forward_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        source_message_id=original["id"],
        body="Legacy comment must not replace the original",
        body_format="plain",
    )

    assert forwarded["body_format"] == "markdown"
    assert forwarded["body"] == original["body"]
    assert legacy_forwarded["body_format"] == "markdown"
    assert legacy_forwarded["body"] == original["body"]
    assert forwarded["forward_preview"]["body"].startswith("Inventory")
    assert "##" not in forwarded["forward_preview"]["body"]
    assert "---" not in forwarded["forward_preview"]["body"]


def test_forward_message_repeat_keeps_original_attribution(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    original = service.send_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        body="Original author text",
    )
    forwarded_once = service.forward_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        source_message_id=original["id"],
    )
    forwarded_twice = service.forward_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        source_message_id=forwarded_once["id"],
    )

    assert forwarded_once["forward_preview"]["id"] == original["id"]
    assert forwarded_twice["forward_preview"]["id"] == original["id"]
    assert forwarded_twice["body"] == original["body"]


def test_conversation_settings_update_flags_and_muted_chat_skips_notifications(chat_env):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]
    conversation = chat_env["direct"]

    updated = service.update_conversation_settings(
        current_user_id=1,
        conversation_id=conversation["id"],
        is_pinned=True,
        is_muted=True,
        is_archived=True,
    )
    assert updated["is_pinned"] is True
    assert updated["is_muted"] is True
    assert updated["is_archived"] is True

    conversations = service.list_conversations(current_user_id=1, limit=20)
    assert conversations[0]["id"] == conversation["id"]
    assert conversations[0]["is_pinned"] is True
    assert conversations[0]["is_muted"] is True
    assert conversations[0]["is_archived"] is True

    service.send_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        body="Проверка mute и archive",
    )

    polled = hub_service.poll_notifications(user_id=1, limit=50)
    chat_items = [item for item in polled["items"] if item.get("entity_type") == "chat"]
    assert chat_items == []
