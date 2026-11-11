from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator
from backend.chat.chat_serialization import ChatSerialization
import backend.chat.chat_notification_orchestrator as orchestrator_module


class _ScalarResult:
    def scalars(self):
        return []


class _Session:
    def execute(self, _query):
        return _ScalarResult()


class _NotificationService:
    def _require_membership(self, **_kwargs):
        return SimpleNamespace(id="conv-direct", kind="direct", title=None)

    def _conversation_member_ids(self, _session, _conversation_id):
        return [1, 2]


@contextmanager
def _chat_session():
    yield _Session()


def test_notification_orchestrator_filters_disabled_direct_chat_recipients(monkeypatch):
    preference_calls = []

    def _enabled_user_ids(*, user_ids, channel):
        preference_calls.append((set(user_ids), channel))
        return set()

    monkeypatch.setattr(orchestrator_module, "chat_session", _chat_session)
    monkeypatch.setattr(
        orchestrator_module.notification_preferences_service,
        "enabled_user_ids",
        _enabled_user_ids,
    )
    monkeypatch.setattr(
        orchestrator_module.user_service,
        "get_users_map_by_ids",
        lambda _user_ids: {1: {"full_name": "Author"}},
    )

    stats = ChatNotificationOrchestrator(_NotificationService())._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-direct",
        message_id="msg-1",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body="Silent direct message",
        create_hub_notifications=False,
        enqueue_push_outbox=False,
    )

    assert preference_calls == [({2}, "chat_direct")]
    assert int(stats["recipient_count"]) == 0
    assert int(stats["hub_count"]) == 0
    assert int(stats["push_count"]) == 0


def test_realtime_message_payload_includes_conversation_kind():
    service = SimpleNamespace(
        _normalize_message_kind=lambda value: str(value or "text"),
        _deserialize_task_preview=lambda _value: None,
    )
    message = SimpleNamespace(
        id="msg-task",
        conversation_id="conv-task",
        conversation_seq=3,
        kind="text",
        body_format="plain",
        client_message_id=None,
        sender_user_id=1,
        body="Task reply",
        created_at=datetime(2026, 8, 21, tzinfo=timezone.utc),
        edited_at=None,
        is_deleted=False,
    )

    payload = ChatSerialization(service)._serialize_message(
        conversation_kind="task",
        message=message,
        current_user_id=2,
        users_by_id={1: {"id": 1, "username": "author", "full_name": "Author"}},
        attachments=[],
        action_cards_by_message_id={},
    )

    assert payload["conversation_kind"] == "task"

