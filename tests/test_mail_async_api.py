from __future__ import annotations

import importlib
import sys
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

    response = client.get("/mail/bootstrap", params={"limit": 25, "mailbox_id": "mbox-1"})

    assert response.status_code == 200
    assert response.json() == {"mailboxes": [], "messages": []}
    assert direct_call == {}
    assert len(helper_calls) == 1
    assert helper_calls[0]["func"] is _direct
    assert helper_calls[0]["kwargs"]["user_id"] == 100
    assert helper_calls[0]["kwargs"]["mailbox_id"] == "mbox-1"
    assert helper_calls[0]["kwargs"]["limit"] == 25
    assert timing_calls[0]["route_name"] == "bootstrap"
    assert timing_calls[0]["context"]["cache_hit"] is True
    assert timing_calls[0]["context"]["account_reused"] is False


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
