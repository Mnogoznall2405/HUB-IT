from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppPasswordVaultEntry
from backend.models.auth import User
from backend.services import password_vault_service as service_module
from backend.services.password_vault_service import (
    PASSWORD_VAULT_REVEAL_RATE_NAMESPACE,
    PASSWORD_VAULT_UNLOCK_NAMESPACE,
    PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE,
    PASSWORD_VAULT_UNLOCK_USER_RATE_NAMESPACE,
    PasswordVaultAccessError,
    PasswordVaultRateLimitError,
    PasswordVaultRequestMeta,
    PasswordVaultService,
    PasswordVaultValidationError,
)
from backend.services.secret_crypto_service import (
    SecretCryptoError,
    _build_fernet,
    decrypt_password_vault_secret,
    encrypt_password_vault_secret,
)


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
        self.counters.pop((namespace, key), None)

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


def test_password_vault_unlock_with_mobile_biometric_credential(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda user_id: {"id": user_id, "is_2fa_enabled": True, "totp_secret_enc": "enc"},
    )
    authenticate = lambda **kwargs: {"credential_id": "credential-1", "user_id": actor.id}
    monkeypatch.setattr(service_module.mobile_biometric_session_service, "authenticate", authenticate)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))

    result = service.unlock_with_mobile_biometric(
        actor=actor,
        session_id="session-mobile",
        renewal_token="device-bound-renewal-token",
        client_device_id="device-17",
        meta=_meta(),
    )

    assert result["unlocked_until"]
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-mobile")
    assert "unlock.mobile_biometric" in json.dumps(service.list_audit(limit=20), ensure_ascii=False)


def test_password_vault_rejects_mobile_biometric_credential_for_another_user(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda user_id: {"id": user_id, "is_2fa_enabled": True, "totp_secret_enc": "enc"},
    )
    monkeypatch.setattr(
        service_module.mobile_biometric_session_service,
        "authenticate",
        lambda **kwargs: {"credential_id": "credential-2", "user_id": actor.id + 1},
    )
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))

    with pytest.raises(PasswordVaultAccessError, match="Не удалось подтвердить отпечаток"):
        service.unlock_with_mobile_biometric(
            actor=actor,
            session_id="session-mobile",
            renewal_token="wrong-user-renewal-token",
            client_device_id="device-17",
            meta=_meta(),
        )

    rate_key = service._unlock_rate_key(user_id=actor.id, ip_address=_meta().ip_address)
    assert runtime_store.counters[(service_module.PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE, rate_key)] == 1


def test_password_vault_list_paginates_and_filters_tags_exactly(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)
    for index, tag in enumerate(["prod", "prod-eu", "staging"]):
        service.create_entry(
            {
                "group": "VPN",
                "tags": [tag],
                "login": f"svc-{index}",
                "password": f"secret-{index}",
                "description": "",
            },
            actor=actor,
            meta=_meta(),
        )

    page = service.list_entries(limit=2, offset=0, user_id=actor.id, session_id="s")
    assert page["total"] == 3
    assert page["limit"] == 2
    assert page["offset"] == 0
    assert len(page["items"]) == 2

    rest = service.list_entries(limit=2, offset=2, user_id=actor.id, session_id="s")
    assert len(rest["items"]) == 1
    assert rest["items"][0]["id"] not in {item["id"] for item in page["items"]}

    clamped = service.list_entries(limit=999, offset=-5, user_id=actor.id, session_id="s")
    assert clamped["limit"] == service_module.PASSWORD_VAULT_LIST_LIMIT_MAX
    assert clamped["offset"] == 0
    assert clamped["total"] == 3

    exact = service.list_entries(tag="prod", user_id=actor.id, session_id="s")
    assert [item["login"] for item in exact["items"]] == ["svc-0"]
    assert exact["total"] == 1

    case_insensitive = service.list_entries(tag="PROD", user_id=actor.id, session_id="s")
    assert case_insensitive["total"] == 1

    # Свободный q больше не ищет по tags_json — «prod-eu» встречается только в теге.
    q_tag_only = service.list_entries(q="prod-eu", user_id=actor.id, session_id="s")
    assert q_tag_only["items"] == []
    assert q_tag_only["total"] == 0

    combined = service.list_entries(tag="staging", q="svc-2", user_id=actor.id, session_id="s")
    assert combined["total"] == 1


def test_password_vault_tag_filter_tolerates_broken_tags_json(temp_dir, monkeypatch):
    """Строка с битым tags_json не должна ронять list_entries — она просто не матчится.

    NULL невозможен на уровне схемы (nullable=False); защита покрывает
    повреждённый JSON, который мог попасть в колонку мимо ORM.
    """
    _configure_crypto(monkeypatch)
    _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)
    good = service.create_entry(
        {"group": "VPN", "tags": ["prod"], "login": "svc-ok", "password": "s1", "description": ""},
        actor=actor,
        meta=_meta(),
    )
    broken = service.create_entry(
        {"group": "VPN", "tags": ["prod"], "login": "svc-broken", "password": "s2", "description": ""},
        actor=actor,
        meta=_meta(),
    )
    with app_session(_sqlite_url(temp_dir)) as session:
        row = session.get(AppPasswordVaultEntry, broken["id"])
        assert row is not None
        row.tags_json = "{not-json"

    result = service.list_entries(tag="prod", user_id=actor.id, session_id="s")

    assert [item["login"] for item in result["items"]] == ["svc-ok"]
    assert result["total"] == 1
    unfiltered = service.list_entries(user_id=actor.id, session_id="s")
    assert {item["login"] for item in unfiltered["items"]} == {"svc-ok", "svc-broken"}


def test_password_vault_lock_revokes_session_and_user_keys(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()

    until = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    for key in (f"{actor.id}:session-x", f"{actor.id}:user"):
        runtime_store.set_json(
            PASSWORD_VAULT_UNLOCK_NAMESPACE,
            key,
            {"unlocked_until": until},
            ttl_seconds=300,
        )
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-x")

    result = service.lock(actor=actor, session_id="session-x", meta=_meta())

    assert result == {"locked": True}
    assert service.get_unlocked_until(user_id=actor.id, session_id="session-x") is None
    assert service.get_unlocked_until(user_id=actor.id, session_id=None) is None
    assert "lock" in json.dumps(service.list_audit(limit=20), ensure_ascii=False)


def test_password_vault_unlock_rate_limit_tracks_user_across_ips_and_resets_on_success(
    temp_dir, monkeypatch,
):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda _user_id: {"id": actor.id, "is_2fa_enabled": True, "totp_secret_enc": "enc"},
    )
    monkeypatch.setattr(service_module.twofa_service, "decrypt_secret", lambda value: "plain")
    monkeypatch.setattr(
        service_module.twofa_service,
        "verify_totp",
        lambda *, secret, code, valid_window=1: code == "123456",
    )

    for index in range(5):
        meta = PasswordVaultRequestMeta(ip_address=f"10.0.0.{index}", user_agent="pytest")
        with pytest.raises(PasswordVaultAccessError, match="Invalid 2FA code"):
            service.unlock(actor=actor, session_id="s", totp_code="000000", meta=meta)

    with pytest.raises(PasswordVaultRateLimitError) as blocked:
        service.unlock(
            actor=actor,
            session_id="s",
            totp_code="123456",
            meta=PasswordVaultRequestMeta(ip_address="10.9.9.9", user_agent="pytest"),
        )
    assert blocked.value.retry_after_seconds == service_module.PASSWORD_VAULT_UNLOCK_RATE_WINDOW_SECONDS

    # Окно «истекло» — имитируем сбросом fake-хранилища.
    runtime_store.counters.clear()
    runtime_store.payloads.clear()

    meta = PasswordVaultRequestMeta(ip_address="10.1.1.1", user_agent="pytest")
    for _ in range(2):
        with pytest.raises(PasswordVaultAccessError):
            service.unlock(actor=actor, session_id="s", totp_code="000000", meta=meta)
    user_bucket = (PASSWORD_VAULT_UNLOCK_USER_RATE_NAMESPACE, service._user_rate_key(user_id=actor.id))
    ip_bucket = (
        PASSWORD_VAULT_UNLOCK_RATE_NAMESPACE,
        service._unlock_rate_key(user_id=actor.id, ip_address="10.1.1.1"),
    )
    assert runtime_store.counters[user_bucket] == 2
    assert runtime_store.counters[ip_bucket] == 2

    result = service.unlock(actor=actor, session_id="s", totp_code="123456", meta=meta)
    assert result["unlocked_until"]
    assert user_bucket not in runtime_store.counters
    assert ip_bucket not in runtime_store.counters


def test_password_vault_reveal_is_throttled_per_user(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)
    created = service.create_entry(
        {"group": "VPN", "tags": [], "login": "svc", "password": "secret-1", "description": ""},
        actor=actor,
        meta=_meta(),
    )
    runtime_store.set_json(
        PASSWORD_VAULT_UNLOCK_NAMESPACE,
        f"{actor.id}:session-1",
        {"unlocked_until": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()},
        ttl_seconds=300,
    )

    for _ in range(service_module.PASSWORD_VAULT_REVEAL_RATE_LIMIT):
        revealed = service.reveal_entry(
            created["id"], purpose="show", actor=actor, session_id="session-1", meta=_meta(),
        )
        assert revealed["password"] == "secret-1"

    with pytest.raises(PasswordVaultRateLimitError) as blocked:
        service.reveal_entry(created["id"], purpose="show", actor=actor, session_id="session-1", meta=_meta())
    assert blocked.value.retry_after_seconds == service_module.PASSWORD_VAULT_REVEAL_RATE_WINDOW_SECONDS

    reveal_key = (PASSWORD_VAULT_REVEAL_RATE_NAMESPACE, service._user_rate_key(user_id=actor.id))
    assert runtime_store.counters[reveal_key] == service_module.PASSWORD_VAULT_REVEAL_RATE_LIMIT + 1


def test_password_vault_unlock_and_reveal_race(temp_dir, monkeypatch):
    _configure_crypto(monkeypatch)
    runtime_store = _install_runtime_store(monkeypatch)
    service = PasswordVaultService(database_url=_sqlite_url(temp_dir))
    actor = _actor()
    monkeypatch.setattr(
        service_module.user_service,
        "get_by_id",
        lambda _user_id: {"id": actor.id, "is_2fa_enabled": True, "totp_secret_enc": "enc"},
    )
    monkeypatch.setattr(service_module.twofa_service, "decrypt_secret", lambda value: "plain")
    monkeypatch.setattr(
        service_module.twofa_service,
        "verify_totp",
        lambda *, secret, code, valid_window=1: code == "123456",
    )
    service.create_group({"name": "VPN", "sort_order": 0}, actor=actor)
    created = service.create_entry(
        {"group": "VPN", "tags": [], "login": "svc", "password": "secret-1", "description": ""},
        actor=actor,
        meta=_meta(),
    )
    runtime_store.set_json(
        PASSWORD_VAULT_UNLOCK_NAMESPACE,
        f"{actor.id}:user",
        {"unlocked_until": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()},
        ttl_seconds=300,
    )

    def _unlock(index: int) -> dict:
        return service.unlock(
            actor=actor,
            session_id=f"race-{index}",
            totp_code="123456",
            meta=_meta(),
        )

    def _reveal(_index: int) -> dict:
        return service.reveal_entry(
            created["id"], purpose="copy", actor=actor, session_id="session-race", meta=_meta(),
        )

    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_unlock, i) for i in range(4)]
        futures += [pool.submit(_reveal, i) for i in range(4)]
        for future in futures:
            try:
                assert future.result()["unlocked_until"]
            except Exception as exc:  # noqa: BLE001 - race smoke test collects outcomes
                errors.append(exc)

    assert errors == []


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


def test_password_vault_key_rejects_passphrase_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("PASSWORD_VAULT_KEY", "weak-passphrase-not-fernet")
    _build_fernet.cache_clear()
    with pytest.raises(SecretCryptoError):
        encrypt_password_vault_secret("value")

    import base64

    monkeypatch.setenv(
        "PASSWORD_VAULT_KEY",
        base64.urlsafe_b64encode(b"k" * 32).decode("ascii"),
    )
    _build_fernet.cache_clear()
    token = encrypt_password_vault_secret("value")
    assert decrypt_password_vault_secret(token) == "value"


def test_password_vault_versioned_prefix_roundtrip(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("PASSWORD_VAULT_KEY", "test-password-vault-key")
    monkeypatch.setenv("PASSWORD_VAULT_KEY_VERSIONING", "1")
    _build_fernet.cache_clear()

    token = encrypt_password_vault_secret("value")
    assert token.startswith("fernet:v1:")

    monkeypatch.delenv("PASSWORD_VAULT_KEY_VERSIONING", raising=False)
    assert decrypt_password_vault_secret(token) == "value"
