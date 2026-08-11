"""Unit tests for atomic claim+touch and client-message dedup detection."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.chat.chat_message_seq import claim_next_conversation_seq_and_touch
from backend.chat.message_persistence import is_expected_client_message_dedup_violation


def test_is_expected_client_message_dedup_violation_matches_constraint_name():
    class _Exc(Exception):
        pass

    exc = _Exc("UNIQUE constraint failed: uq_chat_messages_conversation_sender_client_message")
    assert is_expected_client_message_dedup_violation(exc) is True


def test_is_expected_client_message_dedup_violation_ignores_seq_unique():
    exc = Exception("duplicate key value violates unique constraint uq_chat_messages_conversation_seq")
    assert is_expected_client_message_dedup_violation(exc) is False


@pytest.fixture
def seq_chat_env(temp_dir, monkeypatch):
    import importlib
    import sys
    from pathlib import Path
    from types import SimpleNamespace

    PROJECT_ROOT = Path(__file__).resolve().parents[1]
    WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
    if str(WEB_ROOT) not in sys.path:
        sys.path.insert(0, str(WEB_ROOT))

    chat_db_module = importlib.import_module("backend.chat.db")
    chat_service_module = importlib.import_module("backend.chat.service")
    hub_service_module = importlib.import_module("backend.services.hub_service")

    raw_users = {
        1: {
            "id": 1,
            "username": "a",
            "full_name": "A",
            "role": "operator",
            "is_active": True,
            "use_custom_permissions": False,
            "custom_permissions": [],
            "permissions": [],
        },
        2: {
            "id": 2,
            "username": "b",
            "full_name": "B",
            "role": "operator",
            "is_active": True,
            "use_custom_permissions": False,
            "custom_permissions": [],
            "permissions": [],
        },
    }
    users = list(raw_users.values())
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: raw_users.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: raw_users.get(int(user_id)))
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
    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)
    yield {"service": service, "direct": direct, "db": chat_db_module}
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_claim_and_touch_updates_last_message_fields(seq_chat_env):
    from backend.chat.models import ChatConversation

    conversation_id = seq_chat_env["direct"]["id"]
    db = seq_chat_env["db"]
    now = datetime.now(timezone.utc)
    with db.chat_session() as session:
        seq = claim_next_conversation_seq_and_touch(
            session=session,
            conversation_id=conversation_id,
            message_id="msg-tip-1",
            seen_at=now,
            touch_tip=True,
        )
        tip = session.get(ChatConversation, conversation_id)
    assert seq == 1
    assert tip.last_message_id == "msg-tip-1"
    assert int(tip.last_message_seq) == 1
