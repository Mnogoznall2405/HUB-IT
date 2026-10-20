from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.chat.chat_constants import NOTES_CONVERSATION_TITLE
from backend.chat.chat_serialization import ChatSerialization


@pytest.fixture
def service() -> MagicMock:
    return MagicMock()


@pytest.fixture
def serialization(service: MagicMock) -> ChatSerialization:
    return ChatSerialization(service)


def test_build_conversation_message_preview_uses_deleted_body(serialization: ChatSerialization) -> None:
    message = SimpleNamespace(is_deleted=True, body="secret", kind="text")
    preview = serialization._build_conversation_message_preview(
        session=MagicMock(),
        last_message=message,
        current_user_id=1,
        users_by_id={},
        conversation_kind="direct",
        attachments=[],
    )
    assert preview == "Сообщение удалено"


def test_serialize_upload_session_delegates_to_store(serialization: ChatSerialization, service: MagicMock) -> None:
    manifest = {"id": "sess-1"}
    service._upload_sessions.serialize_manifest.return_value = {"id": "sess-1", "status": "open"}
    result = serialization._serialize_upload_session(manifest)
    assert result["status"] == "open"
    service._upload_sessions.serialize_manifest.assert_called_once_with(manifest)


def test_serialize_conversation_notes_uses_constant_title(
    serialization: ChatSerialization,
    service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation = SimpleNamespace(
        id="conv-notes",
        kind="notes",
        title="",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=None,
        last_message_id=None,
        avatar_url=None,
        is_archived=False,
    )
    service._build_conversation_message_preview.return_value = ""
    service._count_unread_messages.return_value = 0

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={},
        members=[],
        state=None,
        last_message=None,
    )

    assert payload["title"] == NOTES_CONVERSATION_TITLE
    assert payload["kind"] == "notes"


def test_serialize_conversation_task_uses_hub_service(
    serialization: ChatSerialization,
    service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = MagicMock()
    hub.task_exists.return_value = True
    monkeypatch.setattr("backend.chat.service.hub_service", hub)

    conversation = SimpleNamespace(
        id="conv-task",
        kind="task",
        title="",
        task_id="task-42",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=None,
        last_message_id=None,
        avatar_url=None,
        is_archived=False,
    )
    service._get_hub_task_for_user.return_value = {
        "title": "Срочная задача",
        "status": "open",
        "assignee_full_name": "Иван",
        "due_at": "2026-06-01T00:00:00+00:00",
        "completed_at": None,
    }
    service._build_conversation_message_preview.return_value = ""
    service._count_unread_messages.return_value = 0

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=5,
        users_by_id={},
        members=[],
        state=None,
        last_message=None,
    )

    hub.task_exists.assert_called_once_with("task-42")
    assert payload["task_missing"] is False
    assert payload["title"] == "Задача: Срочная задача"
    assert payload["task_title"] == "Срочная задача"


def test_serialize_message_uses_preloaded_action_card(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    message = SimpleNamespace(
        id="msg-1",
        conversation_id="conv-1",
        sender_user_id=1,
        body="hello",
        body_format="plain",
        client_message_id=None,
        kind="text",
        is_deleted=False,
        created_at=datetime.now(timezone.utc),
        edited_at=None,
        deleted_at=None,
        deleted_by_user_id=None,
        deleted_reason=None,
        reply_to_message_id=None,
        forward_from_message_id=None,
        task_preview_json=None,
    )
    service._normalize_message_kind.return_value = "text"
    service._build_message_read_receipts.return_value = []
    service._deserialize_task_preview.return_value = None

    payload = serialization._serialize_message(
        message=message,
        current_user_id=1,
        users_by_id={1: {"id": 1, "username": "u1"}},
        action_cards_by_message_id={"msg-1": {"id": "card-1", "action_type": "test"}},
    )

    assert payload["action_card"]["id"] == "card-1"
    service._get_message_action_card.assert_not_called()


def test_serialize_conversation_task_missing_when_hub_has_no_task(
    serialization: ChatSerialization,
    service: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hub = MagicMock()
    hub.task_exists.return_value = False
    monkeypatch.setattr("backend.chat.service.hub_service", hub)

    conversation = SimpleNamespace(
        id="conv-task-missing",
        kind="task",
        title="",
        task_id="task-missing",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=None,
        last_message_id=None,
        avatar_url=None,
        is_archived=False,
    )
    service._get_hub_task_for_user.return_value = None
    service._build_conversation_message_preview.return_value = ""
    service._count_unread_messages.return_value = 0

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=5,
        users_by_id={},
        members=[],
        state=None,
        last_message=None,
    )

    assert payload["task_missing"] is True
    assert payload["title"] == "Чат по задаче"


def test_serialize_conversation_direct_own_last_message_read_status(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    conversation = SimpleNamespace(
        id="conv-direct",
        kind="direct",
        title="",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=datetime.now(timezone.utc),
        last_message_id="msg-own",
        avatar_url=None,
        is_archived=False,
    )
    last_message = SimpleNamespace(
        id="msg-own",
        sender_user_id=1,
        is_deleted=False,
        conversation_seq=10,
        created_at=datetime.now(timezone.utc),
    )
    members = [
        SimpleNamespace(user_id=1, member_role="member", joined_at=datetime.now(timezone.utc)),
        SimpleNamespace(user_id=2, member_role="member", joined_at=datetime.now(timezone.utc)),
    ]
    service._build_conversation_message_preview.return_value = "Привет"
    service._count_unread_messages.return_value = 0
    service._build_message_read_receipts.return_value = [{"user_id": 2, "read_at": datetime.now(timezone.utc)}]

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={
            1: {"id": 1, "full_name": "Me", "username": "me", "presence": {"is_online": True}},
            2: {"id": 2, "full_name": "Peer", "username": "peer", "presence": {"is_online": False}},
        },
        members=members,
        state=None,
        last_message=last_message,
        reads_by_message_id={"msg-own": [SimpleNamespace(user_id=2, read_at=datetime.now(timezone.utc))]},
        states_by_user_id={2: SimpleNamespace(last_read_seq=10, last_read_at=datetime.now(timezone.utc))},
    )

    assert payload["last_message_is_own"] is True
    assert payload["last_message_delivery_status"] == "read"
    service._build_message_read_receipts.assert_called_once()


def test_serialize_conversation_direct_own_last_message_sent_status(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    conversation = SimpleNamespace(
        id="conv-direct-sent",
        kind="direct",
        title="",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=datetime.now(timezone.utc),
        last_message_id="msg-sent",
        avatar_url=None,
        is_archived=False,
    )
    last_message = SimpleNamespace(
        id="msg-sent",
        sender_user_id=1,
        is_deleted=False,
        conversation_seq=11,
        created_at=datetime.now(timezone.utc),
    )
    members = [
        SimpleNamespace(user_id=1, member_role="member", joined_at=datetime.now(timezone.utc)),
        SimpleNamespace(user_id=2, member_role="member", joined_at=datetime.now(timezone.utc)),
    ]
    service._build_conversation_message_preview.return_value = "Ping"
    service._count_unread_messages.return_value = 0
    service._build_message_read_receipts.return_value = []

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={
            1: {"id": 1, "full_name": "Me", "username": "me", "presence": {"is_online": True}},
            2: {"id": 2, "full_name": "Peer", "username": "peer", "presence": {"is_online": False}},
        },
        members=members,
        state=None,
        last_message=last_message,
        reads_by_message_id={},
        states_by_user_id={},
    )

    assert payload["last_message_is_own"] is True
    assert payload["last_message_delivery_status"] == "sent"


def test_serialize_conversation_summary_includes_last_message_id(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    # CHAT-INBOX-01: клиенту нужен message_id для mark-read, а не только seq.
    conversation = SimpleNamespace(
        id="conv-last-id",
        kind="group",
        title="Склад",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=datetime.now(timezone.utc),
        last_message_id="msg-77",
        avatar_url=None,
        is_archived=False,
    )
    service._build_conversation_message_preview.return_value = "Привет"
    service._count_unread_messages.return_value = 0

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={},
        members=[],
        state=None,
        last_message=SimpleNamespace(
            id="msg-77",
            sender_user_id=2,
            is_deleted=False,
            conversation_seq=9,
            created_at=datetime.now(timezone.utc),
        ),
    )

    assert payload["last_message_id"] == "msg-77"
    assert payload["last_message_seq"] == 0


def test_serialize_conversation_summary_last_message_id_empty_when_absent(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    conversation = SimpleNamespace(
        id="conv-empty",
        kind="group",
        title="Пустая",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=None,
        last_message_id=None,
        avatar_url=None,
        is_archived=False,
    )
    service._build_conversation_message_preview.return_value = ""
    service._count_unread_messages.return_value = 0

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={},
        members=[],
        state=None,
        last_message=None,
    )

    assert payload["last_message_id"] is None


def test_serialize_conversation_incoming_last_message_has_no_delivery_status(
    serialization: ChatSerialization,
    service: MagicMock,
) -> None:
    conversation = SimpleNamespace(
        id="conv-incoming",
        kind="direct",
        title="",
        task_id=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        last_message_at=datetime.now(timezone.utc),
        last_message_id="msg-in",
        avatar_url=None,
        is_archived=False,
    )
    last_message = SimpleNamespace(
        id="msg-in",
        sender_user_id=2,
        is_deleted=False,
        conversation_seq=5,
        created_at=datetime.now(timezone.utc),
    )
    service._build_conversation_message_preview.return_value = "Ответ"
    service._count_unread_messages.return_value = 1

    payload = serialization._serialize_conversation(
        session=MagicMock(),
        conversation=conversation,
        current_user_id=1,
        users_by_id={},
        members=[],
        state=None,
        last_message=last_message,
    )

    assert payload["last_message_is_own"] is False
    assert payload["last_message_delivery_status"] is None
    service._build_message_read_receipts.assert_not_called()
