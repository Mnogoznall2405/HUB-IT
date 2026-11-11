"""A connected mailbox must show up in the mail page even when a cached bootstrap snapshot predates it."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import conftest

WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_api_module = importlib.import_module("backend.api.v1.mail")
mail_service_module = importlib.import_module("backend.services.mail_service")
auth_models_module = importlib.import_module("backend.models.auth")
snapshot_module = importlib.import_module("backend.services.mail_runtime_snapshot_service")


def _row(mailbox_id: str, label: str, email: str, *, primary: bool = False) -> dict:
    return {
        "id": mailbox_id, "label": label, "mailbox_email": email, "mailbox_login": "",
        "auth_mode": "stored_credentials" if primary else "primary_credentials",
        "is_primary": primary, "is_active": True, "sort_order": 0 if primary else 1,
    }


def _user() -> auth_models_module.User:
    return auth_models_module.User(
        id=100, username="mail-user", email="mail-user@example.com", full_name="Mail User", role="viewer",
        is_active=True, permissions=[], use_custom_permissions=False, custom_permissions=[],
        auth_source="local", mailbox_email="mail-user@example.com", mail_is_configured=True,
    )


def test_stale_snapshot_without_the_new_mailbox_is_served_with_the_live_mailbox_list(monkeypatch):
    rows = [_row("a", "Main", "main@example.test", primary=True), _row("b", "HUB-IT", "hub-it@example.test")]
    monkeypatch.setattr(mail_service_module.mail_service, "_list_user_mailboxes_rows", lambda **kw: rows)
    monkeypatch.setattr(
        mail_service_module.user_service, "get_by_id",
        lambda uid: {"id": uid, "username": "u", "email": "main@example.test", "mailbox_email": "main@example.test",
                     "mailbox_login": "u", "mailbox_password": "", "mail_signature_html": ""},
    )
    monkeypatch.setenv("MAIL_SHARED_SNAPSHOT_READ_ENABLED", "1")
    monkeypatch.setattr(
        mail_api_module.mail_runtime_snapshot_service, "read",
        lambda **kw: {
            "state": "stale", "source": "app_snapshot", "as_of": "2026-10-20T05:11:00+00:00", "last_error": "",
            "payload": {
                "mailboxes": [{"id": "a", "mailbox_email": "main@example.test", "unread_count": 7,
                               "unread_count_state": "fresh", "is_selected": True}],
                "messages": {"items": [{"id": "old-msg"}]},
            },
        },
    )
    monkeypatch.setattr(mail_api_module, "_schedule_mail_bootstrap_refresh", lambda **kw: None)
    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_user] = lambda: _user()

    payload = TestClient(app).get("/mail/bootstrap", params={"limit": 20, "mailbox_id": "a"}).json()

    by_id = {item["id"]: item for item in payload["mailboxes"]}
    assert list(by_id) == ["a", "b"]  # HUB-IT is there although the snapshot predates it
    assert by_id["b"]["label"] == "HUB-IT"
    assert by_id["a"]["unread_count"] == 7 and by_id["a"]["is_selected"] is True  # counters survive
    assert payload["messages"]["items"] == [{"id": "old-msg"}]  # the rest of the snapshot is untouched


def test_changing_the_mailbox_set_drops_the_cached_bootstrap_snapshots(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'snap.db').as_posix()}"
    conftest.copy_app_schema_for_url(database_url)
    snapshots = snapshot_module.MailRuntimeSnapshotService(database_url)
    for user_id in (42, 43):
        snapshots.write_success(
            user_id=user_id, mailbox_id="a", snapshot_type="bootstrap", context_key="inbox|current|20",
            payload={"mailboxes": []}, ttl_seconds=300,
        )
    snapshots.write_success(user_id=42, mailbox_id=None, snapshot_type="unread", payload={"unread_count": 3}, ttl_seconds=90)

    assert snapshots.invalidate_bootstrap(user_id=42) == 1

    assert snapshots.read(user_id=42, mailbox_id="a", snapshot_type="bootstrap", context_key="inbox|current|20")["state"] == "unknown"
    assert snapshots.read(user_id=43, mailbox_id="a", snapshot_type="bootstrap", context_key="inbox|current|20")["state"] == "ok"
    assert snapshots.read(user_id=42, mailbox_id=None, snapshot_type="unread")["payload"] == {"unread_count": 3}
