from __future__ import annotations

import asyncio
import importlib
import sys
import threading
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_api_module = importlib.import_module("backend.api.v1.mail")
auth_models_module = importlib.import_module("backend.models.auth")


def _build_mail_user():
    return auth_models_module.User(
        id=100,
        username="mail-user",
        email="mail-user@example.com",
        full_name="Mail User",
        role="viewer",
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email="mail-user@example.com",
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=True,
    )


def _build_client():
    current_user = _build_mail_user()
    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_user] = lambda: current_user
    return TestClient(app)


def test_bootstrap_route_offloads_mail_call_and_logs_metrics(monkeypatch):
    client = _build_client()
    direct_call = {}
    helper_calls = []
    timing_calls = []

    def _direct(*args, **kwargs):
        direct_call["called"] = True
        raise AssertionError("bootstrap should not be called directly")

    async def _fake_run_mail_call_with_metrics(func, /, *args, **kwargs):
        helper_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return {"mailboxes": [], "messages": []}, {"cache_hit": True, "account_reused": False}

    def _fake_log_request_timing(route_name, request_id, started_at, **context):
        timing_calls.append({"route_name": route_name, "request_id": request_id, "context": context})

    monkeypatch.setattr(mail_api_module.mail_service, "get_bootstrap", _direct)
    monkeypatch.setattr(mail_api_module, "_run_mail_call_with_metrics", _fake_run_mail_call_with_metrics)
    monkeypatch.setattr(mail_api_module, "_log_request_timing", _fake_log_request_timing)

    response = client.get("/mail/bootstrap", params={"limit": 25, "mailbox_id": "mbox-1", "refresh": "live"})

    assert response.status_code == 200
    assert response.json() == {
        "mailboxes": [],
        "messages": [],
        "state": "ok",
        "source": "exchange",
        "as_of": None,
        "last_error": "",
    }
    assert direct_call == {}
    assert len(helper_calls) == 1
    assert helper_calls[0]["func"] is _direct
    assert helper_calls[0]["kwargs"]["user_id"] == 100
    assert helper_calls[0]["kwargs"]["mailbox_id"] == "mbox-1"
    assert helper_calls[0]["kwargs"]["limit"] == 25
    assert timing_calls[0]["route_name"] == "bootstrap"
    assert timing_calls[0]["context"]["cache_hit"] is True
    assert timing_calls[0]["context"]["account_reused"] is False


def test_bootstrap_auto_uses_only_fresh_shared_snapshot(monkeypatch):
    client = _build_client()
    monkeypatch.setenv("MAIL_SHARED_SNAPSHOT_READ_ENABLED", "1")
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "read",
        lambda **kwargs: {
            "state": "ok",
            "source": "app_snapshot",
            "payload": {"mailboxes": [], "messages": {"items": [{"id": "snapshot-msg"}]}},
            "as_of": "2026-07-14T16:00:00+00:00",
            "last_error": "",
        },
    )
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "get_bootstrap",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("Exchange must not be called for a fresh snapshot")),
    )

    response = client.get("/mail/bootstrap", params={"limit": 20, "mailbox_id": "mbox-1"})

    assert response.status_code == 200
    assert response.json()["state"] == "ok"
    assert response.json()["source"] == "app_snapshot"
    assert response.json()["messages"]["items"] == [{"id": "snapshot-msg"}]


def test_bootstrap_auto_refreshes_stale_shared_snapshot(monkeypatch):
    client = _build_client()
    helper_calls = []
    snapshot_writes = []
    monkeypatch.setenv("MAIL_SHARED_SNAPSHOT_READ_ENABLED", "1")
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "read",
        lambda **kwargs: {
            "state": "stale",
            "source": "app_snapshot",
            "payload": {"mailboxes": [], "messages": {"items": [{"id": "old-msg"}]}},
            "as_of": "2026-07-14T08:00:00+00:00",
            "last_error": "",
        },
    )

    async def _fake_run_mail_call_with_metrics(func, /, *args, **kwargs):
        helper_calls.append({"func": func, "kwargs": kwargs})
        return {
            "mailboxes": [],
            "messages": {"items": [{"id": "fresh-msg"}]},
        }, {"cache_hit": False}

    monkeypatch.setattr(mail_api_module, "_run_mail_call_with_metrics", _fake_run_mail_call_with_metrics)
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "write_success",
        lambda **kwargs: snapshot_writes.append(kwargs),
    )

    response = client.get("/mail/bootstrap", params={"limit": 20, "mailbox_id": "mbox-1"})

    assert response.status_code == 200
    assert response.json()["state"] == "ok"
    assert response.json()["source"] == "exchange"
    assert response.json()["messages"]["items"] == [{"id": "fresh-msg"}]
    assert len(helper_calls) == 1
    assert len(snapshot_writes) == 1
    assert snapshot_writes[0]["payload"]["messages"]["items"] == [{"id": "fresh-msg"}]


def test_get_message_route_offloads_mail_call_and_preserves_metrics(monkeypatch):
    client = _build_client()
    direct_call = {}
    helper_calls = []
    timing_calls = []

    def _direct(*args, **kwargs):
        direct_call["called"] = True
        raise AssertionError("get_message should not be called directly")

    async def _fake_run_mail_call_with_metrics(func, /, *args, **kwargs):
        helper_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return {"id": "msg-1", "subject": "Test"}, {"cache_hit": False, "account_reused": True}

    def _fake_log_request_timing(route_name, request_id, started_at, **context):
        timing_calls.append({"route_name": route_name, "request_id": request_id, "context": context})

    monkeypatch.setattr(mail_api_module.mail_service, "get_message", _direct)
    monkeypatch.setattr(mail_api_module, "_run_mail_call_with_metrics", _fake_run_mail_call_with_metrics)
    monkeypatch.setattr(mail_api_module, "_log_request_timing", _fake_log_request_timing)

    response = client.get("/mail/messages/msg-1", params={"mailbox_id": "mbox-2"})

    assert response.status_code == 200
    assert response.json() == {"id": "msg-1", "subject": "Test"}
    assert direct_call == {}
    assert len(helper_calls) == 1
    assert helper_calls[0]["func"] is _direct
    assert helper_calls[0]["kwargs"]["user_id"] == 100
    assert helper_calls[0]["kwargs"]["mailbox_id"] == "mbox-2"
    assert helper_calls[0]["kwargs"]["message_id"] == "msg-1"
    assert timing_calls[0]["route_name"] == "get_message"
    assert timing_calls[0]["context"]["cache_hit"] is False
    assert timing_calls[0]["context"]["account_reused"] is True


def test_mark_message_read_writes_through_shared_unread_snapshot(monkeypatch):
    client = _build_client()
    snapshot_updates = []

    async def _fake_run_mail_call(func, /, *args, **kwargs):
        return True

    monkeypatch.setattr(mail_api_module, "_run_mail_call", _fake_run_mail_call)
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "apply_read_state",
        lambda **kwargs: snapshot_updates.append(kwargs),
    )

    response = client.post("/mail/messages/msg-1/read", params={"mailbox_id": "mbox-1"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert snapshot_updates == [
        {
            "user_id": 100,
            "mailbox_id": "mbox-1",
            "unread_delta": -1,
            "is_read": True,
            "message_id": "msg-1",
            "folder": "inbox",
        }
    ]


def test_get_mailboxes_route_uses_metrics_boundary_and_include_unread(monkeypatch):
    client = _build_client()
    direct_call = {}
    helper_calls = []
    timing_calls = []

    def _direct(*args, **kwargs):
        direct_call["called"] = True
        raise AssertionError("list_user_mailboxes should not be called directly")

    async def _fake_run_mail_call_with_metrics(func, /, *args, **kwargs):
        helper_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return [{"id": "mbox-1"}], {"mailbox_unread_deferred": 2}

    def _fake_log_request_timing(route_name, request_id, started_at, **context):
        timing_calls.append({"route_name": route_name, "request_id": request_id, "context": context})

    monkeypatch.setattr(mail_api_module.mail_service, "list_user_mailboxes", _direct)
    monkeypatch.setattr(mail_api_module, "_run_mail_call_with_metrics", _fake_run_mail_call_with_metrics)
    monkeypatch.setattr(mail_api_module, "_log_request_timing", _fake_log_request_timing)

    response = client.get("/mail/mailboxes", params={"include_unread": "true"})

    assert response.status_code == 200
    assert response.json() == {"items": [{"id": "mbox-1"}]}
    assert direct_call == {}
    assert len(helper_calls) == 1
    assert helper_calls[0]["func"] is _direct
    assert helper_calls[0]["kwargs"]["user_id"] == 100
    assert helper_calls[0]["kwargs"]["include_inactive"] is True
    assert helper_calls[0]["kwargs"]["include_unread"] is True
    assert timing_calls[0]["route_name"] == "mailboxes"
    assert timing_calls[0]["context"]["include_unread"] == 1
    assert timing_calls[0]["context"]["mailbox_unread_deferred"] == 2


def test_unread_route_reads_shared_snapshot_without_exchange(monkeypatch):
    client = _build_client()
    monkeypatch.setenv("MAIL_SHARED_SNAPSHOT_READ_ENABLED", "1")
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "read",
        lambda **kwargs: {
            "state": "stale",
            "source": "app_snapshot",
            "payload": {"unread_count": 9},
            "as_of": "2026-07-14T08:00:00+00:00",
            "last_error": "",
        },
    )
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "get_unread_count",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("Exchange must not be called")),
    )

    response = client.get("/mail/unread-count")

    assert response.status_code == 200
    assert response.json()["unread_count"] == 9
    assert response.json()["state"] == "stale"
    assert response.json()["source"] == "app_snapshot"


def test_mail_preferences_accept_persisted_pane_sizes(monkeypatch):
    client = _build_client()
    captured = {}
    snapshot_updates = []

    async def _fake_run_mail_call(func, /, *args, **kwargs):
        captured.update(kwargs)
        return kwargs["payload"]

    monkeypatch.setattr(mail_api_module, "_run_mail_call", _fake_run_mail_call)
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service,
        "apply_preferences",
        lambda **kwargs: snapshot_updates.append(kwargs),
    )

    response = client.patch(
        "/mail/preferences",
        json={
            "folder_pane_width": 250,
            "message_list_width": 420,
            "bottom_list_percent": 47,
        },
    )

    assert response.status_code == 200
    assert captured["payload"] == {
        "folder_pane_width": 250,
        "message_list_width": 420,
        "bottom_list_percent": 47,
    }
    assert snapshot_updates == [{
        "user_id": 100,
        "preferences": captured["payload"],
    }]


def test_send_message_route_uses_async_boundary(monkeypatch):
    client = _build_client()
    direct_call = {}
    helper_calls = []

    def _direct(*args, **kwargs):
        direct_call["called"] = True
        raise AssertionError("send_message should not be called directly")

    async def _fake_run_mail_call(func, /, *args, **kwargs):
        helper_calls.append({"func": func, "args": args, "kwargs": kwargs})
        return {"ok": True, "message_id": "sent-1"}

    monkeypatch.setattr(mail_api_module.mail_service, "send_message", _direct)
    monkeypatch.setattr(mail_api_module, "_run_mail_call", _fake_run_mail_call)

    response = client.post(
        "/mail/messages/send",
        json={
            "from_mailbox_id": "mbox-3",
            "to": ["user@example.com"],
            "cc": [],
            "bcc": [],
            "subject": "Hello",
            "body": "<p>Body</p>",
            "is_html": True,
            "reply_to_message_id": "",
            "forward_message_id": "",
            "draft_id": "",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "message_id": "sent-1"}
    assert direct_call == {}
    assert len(helper_calls) == 1
    assert helper_calls[0]["func"] is _direct
    assert helper_calls[0]["kwargs"]["user_id"] == 100
    assert helper_calls[0]["kwargs"]["mailbox_id"] == "mbox-3"
    assert helper_calls[0]["kwargs"]["to"] == ["user@example.com"]
    assert helper_calls[0]["kwargs"]["subject"] == "Hello"


def test_mail_async_boundary_limits_parallel_thread_calls(monkeypatch):
    monkeypatch.setenv("MAIL_EXCHANGE_MAX_CONCURRENCY", "2")
    mail_api_module._MAIL_CALL_LIMITER = None
    mail_api_module._MAIL_CALL_LIMITER_LIMIT = 0
    mail_api_module._MAIL_CALL_LIMITER_LOOP = None

    active = 0
    max_active = 0
    lock = threading.Lock()

    def _slow_call(index):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.05)
            return index
        finally:
            with lock:
                active -= 1

    async def _run_calls():
        return await asyncio.gather(*(mail_api_module._run_mail_call(_slow_call, index) for index in range(5)))

    try:
        assert asyncio.run(_run_calls()) == [0, 1, 2, 3, 4]
        assert max_active <= 2
    finally:
        mail_api_module._MAIL_CALL_LIMITER = None
        mail_api_module._MAIL_CALL_LIMITER_LIMIT = 0
        mail_api_module._MAIL_CALL_LIMITER_LOOP = None
