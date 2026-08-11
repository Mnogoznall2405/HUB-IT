"""Chat notification ordering: push outbox before hub when deferred."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock


def _patch_orchestrator_deps(monkeypatch, *, member_ids=None, states=None):
    from backend.chat import chat_notification_orchestrator as orch_mod

    member_ids = member_ids or [1, 2]
    states = states or [
        SimpleNamespace(user_id=1, is_muted=False, is_archived=False),
        SimpleNamespace(user_id=2, is_muted=False, is_archived=False),
    ]
    conversation = SimpleNamespace(id="conv-1", kind="direct", title="")

    class _Session:
        def execute(self, *_args, **_kwargs):
            return SimpleNamespace(scalars=lambda: iter(states))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(orch_mod, "chat_session", lambda: _Session())
    monkeypatch.setattr(
        orch_mod,
        "build_chat_notification_recipient_plans",
        lambda **kwargs: [SimpleNamespace(recipient_user_id=2, is_mentioned=False, skip=False)],
    )
    monkeypatch.setattr(
        orch_mod.user_service,
        "get_users_map_by_ids",
        lambda ids: {1: {"full_name": "Author", "username": "author"}},
    )
    return conversation, member_ids


def test_create_chat_notifications_enqueues_push_before_hub_when_deferred(monkeypatch):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_write_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "backend.chat.latency_profile.hub_ordinary_write_enabled",
        lambda: True,
    )
    conversation, member_ids = _patch_orchestrator_deps(monkeypatch)
    call_order: list[str] = []

    hub_service = MagicMock()
    hub_service.create_notifications_batch.side_effect = lambda rows, conn=None: (
        call_order.append("hub"),
        len(rows),
    )[1]

    dispatcher = MagicMock()
    dispatcher._hub_service = hub_service
    dispatcher.open_hub_connection.return_value.__enter__.return_value = object()
    dispatcher.open_hub_connection.return_value.__exit__.return_value = False

    def _upsert_batch(**kwargs):
        call_order.append("push")
        return len(kwargs.get("jobs") or [])

    dispatcher.upsert_push_outbox_jobs_batch.side_effect = _upsert_batch

    service = MagicMock()
    service._require_membership.return_value = conversation
    service._conversation_member_ids.return_value = member_ids
    service._notification_dispatcher = dispatcher

    orch = ChatNotificationOrchestrator(service)
    stats = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body="hello",
        defer_push_notifications=True,
    )

    assert call_order == ["push", "hub"]
    assert stats["push_count"] == 1
    assert stats["hub_count"] == 1


def test_create_chat_notifications_can_skip_hub_or_push(monkeypatch):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_write_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "backend.chat.latency_profile.hub_ordinary_write_enabled",
        lambda: True,
    )
    conversation, member_ids = _patch_orchestrator_deps(monkeypatch)

    hub_service = MagicMock()
    hub_service.create_notifications_batch.return_value = 1
    dispatcher = MagicMock()
    dispatcher._hub_service = hub_service
    dispatcher.open_hub_connection.return_value.__enter__.return_value = object()
    dispatcher.open_hub_connection.return_value.__exit__.return_value = False
    dispatcher.upsert_push_outbox_jobs_batch.return_value = 1

    service = MagicMock()
    service._require_membership.return_value = conversation
    service._conversation_member_ids.return_value = member_ids
    service._notification_dispatcher = dispatcher

    orch = ChatNotificationOrchestrator(service)
    push_only = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type="chat.message_received",
        title="t",
        body="b",
        defer_push_notifications=True,
        create_hub_notifications=False,
        enqueue_push_outbox=True,
    )
    assert push_only["push_count"] == 1
    assert push_only["hub_count"] == 0
    hub_service.create_notifications_batch.assert_not_called()

    hub_only = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-2",
        event_type="chat.message_received",
        title="t",
        body="b",
        defer_push_notifications=True,
        create_hub_notifications=True,
        enqueue_push_outbox=False,
    )
    assert hub_only["hub_count"] == 1
    assert hub_only["push_count"] == 0
    assert dispatcher.upsert_push_outbox_jobs_batch.call_count == 1


def test_push_outbox_start_skips_when_disabled(monkeypatch):
    from backend.chat.push_outbox_service import ChatPushOutboxService

    service = ChatPushOutboxService()
    monkeypatch.setenv("CHAT_PUSH_OUTBOX_ENABLED", "0")
    # Reset cached property path by constructing fresh instance after env set.
    service = ChatPushOutboxService()
    assert service.enabled is False

    import asyncio

    asyncio.run(service.start())
    assert service._task is None
