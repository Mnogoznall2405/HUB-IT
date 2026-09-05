from __future__ import annotations

import asyncio
import importlib
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

notification_module = importlib.import_module("backend.services.mail_notification_service")


@pytest.fixture(autouse=True)
def isolate_shared_snapshot_store(monkeypatch):
    def read_notification_feeds(*, user_ids):
        return {}

    def persist_notification_results(**_kwargs):
        return None

    def persist_notification_checkpoints(**_kwargs):
        return None

    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "read_notification_feeds",
        read_notification_feeds,
    )
    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "persist_notification_results",
        persist_notification_results,
    )
    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "persist_notification_checkpoints",
        persist_notification_checkpoints,
    )


def _candidate(user_id: int, *, session_id: str | None = None) -> dict:
    payload = {
        "user": {
            "id": user_id,
            "role": "viewer",
            "is_active": True,
            "use_custom_permissions": False,
            "custom_permissions": [],
            "auth_source": "local",
        },
        "session_context": {},
    }
    if session_id:
        payload["session_context"] = {"session_id": session_id}
    return payload


def _feed(message_id: str, unread_count: int, *, subject: str = "Subject", sender: str = "Sender") -> dict:
    return {
        "total_unread": unread_count,
        "items": [
            {
                "id": message_id,
                "received_at": f"2026-04-16T21:57:{unread_count:02d}Z",
                "subject": subject,
                "sender": sender,
                "body_preview": f"preview-{message_id}",
                "mailbox_id": "mbox-1",
                "mailbox_label": "Primary",
                "mailbox_email": "mail@example.com",
                "folder": "inbox",
            }
        ],
    }


def test_should_emit_when_latest_message_changes_without_unread_growth():
    service = notification_module.MailNotificationService()

    assert service._should_emit(
        previous=notification_module.MailNotificationSnapshot(
            unread_count=2,
            last_message_id="msg-1",
            last_received_at="2026-06-09T08:00:00Z",
        ),
        current=notification_module.MailNotificationSnapshot(
            unread_count=2,
            last_message_id="msg-2",
            last_received_at="2026-06-09T08:01:00Z",
        ),
    )


def test_snapshot_ttl_exceeds_poll_interval_by_default(monkeypatch):
    service = notification_module.MailNotificationService()
    monkeypatch.setenv("MAIL_NOTIFICATION_POLL_INTERVAL_SEC", "90")
    monkeypatch.delenv("MAIL_NOTIFICATION_SNAPSHOT_TTL_SEC", raising=False)

    assert service.poll_interval_sec == 90
    assert service.snapshot_ttl_sec == 180
    assert service.snapshot_ttl_sec > service.poll_interval_sec


def test_snapshot_ttl_env_override_respects_minimum_slack(monkeypatch):
    service = notification_module.MailNotificationService()
    monkeypatch.setenv("MAIL_NOTIFICATION_POLL_INTERVAL_SEC", "90")
    monkeypatch.setenv("MAIL_NOTIFICATION_SNAPSHOT_TTL_SEC", "100")

    assert service.snapshot_ttl_sec == 120


@pytest.mark.asyncio
async def test_poll_once_persists_snapshots_with_snapshot_ttl(monkeypatch):
    service = notification_module.MailNotificationService()
    persist_kwargs = {}

    def _candidates():
        return [_candidate(11, session_id="sess-11")]

    def _feed_sync(*, user_id: int, session_id: str | None):
        return _feed("msg-11", 1)

    def _persist(*, results, ttl_seconds):
        persist_kwargs["results"] = results
        persist_kwargs["ttl_seconds"] = ttl_seconds

    async def _fake_to_thread(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setenv("MAIL_NOTIFICATION_POLL_INTERVAL_SEC", "90")
    monkeypatch.delenv("MAIL_NOTIFICATION_SNAPSHOT_TTL_SEC", raising=False)
    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "persist_notification_results",
        _persist,
    )
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()

    assert persist_kwargs["ttl_seconds"] == service.snapshot_ttl_sec
    assert persist_kwargs["ttl_seconds"] == 180


@pytest.mark.asyncio
async def test_poll_once_offloads_candidate_discovery_and_first_snapshot_does_not_notify(monkeypatch, caplog):
    service = notification_module.MailNotificationService()
    thread_calls = []
    send_calls = []

    def _candidates():
        return [_candidate(1, session_id="sess-1")]

    def _feed_sync(*, user_id: int, session_id: str | None):
        assert user_id == 1
        assert session_id == "sess-1"
        return _feed("msg-1", 1)

    def _send_sync(**kwargs):
        send_calls.append(kwargs)

    async def _fake_to_thread(func, /, *args, **kwargs):
        thread_calls.append(getattr(func, "__name__", repr(func)))
        return func(*args, **kwargs)

    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)
    caplog.set_level(logging.INFO)

    await service.poll_once()

    assert thread_calls[:2] == ["_candidates", "_feed_sync"]
    assert thread_calls.count("persist_notification_results") == 1
    assert send_calls == []
    assert service._snapshots[1].last_message_id == "msg-1"
    assert "candidate_count=1" in caplog.text
    assert "fetched_count=1" in caplog.text
    assert "notified_count=0" in caplog.text


@pytest.mark.asyncio
async def test_poll_once_emits_notification_on_unread_increase_and_offloads_push(monkeypatch):
    service = notification_module.MailNotificationService()
    thread_calls = []
    send_calls = []
    realtime_calls = []
    feeds = iter([_feed("msg-1", 1), _feed("msg-2", 2, subject="New subject")])

    def _candidates():
        return [_candidate(2, session_id="sess-2")]

    def _feed_sync(*, user_id: int, session_id: str | None):
        assert user_id == 2
        assert session_id == "sess-2"
        return next(feeds)

    def _send_sync(**kwargs):
        send_calls.append(kwargs)
        return SimpleNamespace(sent=1, failed=0, disabled=0)

    async def _fake_to_thread(func, /, *args, **kwargs):
        thread_calls.append(getattr(func, "__name__", repr(func)))
        return func(*args, **kwargs)

    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(
        notification_module.hub_realtime_publisher,
        "publish_user_event",
        lambda **kwargs: realtime_calls.append(kwargs) or True,
    )
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()
    await service.poll_once()

    assert send_calls and len(send_calls) == 1
    assert send_calls[0]["recipient_user_id"] == 2
    assert send_calls[0]["title"] == "New subject"
    assert send_calls[0]["tag"] == "mail:msg-2"
    assert send_calls[0]["route"].endswith("message=msg-2&mailbox_id=mbox-1")
    assert thread_calls.count("_send_sync") == 1
    assert realtime_calls == [{
        "recipient_user_id": 2,
        "event_type": "mail.message.received",
        "event_id": realtime_calls[0]["event_id"],
        "payload": {
            "message_id": "msg-2",
            "mailbox_id": "mbox-1",
            "folder": "inbox",
            "received_at": "2026-04-16T21:57:02Z",
            "unread_count": 2,
        },
    }]
    assert realtime_calls[0]["event_id"].startswith("mail-received:2:")


@pytest.mark.asyncio
async def test_poll_once_retries_same_mail_when_push_delivery_fully_fails(monkeypatch):
    service = notification_module.MailNotificationService()
    send_calls = []
    feeds = iter([
        _feed("msg-1", 1),
        _feed("msg-2", 2, subject="Retry subject"),
        _feed("msg-2", 2, subject="Retry subject"),
    ])

    def _candidates():
        return [_candidate(7, session_id="sess-7")]

    def _feed_sync(*, user_id: int, session_id: str | None):
        assert user_id == 7
        assert session_id == "sess-7"
        return next(feeds)

    def _send_sync(**kwargs):
        send_calls.append(kwargs)
        return SimpleNamespace(sent=0, failed=1, disabled=0)

    async def _fake_to_thread(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()
    await service.poll_once()
    await service.poll_once()

    assert [item["tag"] for item in send_calls] == ["mail:msg-2", "mail:msg-2"]
    assert service._snapshots[7].last_message_id == "msg-1"


@pytest.mark.asyncio
async def test_poll_once_retries_when_no_push_subscription_received_the_mail(monkeypatch):
    service = notification_module.MailNotificationService()
    send_calls = []
    checkpoint_writes = []
    feeds = iter([
        _feed("msg-1", 1),
        _feed("msg-2", 2, subject="Waiting for subscription"),
        _feed("msg-2", 2, subject="Waiting for subscription"),
    ])

    monkeypatch.setattr(service, "_iter_candidate_users", lambda: [_candidate(9)])
    monkeypatch.setattr(
        service,
        "_list_notification_feed_sync",
        lambda **_kwargs: next(feeds),
    )

    def _send_sync(**kwargs):
        send_calls.append(kwargs)
        return SimpleNamespace(sent=0, failed=0, disabled=0)

    async def _fake_to_thread(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "persist_notification_checkpoints",
        lambda *, feeds_by_user_id: checkpoint_writes.append(dict(feeds_by_user_id)),
    )
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()
    await service.poll_once()
    await service.poll_once()

    assert [item["tag"] for item in send_calls] == ["mail:msg-2", "mail:msg-2"]
    assert service._snapshots[9].last_message_id == "msg-1"
    assert [feed[9]["items"][0]["id"] for feed in checkpoint_writes] == ["msg-1"]


def test_should_emit_when_newest_message_was_read_before_poll():
    service = notification_module.MailNotificationService()

    assert service._should_emit(
        previous=notification_module.MailNotificationSnapshot(
            unread_count=0,
            last_message_id="msg-1",
            last_received_at="2026-07-23T05:20:00Z",
        ),
        current=notification_module.MailNotificationSnapshot(
            unread_count=0,
            last_message_id="msg-2",
            last_received_at="2026-07-23T05:24:01Z",
        ),
    )


def test_should_not_emit_old_read_mail_when_upgrading_empty_legacy_checkpoint():
    service = notification_module.MailNotificationService()

    assert not service._should_emit(
        previous=notification_module.MailNotificationSnapshot(
            unread_count=0,
            last_message_id="",
            last_received_at="",
        ),
        current=notification_module.MailNotificationSnapshot(
            unread_count=0,
            last_message_id="existing-read-message",
            last_received_at="2026-07-23T05:24:01Z",
        ),
    )


def test_should_not_emit_when_reading_latest_reveals_an_older_message():
    service = notification_module.MailNotificationService()

    assert not service._should_emit(
        previous=notification_module.MailNotificationSnapshot(
            unread_count=2,
            last_message_id="newest-message",
            last_received_at="2026-07-23T05:24:01Z",
        ),
        current=notification_module.MailNotificationSnapshot(
            unread_count=1,
            last_message_id="older-message",
            last_received_at="2026-07-23T05:20:00Z",
        ),
    )


def test_worker_notification_feed_includes_read_messages(monkeypatch):
    service = notification_module.MailNotificationService()
    calls = []

    def _list_notification_feed(**kwargs):
        calls.append(kwargs)
        return {"total_unread": 0, "items": []}

    monkeypatch.setattr(notification_module.mail_service, "list_notification_feed", _list_notification_feed)

    assert service._list_notification_feed_sync(user_id=38, session_id=None) == {
        "total_unread": 0,
        "items": [],
    }
    assert calls == [{"user_id": 38, "limit": 5, "unread_only": False}]


@pytest.mark.asyncio
async def test_poll_once_restores_persisted_baseline_after_worker_restart(monkeypatch):
    service = notification_module.MailNotificationService()
    send_calls = []

    monkeypatch.setattr(service, "_iter_candidate_users", lambda: [_candidate(12)])
    monkeypatch.setattr(
        service,
        "_list_notification_feed_sync",
        lambda **_kwargs: _feed("msg-2", 2, subject="Arrived while worker restarted"),
    )
    monkeypatch.setattr(
        notification_module.mail_runtime_snapshot_service,
        "read_notification_feeds",
        lambda *, user_ids: {12: _feed("msg-1", 1)},
        raising=False,
    )
    monkeypatch.setattr(
        service,
        "_send_notification_sync",
        lambda **kwargs: send_calls.append(kwargs) or SimpleNamespace(sent=1, failed=0, disabled=0),
    )

    async def _fake_to_thread(func, /, *args, **kwargs):
        return func(*args, **kwargs)

    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()

    assert [item["tag"] for item in send_calls] == ["mail:msg-2"]



@pytest.mark.asyncio
async def test_poll_once_limits_concurrency_and_isolates_user_failures(monkeypatch, caplog):
    service = notification_module.MailNotificationService()
    thread_calls = []
    send_calls = []
    active = 0
    max_active = 0

    def _candidates():
        return [_candidate(1), _candidate(2), _candidate(3), _candidate(4), _candidate(5)]

    def _feed_sync(*, user_id: int, session_id: str | None):
        if user_id == 3:
            raise notification_module.MailServiceError("boom")
        return _feed(f"msg-{user_id}", 1)

    def _send_sync(**kwargs):
        send_calls.append(kwargs)

    async def _fake_to_thread(func, /, *args, **kwargs):
        nonlocal active, max_active
        name = getattr(func, "__name__", repr(func))
        thread_calls.append(name)
        if name == "_feed_sync":
            active += 1
            max_active = max(max_active, active)
            try:
                await asyncio.sleep(0.01)
                return func(*args, **kwargs)
            finally:
                active -= 1
        return func(*args, **kwargs)

    monkeypatch.setenv("MAIL_NOTIFICATION_MAX_CONCURRENCY", "2")
    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)
    caplog.set_level(logging.INFO)

    await service.poll_once()

    assert max_active == 2
    assert service._snapshots.keys() == {1, 2, 4, 5}
    assert 3 not in service._snapshots
    assert send_calls == []
    assert "error_count=1" in caplog.text
    assert thread_calls.count("_feed_sync") == 5
