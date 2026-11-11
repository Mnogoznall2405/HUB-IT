from __future__ import annotations

import importlib
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

notification_dispatcher_module = importlib.import_module("backend.chat.notification_dispatcher")


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, *, existing=None) -> None:
        self.existing = existing
        self.added = []
        self.executed = []

    def execute(self, statement):
        self.executed.append(statement)
        return _ScalarResult(self.existing)

    def add(self, item):
        self.added.append(item)


class _HubService:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.created = []

    def _create_notification(self, **kwargs):
        if self.fail:
            raise RuntimeError("hub failed")
        self.created.append(kwargs)


class _PushService:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.sent = []

    def send_chat_message_notification(self, **kwargs):
        if self.fail:
            raise RuntimeError("push failed")
        self.sent.append(kwargs)


def test_dispatcher_suppresses_push_outbox_when_hub_notification_fails():
    hub = _HubService(fail=True)
    push = _PushService()
    session = _FakeSession()
    dispatcher = notification_dispatcher_module.ChatNotificationDispatcher(
        hub_service=hub,
        push_service=push,
    )

    result = dispatcher.dispatch(
        session=session,
        hub_conn=None,
        recipient_user_id=2,
        conversation_id="conversation-1",
        message_id="message-1",
        event_type="chat.message",
        title="Task Author",
        body="Hello",
        defer_push_notifications=True,
        outbox_now=datetime.now(timezone.utc),
    )

    assert result.hub_created is False
    assert result.push_created is False
    assert push.sent == []
    assert session.added == []


def test_dispatcher_enqueues_deferred_push_outbox_once():
    dispatcher = notification_dispatcher_module.ChatNotificationDispatcher(
        hub_service=_HubService(),
        push_service=_PushService(),
    )
    session = _FakeSession()
    now = datetime.now(timezone.utc)

    result = dispatcher.dispatch(
        session=session,
        hub_conn=None,
        recipient_user_id=2,
        conversation_id="conversation-1",
        message_id="message-1",
        event_type="chat.message",
        title="Task Author",
        body="Hello",
        defer_push_notifications=True,
        outbox_now=now,
    )

    assert result.hub_created is True
    assert result.push_created is True
    assert len(session.added) == 1
    job = session.added[0]
    assert job.message_id == "message-1"
    assert job.conversation_id == "conversation-1"
    assert job.recipient_user_id == 2
    assert job.channel == "chat"
    assert job.status == "queued"


def test_dispatcher_does_not_duplicate_existing_outbox_job():
    dispatcher = notification_dispatcher_module.ChatNotificationDispatcher(
        hub_service=_HubService(),
        push_service=_PushService(),
    )
    existing = object()
    session = _FakeSession(existing=existing)

    created = dispatcher.upsert_push_outbox_job(
        session=session,
        recipient_user_id=2,
        conversation_id="conversation-1",
        message_id="message-1",
        channel="chat",
        title="Task Author",
        body="Hello",
        now=datetime.now(timezone.utc),
    )

    assert created is False
    assert session.added == []


def test_dispatcher_sends_direct_push_after_hub_notification():
    hub = _HubService()
    push = _PushService()
    dispatcher = notification_dispatcher_module.ChatNotificationDispatcher(
        hub_service=hub,
        push_service=push,
    )

    result = dispatcher.dispatch(
        session=_FakeSession(),
        hub_conn=None,
        recipient_user_id=2,
        conversation_id="conversation-1",
        message_id="message-1",
        event_type="chat.message",
        title="Task Author",
        body="Hello",
        defer_push_notifications=False,
        outbox_now=datetime.now(timezone.utc),
    )

    assert result.hub_created is True
    assert result.push_created is True
    assert hub.created[0]["recipient_user_id"] == 2
    assert push.sent == [
        {
            "recipient_user_id": 2,
            "conversation_id": "conversation-1",
            "message_id": "message-1",
            "title": "Task Author",
            "body": "Hello",
        }
    ]
