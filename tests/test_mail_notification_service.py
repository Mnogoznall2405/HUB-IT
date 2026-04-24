from __future__ import annotations

import asyncio
import importlib
import logging
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

notification_module = importlib.import_module("backend.services.mail_notification_service")


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

    assert thread_calls == ["_candidates", "_feed_sync"]
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
    feeds = iter([_feed("msg-1", 1), _feed("msg-2", 2, subject="New subject")])

    def _candidates():
        return [_candidate(2, session_id="sess-2")]

    def _feed_sync(*, user_id: int, session_id: str | None):
        assert user_id == 2
        assert session_id == "sess-2"
        return next(feeds)

    def _send_sync(**kwargs):
        send_calls.append(kwargs)

    async def _fake_to_thread(func, /, *args, **kwargs):
        thread_calls.append(getattr(func, "__name__", repr(func)))
        return func(*args, **kwargs)

    monkeypatch.setattr(service, "_iter_candidate_users", _candidates)
    monkeypatch.setattr(service, "_list_notification_feed_sync", _feed_sync)
    monkeypatch.setattr(service, "_send_notification_sync", _send_sync)
    monkeypatch.setattr(notification_module.asyncio, "to_thread", _fake_to_thread)

    await service.poll_once()
    await service.poll_once()

    assert send_calls and len(send_calls) == 1
    assert send_calls[0]["recipient_user_id"] == 2
    assert send_calls[0]["title"] == "New subject"
    assert send_calls[0]["tag"] == "mail:msg-2"
    assert send_calls[0]["route"].endswith("message=msg-2&mailbox_id=mbox-1")
    assert thread_calls.count("_send_sync") == 1


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
