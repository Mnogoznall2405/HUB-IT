from __future__ import annotations

import importlib
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")
mail_api_module = importlib.import_module("backend.api.v1.mail")
auth_models_module = importlib.import_module("backend.models.auth")


class FakeItem:
    def __init__(self, *, item_id: str, conversation_key: str, is_read: bool):
        self.id = item_id
        self.conversation_key = conversation_key
        self.is_read = is_read
        self.datetime_received = datetime(2026, 3, 30, 12, 0, tzinfo=timezone.utc)

    def save(self, update_fields=None):
        return None


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


def test_mail_service_marks_conversation_read_and_unread(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=f"sqlite:///{(Path(temp_dir) / 'mail_read_state.db').as_posix()}")
    items = [
        FakeItem(item_id="msg-1", conversation_key="conv-1", is_read=False),
        FakeItem(item_id="msg-2", conversation_key="conv-1", is_read=False),
    ]

    monkeypatch.setattr(service, "_resolve_user_mail_profile", lambda user_id, require_password=True: {
        "email": "user@example.com",
        "login": "user@example.com",
        "password": "secret",
    })
    monkeypatch.setattr(service, "_create_account", lambda **kwargs: object())
    monkeypatch.setattr(service, "_search_target_folders", lambda account, folder="inbox", folder_scope="current": [(object(), "inbox")])
    monkeypatch.setattr(service, "_folder_queryset", lambda folder_obj, folder_key: items)
    monkeypatch.setattr(service, "_item_conversation_key", lambda item: item.conversation_key)

    read_result = service.mark_conversation_as_read(
        user_id=7,
        conversation_id="conv-1",
        folder="inbox",
        folder_scope="current",
    )
    assert read_result["ok"] is True
    assert read_result["changed"] == 2
    assert all(item.is_read is True for item in items)

    unread_result = service.mark_conversation_as_unread(
        user_id=7,
        conversation_id="conv-1",
        folder="inbox",
        folder_scope="current",
    )
    assert unread_result["ok"] is True
    assert unread_result["changed"] == 2
    assert all(item.is_read is False for item in items)


def test_mail_conversation_read_routes_delegate_to_service(monkeypatch):
    current_user = _build_mail_user()
    called = {}

    def _mark_read(**kwargs):
        called["read"] = kwargs
        return {"ok": True, "changed": 2}

    def _mark_unread(**kwargs):
        called["unread"] = kwargs
        return {"ok": True, "changed": 2}

    monkeypatch.setattr(mail_api_module.mail_service, "mark_conversation_as_read", _mark_read)
    monkeypatch.setattr(mail_api_module.mail_service, "mark_conversation_as_unread", _mark_unread)

    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_user] = lambda: current_user
    client = TestClient(app)

    read_response = client.post("/mail/conversations/conv-1/read", json={"folder": "inbox", "folder_scope": "current"})
    unread_response = client.post("/mail/conversations/conv-1/unread", json={"folder": "archive", "folder_scope": "all"})

    assert read_response.status_code == 200
    assert unread_response.status_code == 200
    assert called["read"] == {
        "user_id": 100,
        "conversation_id": "conv-1",
        "folder": "inbox",
        "folder_scope": "current",
    }
    assert called["unread"] == {
        "user_id": 100,
        "conversation_id": "conv-1",
        "folder": "archive",
        "folder_scope": "all",
    }
