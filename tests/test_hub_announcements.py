from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")


DASHBOARD_READ = "dashboard.read"
ANNOUNCEMENTS_WRITE = "announcements.write"


def _raw_user(
    user_id: int,
    username: str,
    full_name: str,
    role: str,
    permissions: list[str],
) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def announcement_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Announcement Author", "operator", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
        2: _raw_user(2, "operator_user", "Operator User", "operator", [DASHBOARD_READ]),
        3: _raw_user(3, "viewer_user", "Viewer User", "viewer", [DASHBOARD_READ]),
        4: _raw_user(4, "outsider", "Announcement Outsider", "operator", [DASHBOARD_READ]),
        5: _raw_user(5, "admin", "Announcement Admin", "admin", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_announcements.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")

    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    return {
        "client": client,
        "set_user": set_user,
        "raw_users": raw_users,
        "service": service,
    }


def _create_announcement(client: TestClient, **payload) -> dict:
    body = {
        "title": payload.pop("title", "Announcement Alpha"),
        "preview": payload.pop("preview", "Preview"),
        "body": payload.pop("body", "Body"),
        "priority": payload.pop("priority", "normal"),
        **payload,
    }
    response = client.post("/hub/announcements", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_targeted_announcements_visibility_and_author_seen_state(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    role_note = _create_announcement(
        client,
        title="Viewer Role Note",
        audience_scope="roles",
        audience_roles=["viewer"],
        requires_ack=True,
    )
    direct_note = _create_announcement(
        client,
        title="Operator Direct Note",
        audience_scope="users",
        audience_user_ids=[2],
    )

    assert role_note["is_unread"] is False
    assert role_note["is_ack_pending"] is False

    set_user(2)
    operator_list = client.get("/hub/announcements")
    assert operator_list.status_code == 200
    operator_ids = {item["id"] for item in operator_list.json()["items"]}
    assert direct_note["id"] in operator_ids
    assert role_note["id"] not in operator_ids
    assert client.get(f"/hub/announcements/{role_note['id']}").status_code == 403

    set_user(3)
    viewer_list = client.get("/hub/announcements")
    assert viewer_list.status_code == 200
    viewer_ids = {item["id"] for item in viewer_list.json()["items"]}
    assert role_note["id"] in viewer_ids
    assert direct_note["id"] not in viewer_ids
    viewer_detail = client.get(f"/hub/announcements/{role_note['id']}")
    assert viewer_detail.status_code == 200
    assert viewer_detail.json()["is_unread"] is True
    assert viewer_detail.json()["is_ack_pending"] is True

    set_user(4)
    outsider_list = client.get("/hub/announcements")
    assert outsider_list.status_code == 200
    outsider_ids = {item["id"] for item in outsider_list.json()["items"]}
    assert role_note["id"] not in outsider_ids
    assert direct_note["id"] not in outsider_ids


def test_announcement_read_ack_versioning_and_notifications(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    note = _create_announcement(
        client,
        title="Versioned Note",
        audience_scope="users",
        audience_user_ids=[2],
        requires_ack=True,
    )
    note_id = note["id"]

    set_user(2)
    poll_initial = client.get("/hub/notifications/poll")
    assert poll_initial.status_code == 200
    initial_events = [item for item in poll_initial.json()["items"] if item["entity_id"] == note_id]
    assert any(item["event_type"] == "announcement.new" and item["entity_type"] == "announcement" for item in initial_events)

    detail_before = client.get(f"/hub/announcements/{note_id}")
    assert detail_before.status_code == 200
    assert detail_before.json()["version"] == 1
    assert detail_before.json()["is_unread"] is True
    assert detail_before.json()["is_ack_pending"] is True

    mark_read = client.post(f"/hub/announcements/{note_id}/mark-as-read")
    assert mark_read.status_code == 200
    detail_after_read = client.get(f"/hub/announcements/{note_id}")
    assert detail_after_read.status_code == 200
    assert detail_after_read.json()["is_unread"] is False

    ack_response = client.post(f"/hub/announcements/{note_id}/ack")
    assert ack_response.status_code == 200
    assert ack_response.json()["acknowledged_version"] == 1
    assert ack_response.json()["is_ack_pending"] is False

    set_user(1)
    update_response = client.patch(
        f"/hub/announcements/{note_id}",
        json={"title": "Versioned Note Updated", "body": "Updated body"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["version"] == 2

    author_poll = client.get("/hub/notifications/poll")
    assert author_poll.status_code == 200
    assert not any(item["entity_id"] == note_id for item in author_poll.json()["items"])

    set_user(2)
    poll_after_update = client.get("/hub/notifications/poll")
    assert poll_after_update.status_code == 200
    updated_events = [item for item in poll_after_update.json()["items"] if item["entity_id"] == note_id]
    assert any(item["event_type"] == "announcement.updated" for item in updated_events)

    detail_after_update = client.get(f"/hub/announcements/{note_id}")
    assert detail_after_update.status_code == 200
    payload = detail_after_update.json()
    assert payload["version"] == 2
    assert payload["is_unread"] is True
    assert payload["is_ack_pending"] is True


def test_archived_and_expired_announcements_are_hidden_from_feed(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    archived = _create_announcement(client, title="Archive Me")
    expired = _create_announcement(
        client,
        title="Expired Note",
        expires_at=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
    )

    archive_response = client.patch(f"/hub/announcements/{archived['id']}", json={"is_active": False})
    assert archive_response.status_code == 200

    author_feed = client.get("/hub/announcements")
    assert author_feed.status_code == 200
    author_ids = {item["id"] for item in author_feed.json()["items"]}
    assert archived["id"] not in author_ids
    assert expired["id"] not in author_ids

    author_hidden_detail = client.get(f"/hub/announcements/{archived['id']}")
    assert author_hidden_detail.status_code == 200

    set_user(2)
    recipient_feed = client.get("/hub/announcements")
    assert recipient_feed.status_code == 200
    recipient_ids = {item["id"] for item in recipient_feed.json()["items"]}
    assert archived["id"] not in recipient_ids
    assert expired["id"] not in recipient_ids


def test_reads_recipients_endpoint_and_admin_only_delete(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    recipients_response = client.get("/hub/users/announcement-recipients")
    assert recipients_response.status_code == 200
    recipients_payload = recipients_response.json()
    assert len(recipients_payload["users"]) >= 5
    assert any(item["value"] == "viewer" for item in recipients_payload["roles"])

    note = _create_announcement(
        client,
        title="Receipts Note",
        audience_scope="users",
        audience_user_ids=[2, 3],
        requires_ack=True,
    )
    note_id = note["id"]

    set_user(2)
    assert client.post(f"/hub/announcements/{note_id}/mark-as-read").status_code == 200
    assert client.post(f"/hub/announcements/{note_id}/ack").status_code == 200

    set_user(1)
    reads_response = client.get(f"/hub/announcements/{note_id}/reads")
    assert reads_response.status_code == 200
    reads_payload = reads_response.json()
    assert reads_payload["summary"]["recipients_total"] == 2
    assert reads_payload["summary"]["seen_total"] == 1
    assert reads_payload["summary"]["ack_total"] == 1
    assert reads_payload["summary"]["pending_ack_total"] == 1
    items_by_user_id = {int(item["user_id"]): item for item in reads_payload["items"]}
    assert items_by_user_id[2]["is_seen"] is True
    assert items_by_user_id[2]["is_acknowledged"] is True
    assert items_by_user_id[2]["read_at"]
    assert items_by_user_id[2]["acknowledged_at"]
    assert items_by_user_id[3]["is_seen"] is False
    assert items_by_user_id[3]["is_acknowledged"] is False
    assert items_by_user_id[3]["read_at"] == ""
    assert items_by_user_id[3]["acknowledged_at"] == ""

    delete_as_author = client.delete(f"/hub/announcements/{note_id}")
    assert delete_as_author.status_code == 403

    set_user(5)
    delete_as_admin = client.delete(f"/hub/announcements/{note_id}")
    assert delete_as_admin.status_code == 200
    assert client.get(f"/hub/announcements/{note_id}").status_code == 404
