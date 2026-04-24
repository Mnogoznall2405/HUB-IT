from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
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


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
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
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {
            int(user_id): dict(users_by_id[int(user_id)])
            for user_id in list(user_ids or [])
            if int(user_id) in users_by_id
        },
    )
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions", lambda active_only=False: [])
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions_by_user_ids", lambda user_ids, active_only=False: [])

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
    group = service.create_group_conversation(current_user_id=1, title="Ops", member_user_ids=[2, 3])

    yield {
        "service": service,
        "direct": direct,
        "group": group,
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_presence_is_included_for_users_and_conversations(chat_env, monkeypatch):
    service = chat_env["service"]
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(
        chat_service_module.session_service,
        "list_sessions",
        lambda active_only=False: [
            {
                "user_id": 2,
                "last_seen_at": _iso(now - timedelta(seconds=40)),
                "status": "active",
                "is_active": True,
            },
            {
                "user_id": 3,
                "last_seen_at": _iso(now - timedelta(minutes=14)),
                "status": "terminated",
                "is_active": False,
            },
        ],
    )
    monkeypatch.setattr(
        chat_service_module.session_service,
        "list_sessions_by_user_ids",
        lambda user_ids, active_only=False: [
            item
            for item in [
                {
                    "user_id": 2,
                    "last_seen_at": _iso(now - timedelta(seconds=40)),
                    "status": "active",
                    "is_active": True,
                },
                {
                    "user_id": 3,
                    "last_seen_at": _iso(now - timedelta(minutes=14)),
                    "status": "terminated",
                    "is_active": False,
                },
            ]
            if int(item["user_id"]) in {int(user_id) for user_id in list(user_ids or [])}
        ],
    )

    users = service.list_available_users(current_user_id=1, limit=20)
    by_id = {item["id"]: item for item in users}
    assert by_id[2]["presence"]["is_online"] is True
    assert by_id[2]["presence"]["status_text"] == "В сети"
    assert by_id[3]["presence"]["is_online"] is False
    assert by_id[3]["presence"]["last_seen_at"]

    conversations = service.list_conversations(current_user_id=1, limit=20)
    direct = next(item for item in conversations if item["id"] == chat_env["direct"]["id"])
    group = next(item for item in conversations if item["id"] == chat_env["group"]["id"])
    group_detail = service.get_conversation(current_user_id=1, conversation_id=chat_env["group"]["id"])

    assert direct["direct_peer"]["presence"]["is_online"] is True
    assert group["member_count"] == 3
    assert group["online_member_count"] >= 1
    assert len(group["member_preview"]) <= 3
    assert any(member["user"]["presence"]["is_online"] is True for member in group_detail["members"] if member["user"]["id"] == 2)
    assert any(member["user"]["presence"]["is_online"] is False for member in group_detail["members"] if member["user"]["id"] == 3)


def test_list_available_users_uses_targeted_presence_lookup(chat_env, monkeypatch):
    service = chat_env["service"]
    now = datetime.now(timezone.utc)

    def _global_sessions_not_expected(*, active_only=False):
        raise AssertionError("global session scan is not expected for list_available_users")

    monkeypatch.setattr(chat_service_module.session_service, "list_sessions", _global_sessions_not_expected)
    monkeypatch.setattr(
        chat_service_module.session_service,
        "list_sessions_by_user_ids",
        lambda user_ids, active_only=False: [
            {
                "user_id": 2,
                "last_seen_at": _iso(now - timedelta(seconds=20)),
                "status": "active",
                "is_active": True,
            }
            for _ in [0]
            if 2 in {int(user_id) for user_id in list(user_ids or [])}
        ],
    )

    users = service.list_available_users(current_user_id=1, limit=20)
    by_id = {item["id"]: item for item in users}

    assert by_id[2]["presence"]["is_online"] is True
    assert by_id[2]["presence"]["status_text"]


def test_conversation_summary_paths_do_not_require_full_members_payload(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["group"]

    def _full_members_payload_not_expected(*args, **kwargs):
        raise AssertionError("summary paths should not build full members payload")

    monkeypatch.setattr(service, "_serialize_conversation_members", _full_members_payload_not_expected)

    summary = service.get_conversation_summary(
        current_user_id=1,
        conversation_id=conversation["id"],
    )
    batched = service.get_conversation_summaries_for_users(
        conversation_id=conversation["id"],
        user_ids=[1, 2, 3],
    )
    listed = service.list_conversations(current_user_id=1, limit=20)
    listed_group = next(item for item in listed if item["id"] == conversation["id"])

    assert summary["member_count"] == 3
    assert len(summary["member_preview"]) <= 3
    assert batched[1]["member_count"] == 3
    assert len(batched[1]["member_preview"]) <= 3
    assert listed_group["member_count"] == 3
    assert len(listed_group["member_preview"]) <= 3


def test_direct_read_receipts_change_from_sent_to_read(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Проверь, пожалуйста",
    )

    messages_before = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=20)
    assert messages_before["items"][0]["id"] == created["id"]
    assert messages_before["items"][0]["delivery_status"] == "sent"
    assert messages_before["items"][0]["read_by_count"] == 0
    assert messages_before["viewer_last_read_message_id"] == created["id"]
    assert messages_before["viewer_last_read_at"]

    service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )

    messages_after = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=20)
    assert messages_after["items"][0]["delivery_status"] == "read"
    assert messages_after["items"][0]["read_by_count"] == 1

    reads = service.get_message_reads(current_user_id=1, message_id=created["id"])
    assert [item["user"]["id"] for item in reads["items"]] == [2]
    assert reads["items"][0]["read_at"]


def test_group_read_receipts_return_reader_list_for_sender_only(chat_env):
    service = chat_env["service"]
    conversation = chat_env["group"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Обновление по задаче",
    )

    service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )

    messages = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=20)
    own_message = next(item for item in messages["items"] if item["id"] == created["id"])
    assert own_message["read_by_count"] == 1
    assert own_message["delivery_status"] == "read"

    reads = service.get_message_reads(current_user_id=1, message_id=created["id"])
    assert [item["user"]["id"] for item in reads["items"]] == [2]

    with pytest.raises(PermissionError):
        service.get_message_reads(current_user_id=2, message_id=created["id"])


def test_unread_summaries_and_batched_conversation_summaries_use_new_counters(chat_env):
    service = chat_env["service"]
    conversation = chat_env["group"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Unread counter probe",
    )

    unread_by_user = service.get_unread_summaries(user_ids=[1, 2, 3])
    assert unread_by_user[1] == {
        "messages_unread_total": 0,
        "conversations_unread": 0,
    }
    assert unread_by_user[2] == {
        "messages_unread_total": 1,
        "conversations_unread": 1,
    }
    assert unread_by_user[3] == {
        "messages_unread_total": 1,
        "conversations_unread": 1,
    }

    summaries = service.get_conversation_summaries_for_users(
        conversation_id=conversation["id"],
        user_ids=[1, 2, 999],
    )
    assert set(summaries) == {1, 2}
    assert summaries[1]["id"] == conversation["id"]
    assert summaries[2]["id"] == conversation["id"]
    assert summaries[1]["unread_count"] == 0
    assert summaries[2]["unread_count"] == 1
    assert summaries[1]["last_message_preview"]

    read_delta_before = service.get_message_read_delta(
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert read_delta_before["read_by_count"] == 0
    assert read_delta_before["delivery_status"] == "sent"

    service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )

    read_delta_after = service.get_message_read_delta(
        conversation_id=conversation["id"],
        message_id=created["id"],
    )
    assert read_delta_after["read_by_count"] == 1
    assert read_delta_after["delivery_status"] == "read"


def test_latest_pagination_is_stable_when_messages_share_created_at(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    first = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="First timestamp-colliding message",
    )
    second = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Second timestamp-colliding message",
    )

    with chat_db_module.chat_session() as session:
        first_row = session.get(chat_models_module.ChatMessage, first["id"])
        second_row = session.get(chat_models_module.ChatMessage, second["id"])
        assert first_row is not None
        assert second_row is not None
        second_row.created_at = first_row.created_at
        session.flush()

    first_page = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=1)
    assert len(first_page["items"]) == 1

    second_page = service.get_messages(
        current_user_id=1,
        conversation_id=conversation["id"],
        limit=1,
        before_message_id=first_page["items"][0]["id"],
    )
    assert len(second_page["items"]) == 1
    assert second_page["items"][0]["id"] != first_page["items"][0]["id"]
    assert {first_page["items"][0]["id"], second_page["items"][0]["id"]} == {first["id"], second["id"]}


def test_after_cursor_missing_does_not_fall_back_to_old_history(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Cursor invalid after probe",
    )

    payload = service.get_messages(
        current_user_id=1,
        conversation_id=conversation["id"],
        after_message_id="optimistic:missing-message",
        limit=20,
    )

    assert payload["items"] == []
    assert payload["cursor_invalid"] is True
    assert payload["has_older"] is False
    assert payload["has_newer"] is False
    assert payload["viewer_last_read_message_id"] == created["id"]
    assert payload["viewer_last_read_at"]


def test_before_cursor_missing_does_not_fall_back_to_old_history(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Cursor invalid before probe",
    )

    payload = service.get_messages(
        current_user_id=1,
        conversation_id=conversation["id"],
        before_message_id="optimistic:missing-message",
        limit=20,
    )

    assert payload["items"] == []
    assert payload["cursor_invalid"] is True
    assert payload["has_older"] is False
    assert payload["has_newer"] is False
    assert payload["viewer_last_read_message_id"] == created["id"]
    assert payload["viewer_last_read_at"]
