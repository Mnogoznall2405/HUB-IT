"""Read-only mail office viewer: signed source delivery and disabled-config guards."""
from __future__ import annotations

import importlib
import sys
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_api_module = importlib.import_module("backend.api.v1.mail")
oo = importlib.import_module("backend.services.onlyoffice_service")
source_store_module = importlib.import_module("backend.services.mail_office_view_source_store")
auth_models_module = importlib.import_module("backend.models.auth")
auth_context_module = importlib.import_module("backend.services.request_auth_context_service")

SECRET = "test-mail-view-secret"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _user():
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


def _mail_dep_with_session(session_id: str = ""):
    if not session_id:
        return lambda: _user()

    async def _dep():
        token = auth_context_module.push_request_session_id(session_id)
        try:
            yield _user()
        finally:
            auth_context_module.pop_request_session_id(token)

    return _dep


def _client(session_id: str = "") -> TestClient:
    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_user] = _mail_dep_with_session(session_id)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _onlyoffice_env(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", SECRET)
    monkeypatch.setenv("ONLYOFFICE_INTERNAL_URL", "http://ds.internal:8080")
    monkeypatch.setenv("ONLYOFFICE_APP_BASE_URL", "https://hub.example")
    source_store_module.office_view_source_store._records.clear()
    source_store_module.office_view_source_store._total_bytes = 0


def _office_view(client: TestClient, **params):
    query = {"name": "memo.docx", "content_type": DOCX_MIME, **params}
    return client.get("/mail/messages/msg-1/attachments/att-1/office-view", params=query)


def _source_token(view_payload: dict) -> str:
    url = view_payload["config"]["document"]["url"]
    return url.split("t=", 1)[1]


def test_office_view_parks_attachment_and_source_serves_it_anonymously(monkeypatch):
    """primary_session creds live only in the request context: the attachment is
    fetched once under the user's session; the anonymous DS fetch needs none."""
    seen_session_ids = []
    calls = []

    def fake_download(**kwargs):
        calls.append(kwargs)
        seen_session_ids.append(auth_context_module.get_request_session_id())
        return ("memo.docx", DOCX_MIME, b"docx-bytes")

    monkeypatch.setattr(mail_api_module.mail_service, "download_attachment", fake_download)
    client = _client(session_id="sess-1")

    view = _office_view(client)
    assert view.status_code == 200, view.text
    payload = view.json()
    assert payload["config"]["document"]["permissions"]["edit"] is False
    token = _source_token(payload)

    # The Document Server request carries no cookies/session — only the token.
    source = client.get(f"/mail/office-source?t={token}")
    assert source.status_code == 200
    assert source.content == b"docx-bytes"
    assert source.headers["content-type"].startswith(DOCX_MIME)

    # Fetched exactly once — during the authenticated office-view call, with the
    # request session propagated into the mail executor (primary_session path).
    assert len(calls) == 1
    assert calls[0]["user_id"] == 100
    assert calls[0]["message_id"] == "msg-1"
    assert calls[0]["attachment_ref"] == "att-1"
    assert seen_session_ids == ["sess-1"]


def test_office_view_rejected_when_onlyoffice_disabled(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "0")
    client = _client()
    response = _office_view(client)
    assert response.status_code == 503


def test_office_view_rejected_with_empty_jwt_secret(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", "")
    client = _client()
    assert _office_view(client).status_code == 503


def test_office_source_rejected_when_onlyoffice_disabled(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "0")
    client = _client()
    assert client.get("/mail/office-source?t=anything").status_code == 503


def test_office_source_rejects_forged_token_without_touching_mail(monkeypatch):
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: pytest.fail("mail backend must not be reached"),
    )
    client = _client()
    forged = jwt.encode(
        {"typ": "mvsrc", "uid": 100, "mid": "msg-1", "ref": "att-1", "mbx": "", "exp": int(time.time()) + 600},
        "attacker-known-secret",
        algorithm="HS256",
    )
    assert client.get(f"/mail/office-source?t={forged}").status_code == 403
    assert client.get("/mail/office-source?t=not-a-jwt").status_code == 403


def test_office_source_valid_token_without_parked_entry_is_gone():
    client = _client()
    settings = oo.require_enabled()
    token = oo.make_mail_view_source_token(
        settings, user_id=100, message_id="msg-1", attachment_ref="att-1", mailbox_id=""
    )
    response = client.get(f"/mail/office-source?t={token}")
    assert response.status_code == 410


def test_office_source_rejects_token_for_another_attachment(monkeypatch):
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: ("memo.docx", DOCX_MIME, b"bytes-a"),
    )
    client = _client()
    view = _office_view(client)
    assert view.status_code == 200
    # A token minted for a different attachment has a different digest → miss.
    settings = oo.require_enabled()
    other = oo.make_mail_view_source_token(
        settings, user_id=100, message_id="msg-2", attachment_ref="att-9", mailbox_id=""
    )
    assert client.get(f"/mail/office-source?t={other}").status_code == 410
