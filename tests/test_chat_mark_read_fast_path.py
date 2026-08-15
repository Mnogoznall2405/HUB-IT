"""Unit tests for mark_read fast path (no conversation FOR UPDATE / no sync hub)."""
from __future__ import annotations

import importlib
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, RLock
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")
chat_service_module = importlib.import_module("backend.chat.service")
chat_db_module = importlib.import_module("backend.chat.db")
ChatCache = importlib.import_module("backend.chat.chat_cache").ChatCache


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
    chat_db_module._read_engine = None
    chat_db_module._read_session_factory = None
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
    chat_db_module._read_engine = None
    chat_db_module._read_session_factory = None


def test_mark_read_does_not_lock_conversation_or_call_hub_sync(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="hello for mark_read fast path",
    )
    assert int(created["conversation_seq"]) > 0
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

    detail = service.get_conversation(
        current_user_id=2,
        conversation_id=conversation["id"],
    )
    assert int(detail["last_message_seq"]) == int(created["conversation_seq"])
    assert int(detail["viewer_last_read_seq"]) == int(created["conversation_seq"])

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


def test_parallel_mark_read_is_idempotent(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="parallel read receipt",
    )
    service.apply_delivery_state_for_message(message_id=created["id"])
    barrier = Barrier(2)

    def mark_once():
        barrier.wait(timeout=5)
        return service.mark_read(
            current_user_id=2,
            conversation_id=conversation["id"],
            message_id=created["id"],
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _index: mark_once(), range(2)))

    assert sum(1 for payload in results if payload["changed"]) == 1
    assert all(payload["conversation_id"] == conversation["id"] for payload in results)
    detail = service.get_conversation(
        current_user_id=2,
        conversation_id=conversation["id"],
    )
    assert int(detail["viewer_last_read_seq"]) == int(created["conversation_seq"])


def test_mark_read_cursor_never_moves_backwards(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    first = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="first unread message",
    )
    second = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="second unread message",
    )
    service.apply_delivery_state_for_message(message_id=first["id"])
    service.apply_delivery_state_for_message(message_id=second["id"])

    latest = service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=second["id"],
    )
    stale = service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=first["id"],
    )

    assert latest["changed"] is True
    assert stale["changed"] is False
    detail = service.get_conversation(
        current_user_id=2,
        conversation_id=conversation["id"],
    )
    assert int(detail["viewer_last_read_seq"]) == int(second["conversation_seq"])
    assert int(detail["unread_count"]) == 0


def test_mark_read_invalidates_the_default_conversation_list_page() -> None:
    service = SimpleNamespace(
        _cache_lock=RLock(),
        _runtime_cache={},
        _cache_key=lambda *, user_id, bucket, extra="": f"{int(user_id)}::{bucket}::{extra}",
    )
    cache = ChatCache(service)

    with patch("backend.chat.chat_cache.chat_read_cache_redis.delete_keys") as delete_keys:
        cache._invalidate_reader_views_after_mark_read(
            conversation_id="conv-1",
            user_id=7,
        )

    assert "7::conversations::50" in delete_keys.call_args.args[0]


def test_conversation_update_invalidates_default_list_pages_for_members() -> None:
    service = SimpleNamespace(
        _cache_lock=RLock(),
        _runtime_cache={},
        _cache_key=lambda *, user_id, bucket, extra="": f"{int(user_id)}::{bucket}::{extra}",
    )
    cache = ChatCache(service)

    with patch("backend.chat.chat_cache.chat_read_cache_redis.delete_keys") as delete_keys:
        cache._invalidate_conversation_views_for_users(
            conversation_id="conv-1",
            user_ids=[7, 8],
        )

    deleted = delete_keys.call_args.args[0]
    assert "7::conversations::50" in deleted
    assert "8::conversations::50" in deleted
