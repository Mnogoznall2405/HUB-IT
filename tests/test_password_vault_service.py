from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppPasswordVaultEntry
from backend.models.auth import User
from backend.services import password_vault_service as service_module
from backend.services.password_vault_service import (
    PASSWORD_VAULT_UNLOCK_NAMESPACE,
    PasswordVaultAccessError,
    PasswordVaultRequestMeta,
    PasswordVaultService,
    PasswordVaultValidationError,
)
from backend.services.secret_crypto_service import _build_fernet


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'password_vault.db').as_posix()}"


def _actor() -> User:
    return User(
        id=11,
        username="vault-admin",
        email="vault-admin@example.com",
        full_name="Vault Admin",
        is_active=True,
        role="admin",
        permissions=[],
    )


def _meta() -> PasswordVaultRequestMeta:
    return PasswordVaultRequestMeta(ip_address="127.0.0.1", user_agent="pytest")


def _configure_crypto(monkeypatch) -> None:
    monkeypatch.setenv("PASSWORD_VAULT_KEY", "test-password-vault-key")
    _build_fernet.cache_clear()


class FakeRuntimeStore:
    def __init__(self) -> None:
        self.payloads: dict[tuple[str, str], object] = {}
        self.counters: dict[tuple[str, str], int] = {}

    def set_json(self, namespace: str, key: str, payload, ttl_seconds=None) -> None:
        self.payloads[(namespace, key)] = payload

    def get_json(self, namespace: str, key: str):
        return self.payloads.get((namespace, key))

    def delete(self, namespace: str, key: str) -> None:
        self.payloads.pop((namespace, key), None)

    def increment_counter(self, namespace: str, key: str, *, window_seconds: int, amount: int = 1):
        counter_key = (namespace, key)
        self.counters[counter_key] = self.counters.get(counter_key, 0) + amount
        payload = {"count": self.counters[counter_key], "window_started_at": 0, "expires_at": 0}
        self.payloads[counter_key] = payload
        return payload


def _install_runtime_store(monkeypatch) -> FakeRuntimeStore:
    store = FakeRuntimeStore()
    monkeypatch.setattr(service_module, "auth_runtime_store_service", store)
    return store


def test_password_vault_crud_never_exposes_stored_secret(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)

    created = service.create_entry(
        {
            "group": "VPN",
            "tags": ["prod", "vpn"],
            "login": "svc-vpn",
            "password": "super-secret-value",
            "description": "Production VPN",
        },
        actor=actor,
        meta=_meta(),
    )

    assert created["password_configured"] is True
    assert "password" not in created
    assert "password_enc" not in created

    listed = service.list_entries(q="svc", user_id=actor.id, session_id="session-1")
    assert len(listed["items"]) == 1
    assert listed["items"][0]["login"] == "svc-vpn"

    listed_by_description = service.list_entries(q="production", user_id=actor.id, session_id="session-1")
    assert len(listed_by_description["items"]) == 1
    assert listed_by_description["items"][0]["description"] == "Production VPN"

    listed_by_tag = service.list_entries(q="prod", user_id=actor.id, session_id="session-1")
    assert len(listed_by_tag["items"]) == 1
    assert "prod" in listed_by_tag["items"][0]["tags"]
    assert "password" not in listed["items"][0]
    assert "password_enc" not in listed["items"][0]

    with app_session(_sqlite_url(temp_dir)) as session:
        row = session.get(AppPasswordVaultEntry, created["id"])
        assert row is not None
        assert row.password_enc
        assert "super-secret-value" not in row.password_enc

    with pytest.raises(PasswordVaultAccessError):
        service.reveal_entry(created["id"], purpose="show", actor=actor, session_id="session-1", meta=_meta())

    runtime_store.set_json(
        PASSWORD_VAULT_UNLOCK_NAMESPACE,
        f"{actor.id}:session-1",
        {"unlocked_until": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()},
        ttl_seconds=300,
    )
    revealed = service.reveal_entry(created["id"], purpose="copy", actor=actor, session_id="session-1", meta=_meta())
    assert revealed["password"] == "super-secret-value"

    updated = service.update_entry(
        created["id"],
        {"description": "Updated", "password": "rotated-secret"},
        actor=actor,
        meta=_meta(),
    )
    assert updated["description"] == "Updated"

    archived = service.archive_entry(created["id"], actor=actor, meta=_meta())
    assert archived["is_archived"] is True

    audit_json = json.dumps(service.list_audit(limit=20), ensure_ascii=False)
    assert "super-secret-value" not in audit_json
    assert "rotated-secret" not in audit_json
    assert "create" in audit_json
    assert "update" in audit_json
    assert "archive" in audit_json
    assert "reveal.copy" in audit_json


def test_password_vault_unlock_requires_enabled_2fa(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    monkeypatch.setattr(service_module.user_service, "get_by_id", lambda _user_id: {"id": 11, "is_2fa_enabled": False})

    with pytest.raises(PasswordVaultAccessError):
        service.unlock(actor=_actor(), session_id="session-2", totp_code="123456", meta=_meta())


def test_password_vault_unlock_setup_enables_2fa_and_grants_access(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    user_state = {
        "id": actor.id,
        "username": actor.username,
        "email": actor.email,
        "is_2fa_enabled": False,
        "totp_secret_enc": "",
    }

    monkeypatch.setattr(service_module.user_service, "get_by_id", lambda _user_id: dict(user_state))
    monkeypatch.setattr(
        service_module.user_service,
        "update_user",
        lambda user_id, **fields: user_state.update(fields),
    )
    monkeypatch.setattr(service_module.twofa_service, "encrypt_secret", lambda secret: f"enc:{secret}")
    monkeypatch.setattr(service_module.twofa_service, "decrypt_secret", lambda value: str(value).replace("enc:", ""))
    monkeypatch.setattr(
        service_module.twofa_service,
        "verify_totp",
        lambda *, secret, code, valid_window=1: code == "123456",
    )
    monkeypatch.setattr(service_module.twofa_service, "generate_backup_codes", lambda count=8: ["BACKUP-1", "BACKUP-2"])
    monkeypatch.setattr(service_module.auth_security_service, "_replace_backup_codes", lambda user_id, codes: None)

    setup = service.start_unlock_2fa_setup(actor=actor, meta=_meta())
    assert setup["setup_challenge_id"]
    assert setup["otpauth_uri"]
    assert setup["manual_entry_key"]

    result = service.verify_unlock_2fa_setup(
        actor=actor,
        session_id="session-setup",
        setup_challenge_id=setup["setup_challenge_id"],
        totp_code="123456",
        meta=_meta(),
    )
    assert result["unlocked_until"]
    assert result["backup_codes"] == ["BACKUP-1", "BACKUP-2"]
    assert user_state["is_2fa_enabled"] is True
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-setup")


def test_password_vault_unlock_accepts_totp_and_backup_code(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda _user_id: {"id": actor.id, "is_2fa_enabled": True, "totp_secret_enc": "encrypted-totp"},
    )
    monkeypatch.setattr(service_module.twofa_service, "decrypt_secret", lambda value: f"plain:{value}")
    monkeypatch.setattr(
        service_module.twofa_service,
        "verify_totp",
        lambda *, secret, code, valid_window=1: secret == "plain:encrypted-totp" and code == "123456",
    )
    monkeypatch.setattr(service_module.auth_security_service, "_consume_backup_code", lambda user_id, code: user_id == actor.id and code == "BACKUP-1")

    totp_result = service.unlock(actor=actor, session_id="session-3", totp_code="123456", meta=_meta())
    assert totp_result["unlocked_until"]
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-3")

    backup_result = service.unlock(actor=actor, session_id="session-4", backup_code="BACKUP-1", meta=_meta())
    assert backup_result["unlocked_until"]
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-4")

    audit_json = json.dumps(service.list_audit(limit=20), ensure_ascii=False)
    assert "123456" not in audit_json
    assert "BACKUP-1" not in audit_json
    assert audit_json.count("unlock") == 2


def test_password_vault_unlock_survives_session_id_change(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda _user_id: {"id": actor.id, "is_2fa_enabled": True, "totp_secret_enc": "encrypted-totp"},
    )
    monkeypatch.setattr(service_module.twofa_service, "decrypt_secret", lambda value: f"plain:{value}")
    monkeypatch.setattr(
        service_module.twofa_service,
        "verify_totp",
        lambda *, secret, code, valid_window=1: secret == "plain:encrypted-totp" and code == "123456",
    )

    service.unlock(actor=actor, session_id="session-a", totp_code="123456", meta=_meta())
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-b")
    assert service.get_unlocked_until(user_id=actor.id, session_id=None)


def test_password_vault_unlock_with_trusted_device(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda user_id: {
            "id": user_id,
            "is_2fa_enabled": True,
            "totp_secret_enc": "enc",
        },
    )
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    device = {"id": "device-1", "user_id": actor.id}

    result = service.unlock_with_trusted_device(
        actor=actor,
        session_id="session-passkey",
        device=device,
        meta=_meta(),
    )
    assert result["unlocked_until"]
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-passkey")

    audit_json = json.dumps(service.list_audit(limit=20), ensure_ascii=False)
    assert "unlock.webauthn" in audit_json


def test_password_vault_requires_existing_active_group(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()

    with pytest.raises(PasswordVaultValidationError):
        service.create_entry(
            {
                "group": "VPN",
                "tags": [],
                "login": "svc-vpn",
                "password": "secret-1",
                "description": "",
            },
            actor=actor,
            meta=_meta(),
        )

    group = service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)
    created = service.create_entry(
        {
            "group": "VPN",
            "tags": [],
            "login": "svc-vpn",
            "password": "secret-2",
            "description": "",
        },
        actor=actor,
        meta=_meta(),
    )
    assert created["group"] == "VPN"

    service.archive_group(group["id"], actor=actor)
    with pytest.raises(PasswordVaultValidationError):
        service.update_entry(created["id"], {"group": "VPN"}, actor=actor, meta=_meta())


def test_password_vault_group_crud(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()

    created = service.create_group({"name": "Infra", "sort_order": 3}, actor=actor)
    assert created["name"] == "Infra"
    assert created["is_active"] is True

    listed = service.list_groups()
    assert len(listed) == 1
    assert listed[0]["name"] == "Infra"

    updated = service.update_group(created["id"], {"name": "Infra Core", "sort_order": 1}, actor=actor)
    assert updated["name"] == "Infra Core"
    assert updated["sort_order"] == 1

    archived = service.archive_group(created["id"], actor=actor)
    assert archived["is_active"] is False
    assert service.list_groups() == []
