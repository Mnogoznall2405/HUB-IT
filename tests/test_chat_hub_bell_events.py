"""Variant A hybrid: ordinary chat hub notifications vs important bell events."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest


def test_classification_constants_are_disjoint():
    from backend.chat.hub_bell_events import (
        HUB_BELL_CHAT_EVENT_TYPES,
        ORDINARY_CHAT_HUB_EVENT_TYPES,
    )

    assert HUB_BELL_CHAT_EVENT_TYPES.isdisjoint(ORDINARY_CHAT_HUB_EVENT_TYPES)
    assert "chat.mention" in HUB_BELL_CHAT_EVENT_TYPES
    assert "chat.message_received" in ORDINARY_CHAT_HUB_EVENT_TYPES
    # Not implemented yet — must not be allow-listed without producers.
    assert "chat.member_added" not in HUB_BELL_CHAT_EVENT_TYPES
    assert "chat.direct_reply" not in HUB_BELL_CHAT_EVENT_TYPES


def test_should_create_hub_respects_write_flag_only():
    from backend.chat.hub_bell_events import should_create_hub_bell_notification

    assert should_create_hub_bell_notification("chat.mention", ordinary_write_enabled=False) is True
    assert should_create_hub_bell_notification("chat.message_received", ordinary_write_enabled=False) is False
    assert should_create_hub_bell_notification("chat.file_shared", ordinary_write_enabled=False) is False
    assert should_create_hub_bell_notification("chat.task_shared", ordinary_write_enabled=False) is False
    assert should_create_hub_bell_notification("chat.message_forwarded", ordinary_write_enabled=False) is False
    assert should_create_hub_bell_notification("chat.message_received", ordinary_write_enabled=True) is True
    assert should_create_hub_bell_notification("chat.unknown_event", ordinary_write_enabled=True) is False


def test_default_mark_read_always_includes_ordinary_and_mention():
    from backend.chat.hub_bell_events import default_mark_chat_notification_event_types

    types = default_mark_chat_notification_event_types(ordinary_write_enabled=False)
    assert "chat.mention" in types
    assert "chat.message_received" in types
    assert "chat.file_shared" in types


def test_write_and_read_flags_are_independent(monkeypatch):
    from backend.chat import hub_bell_events as events

    monkeypatch.setattr(events, "hub_ordinary_write_enabled", lambda: True)
    monkeypatch.setattr(events, "hub_ordinary_read_visible", lambda: False)
    assert events.hub_ordinary_write_enabled() is True
    assert events.hub_ordinary_read_visible() is False
    assert events.should_create_hub_bell_notification("chat.message_received") is True

    snapshot = {
        "ordinary_write_enabled": True,
        "ordinary_read_visible": False,
        "source": "env",
        "important_event_types": ["chat.mention"],
        "ordinary_event_types": sorted(events.ORDINARY_CHAT_HUB_EVENT_TYPES),
    }
    monkeypatch.setattr(events, "hub_ordinary_flags_snapshot", lambda: snapshot)
    assert events.hub_ordinary_flags_snapshot()["ordinary_read_visible"] is False


def _patch_orchestrator_deps(monkeypatch, *, mentioned=False):
    from backend.chat import chat_notification_orchestrator as orch_mod

    member_ids = [1, 2]
    states = [
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

    plan = SimpleNamespace(
        recipient_user_id=2,
        is_mentioned=mentioned,
        event_type="chat.mention" if mentioned else "chat.message_received",
        title="Author",
        body="[Вас упомянули] hello" if mentioned else "hello",
    )
    monkeypatch.setattr(orch_mod, "chat_session", lambda: _Session())
    monkeypatch.setattr(
        orch_mod,
        "build_chat_notification_recipient_plans",
        lambda **kwargs: [plan],
    )
    monkeypatch.setattr(
        orch_mod.user_service,
        "get_users_map_by_ids",
        lambda ids: {1: {"full_name": "Author", "username": "author"}},
    )
    return conversation, member_ids


def _disable_ordinary_write(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_write_enabled",
        lambda: False,
    )
    monkeypatch.setattr(
        "backend.chat.latency_profile.hub_ordinary_write_enabled",
        lambda: False,
    )
    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_notifications_enabled",
        lambda: False,
    )
    monkeypatch.setattr(
        "backend.chat.latency_profile.hub_ordinary_notifications_enabled",
        lambda: False,
    )


def test_ordinary_message_creates_zero_hub_rows_when_write_disabled(monkeypatch):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    _disable_ordinary_write(monkeypatch)

    conversation, member_ids = _patch_orchestrator_deps(monkeypatch, mentioned=False)
    hub_service = MagicMock()
    hub_service.create_notifications_batch.return_value = 0
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
    stats = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body="hello",
        defer_push_notifications=True,
        create_hub_notifications=True,
        enqueue_push_outbox=True,
    )

    assert stats["push_count"] == 1
    assert stats["hub_count"] == 0
    assert stats["ordinary_hub_rows_created"] == 0
    assert stats["ordinary_hub_rows_skipped"] == 1
    hub_service.create_notifications_batch.assert_not_called()


def test_mention_creates_important_hub_row_when_write_disabled(monkeypatch):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    _disable_ordinary_write(monkeypatch)

    conversation, member_ids = _patch_orchestrator_deps(monkeypatch, mentioned=True)
    hub_service = MagicMock()
    hub_service.create_notifications_batch.side_effect = lambda rows, conn=None: len(rows)
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
    stats = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body="hello @user",
        mentioned_user_ids=[2],
        defer_push_notifications=True,
    )

    assert stats["push_count"] == 1
    assert stats["hub_count"] == 1
    assert stats["important_hub_rows_created"] == 1
    assert stats["ordinary_hub_rows_created"] == 0
    rows = hub_service.create_notifications_batch.call_args.args[0]
    assert rows[0]["event_type"] == "chat.mention"


@pytest.mark.parametrize(
    "event_type",
    ["chat.file_shared", "chat.task_shared", "chat.message_forwarded"],
)
def test_ordinary_share_events_skip_hub_when_write_disabled(monkeypatch, event_type):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    _disable_ordinary_write(monkeypatch)

    conversation, member_ids = _patch_orchestrator_deps(monkeypatch, mentioned=False)
    from backend.chat import chat_notification_orchestrator as orch_mod

    monkeypatch.setattr(
        orch_mod,
        "build_chat_notification_recipient_plans",
        lambda **kwargs: [
            SimpleNamespace(
                recipient_user_id=2,
                is_mentioned=False,
                event_type=event_type,
                title="Author",
                body="shared",
            )
        ],
    )

    hub_service = MagicMock()
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
    stats = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type=event_type,
        title="t",
        body="b",
        defer_push_notifications=True,
    )
    assert stats["hub_count"] == 0
    assert stats["push_count"] == 1
    hub_service.create_notifications_batch.assert_not_called()


def test_feature_flag_true_keeps_legacy_ordinary_hub_rows(monkeypatch):
    from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator

    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_write_enabled",
        lambda: True,
    )
    monkeypatch.setattr(
        "backend.chat.latency_profile.hub_ordinary_write_enabled",
        lambda: True,
    )

    conversation, member_ids = _patch_orchestrator_deps(monkeypatch, mentioned=False)
    hub_service = MagicMock()
    hub_service.create_notifications_batch.side_effect = lambda rows, conn=None: len(rows)
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
    stats = orch._create_chat_notifications(
        sender_user_id=1,
        conversation_id="conv-1",
        message_id="msg-1",
        event_type="chat.message_received",
        title="t",
        body="b",
        defer_push_notifications=True,
    )
    assert stats["hub_count"] == 1
    assert stats["ordinary_hub_rows_created"] == 1
    assert stats["push_count"] == 1


def test_read_visible_false_builds_exclusion_sql(monkeypatch):
    from backend.services.hub_service import HubService

    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_read_visible",
        lambda: False,
    )
    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_write_enabled",
        lambda: True,
    )

    hub = HubService.__new__(HubService)
    clause, params = hub._legacy_ordinary_chat_hub_exclusion_sql()
    assert "chat.message_received" in params
    assert "IN (" in clause.upper()

    monkeypatch.setattr(
        "backend.chat.hub_bell_events.hub_ordinary_read_visible",
        lambda: True,
    )
    clause_on, params_on = hub._legacy_ordinary_chat_hub_exclusion_sql()
    assert clause_on == ""
    assert params_on == []


def test_flags_file_ignores_partial_json(tmp_path, monkeypatch):
    from backend.chat import latency_profile as lp

    flags_path = tmp_path / "chat-profile-flags.json"
    flags_path.write_text('{"CHAT_HUB_ORDINARY_WRITE_ENABLED": false}', encoding="utf-8")
    monkeypatch.setattr(lp, "_FLAGS_FILE", flags_path)
    lp._FLAGS_CACHE.update(
        {
            "mtime": None,
            "data": {},
            "checked_at": 0.0,
            "source": "env",
            "last_ordinary_snapshot": None,
        }
    )

    assert lp.hub_ordinary_write_enabled() is False

    # Partial / invalid JSON must keep previous good snapshot.
    flags_path.write_text('{"CHAT_HUB_ORDINARY_WRITE_ENABLED":', encoding="utf-8")
    lp._FLAGS_CACHE["checked_at"] = 0.0
    lp._FLAGS_CACHE["mtime"] = None
    assert lp.hub_ordinary_write_enabled() is False

    # Do not leak file-flag cache into subsequent tests.
    lp._FLAGS_CACHE.update(
        {
            "mtime": None,
            "data": {},
            "checked_at": 0.0,
            "source": "env",
            "last_ordinary_snapshot": None,
        }
    )
