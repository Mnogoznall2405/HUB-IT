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
def _onlyoffice_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", SECRET)
    monkeypatch.setenv("ONLYOFFICE_INTERNAL_URL", "http://ds.internal:8080")
    monkeypatch.setenv("ONLYOFFICE_APP_BASE_URL", "https://hub.example")
    monkeypatch.setattr(
        source_store_module.office_view_source_store, "_root", tmp_path / "mvsrc"
    )


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


def test_source_survives_second_backend_process_and_restart(monkeypatch, tmp_path):
    """office-view on process A parks bytes on shared disk; a *separate* store
    instance (process B, or A after restart) serves them — nothing in memory."""
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: ("memo.docx", DOCX_MIME, b"shared-bytes"),
    )
    shared_root = source_store_module.office_view_source_store._root
    client_a = _client()
    view = _office_view(client_a)
    assert view.status_code == 200, view.text
    token = _source_token(view.json())

    # Simulate backend B / post-restart A: a fresh store object on the same dir.
    other_process_store = source_store_module.OfficeViewSourceStore(root=shared_root)
    monkeypatch.setattr(mail_api_module, "office_view_source_store", other_process_store)
    client_b = _client()
    response = client_b.get(f"/mail/office-source?t={token}")
    assert response.status_code == 200
    assert response.content == b"shared-bytes"


def test_parallel_opens_same_and_different_attachments(monkeypatch):
    payloads = {("msg-1", "att-1"): b"one", ("msg-1", "att-2"): b"two"}
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: ("memo.docx", DOCX_MIME, payloads[(kwargs["message_id"], kwargs["attachment_ref"])]),
    )
    client = _client()

    def open_view(mid, ref):
        resp = client.get(f"/mail/messages/{mid}/attachments/{ref}/office-view",
                          params={"name": "memo.docx", "content_type": DOCX_MIME})
        assert resp.status_code == 200, resp.text
        return _source_token(resp.json())

    t1a, t1b = open_view("msg-1", "att-1"), open_view("msg-1", "att-1")
    t2 = open_view("msg-1", "att-2")
    for token, expected in ((t1a, b"one"), (t1b, b"one"), (t2, b"two")):
        resp = client.get(f"/mail/office-source?t={token}")
        assert resp.status_code == 200
        assert resp.content == expected


def test_expired_entry_is_gone_and_files_removed(monkeypatch):
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: ("memo.docx", DOCX_MIME, b"docx-bytes"),
    )
    client = _client()
    token = _source_token(_office_view(client).json())
    key = mail_api_module._office_source_key(token)
    root = source_store_module.office_view_source_store._root
    meta_path = root / f"{key}.json"
    payload_paths = list(root.glob(f"{key}.*.bin"))
    assert meta_path.is_file() and len(payload_paths) == 1

    import json as _json
    meta = _json.loads(meta_path.read_text(encoding="utf-8"))
    meta["expires_at"] = time.time() - 1
    meta_path.write_text(_json.dumps(meta), encoding="utf-8")

    assert client.get(f"/mail/office-source?t={token}").status_code == 410
    assert not meta_path.exists() and not list(root.glob(f"{key}.*.bin"))


def test_oversized_attachment_refused_and_falls_back(monkeypatch):
    monkeypatch.setenv("MAIL_OFFICE_VIEW_SOURCE_ENTRY_BYTES", "4")
    monkeypatch.setattr(
        mail_api_module.mail_service,
        "download_attachment",
        lambda **kwargs: ("memo.docx", DOCX_MIME, b"docx-bytes"),
    )
    client = _client()
    # Entry exceeds the parked-source cap → 413 → frontend PDF/SheetJS fallback.
    assert _office_view(client).status_code == 413


def test_store_evicts_oldest_when_total_cap_exceeded(monkeypatch):
    store = source_store_module.office_view_source_store
    monkeypatch.setenv("MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES", "10")
    assert store.put("k1", filename="a", content_type="x", content=b"12345", ttl_sec=60)
    assert store.put("k2", filename="b", content_type="x", content=b"12345", ttl_sec=600)
    # Third entry can't fit alongside both → evicts the soonest-expiring (k1).
    assert store.put("k3", filename="c", content_type="x", content=b"12345", ttl_sec=600)
    assert store.get("k1") is None
    assert store.get("k2") is not None
    assert store.get("k3") is not None
