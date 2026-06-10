from __future__ import annotations

from collections.abc import Callable

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import passwords as passwords_api
from backend.models.auth import User
from backend.services.password_vault_service import PasswordVaultAccessError


def _make_user(*, role: str = "viewer", permissions: list[str] | None = None) -> User:
    return User(
        id=21,
        username="vault-user",
        email="vault-user@example.com",
        full_name="Vault User",
        role=role,
        permissions=permissions or [],
        use_custom_permissions=True,
        custom_permissions=permissions or [],
        is_active=True,
    )


def _client_for(user_factory: Callable[[], User], fake_service, monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(passwords_api.router, prefix="/passwords")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    app.dependency_overrides[deps.get_current_session_id] = lambda: "session-api"
    app.dependency_overrides[passwords_api.get_current_session_id] = lambda: "session-api"
    monkeypatch.setattr(passwords_api, "password_vault_service", fake_service)
    return TestClient(app)


class FakePasswordVaultService:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.reveal_allowed = True

    def list_entries(self, **kwargs):
        self.calls.append("list")
        return {
            "items": [
                {
                    "id": "entry-1",
                    "group": "VPN",
                    "tags": ["prod"],
                    "login": "svc-vpn",
                    "description": "desc",
                    "is_archived": False,
                    "created_at": "2026-05-28T00:00:00+00:00",
                    "updated_at": "2026-05-28T00:00:00+00:00",
                    "created_by": "admin",
                    "updated_by": "admin",
                    "password_configured": True,
                    "password": "must-not-leak",
                    "password_enc": "encrypted",
                }
            ],
            "groups": ["VPN"],
            "tags": ["prod"],
            "unlocked_until": None,
        }

    def create_entry(self, payload, *, actor, meta):
        self.calls.append("create")
        return {
            "id": "entry-2",
            "group": payload["group"],
            "tags": payload.get("tags", []),
            "login": payload["login"],
            "description": payload.get("description", ""),
            "is_archived": False,
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
            "password_configured": True,
        }

    def update_entry(self, entry_id, payload, *, actor, meta):
        self.calls.append("update")
        return {
            "id": entry_id,
            "group": payload.get("group") or "VPN",
            "tags": payload.get("tags") or [],
            "login": payload.get("login") or "svc-vpn",
            "description": payload.get("description") or "",
            "is_archived": False,
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
            "password_configured": True,
        }

    def archive_entry(self, entry_id, *, actor, meta):
        self.calls.append("archive")
        return {
            "id": entry_id,
            "group": "VPN",
            "tags": [],
            "login": "svc-vpn",
            "description": "",
            "is_archived": True,
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
            "password_configured": True,
        }

    def unlock(self, **kwargs):
        self.calls.append("unlock")
        return {"unlocked_until": "2026-05-28T00:05:00+00:00"}

    def unlock_with_trusted_device(self, **kwargs):
        self.calls.append("unlock.webauthn")
        return {"unlocked_until": "2026-05-28T00:05:00+00:00"}

    def _require_unlock_eligible_user(self, *, user_id):
        self.calls.append("unlock.eligible")
        return {"id": user_id, "is_2fa_enabled": True}

    def _record_unlock_failure(self, **kwargs):
        self.calls.append("unlock.fail")

    def reveal_entry(self, entry_id, *, purpose, actor, session_id, meta):
        self.calls.append(f"reveal:{purpose}")
        if not self.reveal_allowed:
            raise PasswordVaultAccessError("Password vault unlock is required")
        return {"password": "plain-secret", "unlocked_until": "2026-05-28T00:05:00+00:00"}

    def list_audit(self, *, limit=100):
        self.calls.append("audit")
        return [
            {
                "id": 1,
                "entry_id": "entry-1",
                "action": "reveal.copy",
                "actor_user_id": 21,
                "actor_username": "vault-user",
                "entry_group": "VPN",
                "entry_login": "svc-vpn",
                "ip_address": "127.0.0.1",
                "user_agent": "pytest",
                "created_at": "2026-05-28T00:00:00+00:00",
            }
        ]

    def list_groups(self, *, include_inactive=False):
        self.calls.append("groups:list")
        items = [
            {
                "id": "group-1",
                "name": "VPN",
                "is_active": True,
                "sort_order": 0,
                "created_at": None,
                "updated_at": None,
                "created_by": "admin",
                "updated_by": "admin",
            }
        ]
        if include_inactive:
            items.append(
                {
                    "id": "group-2",
                    "name": "Legacy",
                    "is_active": False,
                    "sort_order": 10,
                    "created_at": None,
                    "updated_at": None,
                    "created_by": "admin",
                    "updated_by": "admin",
                }
            )
        return items

    def create_group(self, payload, *, actor):
        self.calls.append("groups:create")
        return {
            "id": "group-3",
            "name": payload["name"],
            "is_active": True,
            "sort_order": int(payload.get("sort_order") or 0),
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
        }

    def update_group(self, group_id, payload, *, actor):
        self.calls.append("groups:update")
        return {
            "id": group_id,
            "name": payload.get("name") or "VPN",
            "is_active": bool(payload.get("is_active", True)),
            "sort_order": int(payload.get("sort_order") or 0),
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
        }

    def archive_group(self, group_id, *, actor):
        self.calls.append("groups:archive")
        return {
            "id": group_id,
            "name": "VPN",
            "is_active": False,
            "sort_order": 0,
            "created_at": None,
            "updated_at": None,
            "created_by": actor.username,
            "updated_by": actor.username,
        }


def test_passwords_list_requires_read_permission(monkeypatch):
    fake = FakePasswordVaultService()
    client = _client_for(lambda: _make_user(permissions=[]), fake, monkeypatch)

    response = client.get("/passwords")

    assert response.status_code == 403
    assert fake.calls == []


def test_passwords_list_strips_secret_fields_from_response(monkeypatch):
    fake = FakePasswordVaultService()
    client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)

    response = client.get("/passwords?q=svc")

    assert response.status_code == 200
    assert fake.calls == ["list"]
    item = response.json()["items"][0]
    assert item["login"] == "svc-vpn"
    assert "password" not in item
    assert "password_enc" not in item


def test_read_user_cannot_write_password_entries(monkeypatch):
    fake = FakePasswordVaultService()
    client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)

    response = client.post(
        "/passwords",
        json={"group": "VPN", "tags": [], "login": "svc", "password": "secret", "description": ""},
    )

    assert response.status_code == 403
    assert fake.calls == []


def test_write_permission_can_create_update_and_archive(monkeypatch):
    fake = FakePasswordVaultService()
    client = _client_for(lambda: _make_user(permissions=["passwords.write"]), fake, monkeypatch)

    create_response = client.post(
        "/passwords",
        json={"group": "VPN", "tags": ["prod"], "login": "svc", "password": "secret", "description": ""},
    )
    update_response = client.patch("/passwords/entry-2", json={"description": "updated"})
    archive_response = client.post("/passwords/entry-2/archive")

    assert create_response.status_code == 201
    assert update_response.status_code == 200
    assert archive_response.status_code == 200
    assert fake.calls == ["create", "update", "archive"]


def test_reveal_requires_unlock_and_returns_single_plaintext_only_when_allowed(monkeypatch):
    fake = FakePasswordVaultService()
    fake.reveal_allowed = False
    client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)

    denied = client.post("/passwords/entry-1/reveal", json={"purpose": "copy"})
    assert denied.status_code == 403

    fake.reveal_allowed = True
    revealed = client.post("/passwords/entry-1/reveal", json={"purpose": "copy"})
    assert revealed.status_code == 200
    assert revealed.json()["password"] == "plain-secret"
    assert fake.calls == ["reveal:copy", "reveal:copy"]


def test_unlock_webauthn_options_requires_trusted_devices(monkeypatch):
    fake = FakePasswordVaultService()
    client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)
    monkeypatch.setattr(passwords_api.trusted_device_service, "list_devices", lambda user_id, active_only=True: [])

    response = client.post("/passwords/unlock/webauthn/options")
    assert response.status_code == 400
    assert "доверенных устройств" in response.json()["detail"]


def test_unlock_and_audit_endpoints(monkeypatch):
    fake = FakePasswordVaultService()
    read_client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)

    unlock_response = read_client.post("/passwords/unlock", json={"totp_code": "123456"})
    assert unlock_response.status_code == 200
    assert unlock_response.json()["unlocked_until"]

    audit_for_operator = read_client.get("/passwords/audit")
    assert audit_for_operator.status_code == 403

    admin_client = _client_for(lambda: _make_user(role="admin", permissions=[]), fake, monkeypatch)
    audit_response = admin_client.get("/passwords/audit")
    assert audit_response.status_code == 200
    assert audit_response.json()["items"][0]["action"] == "reveal.copy"


def test_password_group_endpoints_permissions(monkeypatch):
    fake = FakePasswordVaultService()
    read_client = _client_for(lambda: _make_user(permissions=["passwords.read"]), fake, monkeypatch)

    list_response = read_client.get("/passwords/groups")
    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["name"] == "VPN"

    denied_create = read_client.post("/passwords/groups", json={"name": "DB", "sort_order": 1})
    assert denied_create.status_code == 403

    write_client = _client_for(lambda: _make_user(permissions=["passwords.write"]), fake, monkeypatch)
    create_response = write_client.post("/passwords/groups", json={"name": "DB", "sort_order": 1})
    update_response = write_client.patch("/passwords/groups/group-3", json={"name": "DBA", "sort_order": 2})
    archive_response = write_client.post("/passwords/groups/group-3/archive")

    assert create_response.status_code == 201
    assert update_response.status_code == 200
    assert archive_response.status_code == 200
