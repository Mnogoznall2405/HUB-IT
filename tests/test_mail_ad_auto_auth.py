from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")
mail_api_module = importlib.import_module("backend.api.v1.mail")
auth_models_module = importlib.import_module("backend.models.auth")
secret_crypto_module = importlib.import_module("backend.services.secret_crypto_service")


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'mail_ad_auto_app.db').as_posix()}"


def _mail_user(user_id: int = 100, role: str = "viewer"):
    return auth_models_module.User(
        id=user_id,
        username="mail-user",
        email="mail-user@zsgp.ru",
        full_name="Mail User",
        role=role,
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="ldap",
        telegram_id=None,
        assigned_database=None,
        mailbox_email="mail-user@zsgp.ru",
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=True,
    )


def _build_service(temp_dir: str, monkeypatch):
    store = SimpleNamespace(db_path=str(Path(temp_dir) / "legacy_mail.sqlite3"))
    monkeypatch.setattr(mail_module, "get_local_store", lambda: store)
    return mail_module.MailService(database_url=_sqlite_url(temp_dir))


def test_mail_service_uses_session_auth_context_for_ldap_user(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)

    monkeypatch.setattr(
        mail_module.user_service,
        "get_by_id",
        lambda _user_id: {
            "id": 11,
            "username": "ertaev_me",
            "auth_source": "ldap",
            "email": None,
            "mailbox_email": None,
            "mailbox_login": None,
            "mailbox_password_enc": "",
            "mail_signature_html": "<p>Best regards</p>",
        },
    )
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-11")
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "get_session_context",
        lambda session_id, user_id=None: {
            "session_id": session_id,
            "user_id": int(user_id or 0),
            "exchange_login": "ertaev_me@zsgp.corp",
        },
    )
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "resolve_session_password",
        lambda session_id, user_id=None: "derived-pass",
    )

    profile = service._resolve_user_mail_profile(11, require_password=True)

    assert profile["email"] == "ertaev.me@zsgp.ru"
    assert profile["login"] == "ertaev_me@zsgp.corp"
    assert profile["password"] == "derived-pass"
    assert profile["mail_auth_mode"] == "ad_auto"
    assert profile["mail_requires_relogin"] is False


def test_mail_service_requires_relogin_for_ldap_user_without_session_context(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)

    monkeypatch.setattr(
        mail_module.user_service,
        "get_by_id",
        lambda _user_id: {
            "id": 12,
            "username": "kozlovskii_me",
            "auth_source": "ldap",
            "email": "kozlovskii.me@zsgp.ru",
            "mailbox_email": None,
            "mailbox_login": None,
            "mailbox_password_enc": "",
            "mail_signature_html": "",
        },
    )
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-missing")
    monkeypatch.setattr(mail_module.session_auth_context_service, "get_session_context", lambda session_id, user_id=None: None)
    monkeypatch.setattr(mail_module.session_auth_context_service, "resolve_session_password", lambda session_id, user_id=None: "")

    config_payload = service.get_my_config(user_id=12)

    assert config_payload["mail_auth_mode"] == "ad_auto"
    assert config_payload["mail_requires_relogin"] is True
    assert config_payload["mail_requires_password"] is False
    assert config_payload["effective_mailbox_login"] == "kozlovskii_me@zsgp.corp"

    with pytest.raises(mail_module.MailServiceError, match="re-login"):
        service._resolve_user_mail_profile(12, require_password=True)


def test_ldap_user_can_save_primary_mailbox_credentials_for_all_devices(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)
    user_payload = {
        "id": 14,
        "username": "ermolaev_av",
        "auth_source": "ldap",
        "email": "ermolaev.av@zsgp.ru",
        "mailbox_email": None,
        "mailbox_login": None,
        "mailbox_password_enc": "",
        "mail_signature_html": "",
    }

    def _get_by_id(_user_id):
        return dict(user_payload)

    def _update_user(_user_id, **changes):
        if "mailbox_email" in changes:
            user_payload["mailbox_email"] = changes["mailbox_email"]
        if "mailbox_login" in changes:
            user_payload["mailbox_login"] = changes["mailbox_login"]
        if "mailbox_password" in changes:
            raw_password = str(changes["mailbox_password"] or "").strip()
            user_payload["mailbox_password_enc"] = (
                secret_crypto_module.encrypt_secret(raw_password)
                if raw_password
                else ""
            )
        return dict(user_payload)

    monkeypatch.setattr(mail_module.user_service, "get_by_id", _get_by_id)
    monkeypatch.setattr(mail_module.user_service, "update_user", _update_user)
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-phone")
    monkeypatch.setattr(mail_module.session_auth_context_service, "get_session_context", lambda session_id, user_id=None: None)
    monkeypatch.setattr(mail_module.session_auth_context_service, "resolve_session_password", lambda session_id, user_id=None: "")
    monkeypatch.setattr(
        mail_module.MailService,
        "verify_mailbox_credentials",
        lambda self, *, mailbox_email, mailbox_login, mailbox_password: {
            "mailbox_email": mailbox_email,
            "effective_mailbox_login": mailbox_login,
        },
    )

    initial_config = service.get_my_config(user_id=14)
    assert initial_config["auth_mode"] == "primary_session"
    assert initial_config["mail_auth_mode"] == "ad_auto"
    assert initial_config["mail_requires_relogin"] is True

    saved_config = service.save_my_credentials(
        user_id=14,
        mailbox_email="ermolaev.av@zsgp.ru",
        mailbox_login="ermolaev_av@zsgp.corp",
        mailbox_password="SharedPass123!",
    )
    assert saved_config["auth_mode"] == "stored_credentials"
    assert saved_config["mail_auth_mode"] == "manual"
    assert saved_config["mail_requires_password"] is False
    assert saved_config["mail_requires_relogin"] is False
    assert saved_config["effective_mailbox_login"] == "ermolaev_av@zsgp.corp"

    other_device_config = service.get_my_config(user_id=14)
    assert other_device_config["auth_mode"] == "stored_credentials"
    assert other_device_config["mail_auth_mode"] == "manual"
    assert other_device_config["mail_requires_password"] is False
    assert other_device_config["mail_requires_relogin"] is False

    mailbox_items = service.list_user_mailboxes(user_id=14, include_inactive=True)
    assert len(mailbox_items) == 1
    assert mailbox_items[0]["auth_mode"] == "stored_credentials"
    assert mailbox_items[0]["mail_requires_relogin"] is False


def test_ldap_primary_mailbox_save_uses_effective_session_login_when_payload_login_is_missing(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)
    user_payload = {
        "id": 230123,
        "username": "stepanov_ai",
        "auth_source": "ldap",
        "email": "stepanov.ai@zsgp.ru",
        "mailbox_email": None,
        "mailbox_login": None,
        "mailbox_password_enc": "",
        "mail_signature_html": "",
    }

    verified_calls: list[dict[str, str]] = []

    def _get_by_id(_user_id):
        return dict(user_payload)

    def _update_user(_user_id, **changes):
        if "mailbox_email" in changes and changes["mailbox_email"] is not mail_module._UNSET:
            user_payload["mailbox_email"] = changes["mailbox_email"]
        if "mailbox_login" in changes and changes["mailbox_login"] is not mail_module._UNSET:
            user_payload["mailbox_login"] = changes["mailbox_login"]
        if "mailbox_password" in changes and changes["mailbox_password"] is not mail_module._UNSET:
            raw_password = str(changes["mailbox_password"] or "").strip()
            user_payload["mailbox_password_enc"] = (
                secret_crypto_module.encrypt_secret(raw_password)
                if raw_password
                else ""
            )
        return dict(user_payload)

    def _verify_mailbox_credentials(self, *, mailbox_email, mailbox_login, mailbox_password):
        verified_calls.append(
            {
                "mailbox_email": mailbox_email,
                "mailbox_login": mailbox_login,
                "mailbox_password": mailbox_password,
            }
        )
        return {
            "mailbox_email": mailbox_email,
            "effective_mailbox_login": mailbox_login,
        }

    monkeypatch.setattr(mail_module.user_service, "get_by_id", _get_by_id)
    monkeypatch.setattr(mail_module.user_service, "update_user", _update_user)
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-stepanov")
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "get_session_context",
        lambda session_id, user_id=None: {
            "session_id": session_id,
            "user_id": int(user_id or 0),
            "exchange_login": "stepanov_ai@zsgp.corp",
        },
    )
    monkeypatch.setattr(mail_module.session_auth_context_service, "resolve_session_password", lambda session_id, user_id=None: "")
    monkeypatch.setattr(mail_module.MailService, "verify_mailbox_credentials", _verify_mailbox_credentials)

    initial_config = service.get_my_config(user_id=230123)
    assert initial_config["auth_mode"] == "primary_session"
    assert initial_config["effective_mailbox_login"] == "stepanov_ai@zsgp.corp"

    saved_config = service.save_my_credentials(
        user_id=230123,
        mailbox_password="SharedPass123!",
    )

    assert len(verified_calls) == 2
    assert all(call["mailbox_email"] == "stepanov.ai@zsgp.ru" for call in verified_calls)
    assert all(call["mailbox_login"] == "stepanov_ai@zsgp.corp" for call in verified_calls)
    assert all(call["mailbox_password"] == "SharedPass123!" for call in verified_calls)
    assert saved_config["auth_mode"] == "stored_credentials"
    assert saved_config["mail_auth_mode"] == "manual"
    assert saved_config["effective_mailbox_login"] == "stepanov_ai@zsgp.corp"


def test_mail_service_derives_ldap_mailbox_email_from_username_when_missing(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)

    monkeypatch.setattr(
        mail_module.user_service,
        "get_by_id",
        lambda _user_id: {
            "id": 13,
            "username": "ivanov_aa",
            "auth_source": "ldap",
            "email": None,
            "mailbox_email": None,
            "mailbox_login": None,
            "mailbox_password_enc": "",
            "mail_signature_html": "",
        },
    )
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-13")
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "get_session_context",
        lambda session_id, user_id=None: {
            "session_id": session_id,
            "user_id": int(user_id or 0),
            "exchange_login": "ivanov_aa@zsgp.corp",
        },
    )
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "resolve_session_password",
        lambda session_id, user_id=None: "pass-13",
    )

    profile = service._resolve_user_mail_profile(13, require_password=True)

    assert profile["email"] == "ivanov.aa@zsgp.ru"
    assert profile["login"] == "ivanov_aa@zsgp.corp"
    assert profile["mail_auth_mode"] == "ad_auto"


def test_mail_service_keeps_manual_mode_for_local_user(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)

    monkeypatch.setattr(
        mail_module.user_service,
        "get_by_id",
        lambda _user_id: {
            "id": 21,
            "username": "local-user",
            "auth_source": "local",
            "email": "local-user@zsgp.ru",
            "mailbox_email": "helpdesk@zsgp.ru",
            "mailbox_login": "helpdesk",
            "mailbox_password_enc": secret_crypto_module.encrypt_secret("manual-pass"),
            "mail_signature_html": "<p>Support</p>",
        },
    )

    profile = service._resolve_user_mail_profile(21, require_password=True)
    config_payload = service.get_my_config(user_id=21)

    assert profile["email"] == "helpdesk@zsgp.ru"
    assert profile["login"] == "helpdesk"
    assert profile["password"] == "manual-pass"
    assert profile["mail_auth_mode"] == "manual"
    assert config_payload["mail_auth_mode"] == "manual"
    assert config_payload["mail_requires_password"] is False
    assert config_payload["mail_requires_relogin"] is False


def test_invalidate_saved_password_clears_primary_stored_credentials_for_ldap_user(temp_dir, monkeypatch):
    service = _build_service(temp_dir, monkeypatch)
    user_payload = {
        "id": 22,
        "username": "ldap-shared",
        "auth_source": "ldap",
        "email": "ldap.shared@zsgp.ru",
        "mailbox_email": None,
        "mailbox_login": None,
        "mailbox_password_enc": "",
        "mail_signature_html": "",
    }

    def _get_by_id(_user_id):
        return dict(user_payload)

    def _update_user(_user_id, **changes):
        if "mailbox_password" in changes:
            raw_password = str(changes["mailbox_password"] or "").strip()
            user_payload["mailbox_password_enc"] = (
                secret_crypto_module.encrypt_secret(raw_password)
                if raw_password
                else ""
            )
        return dict(user_payload)

    monkeypatch.setattr(mail_module.user_service, "get_by_id", _get_by_id)
    monkeypatch.setattr(mail_module.user_service, "update_user", _update_user)
    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-ldap-shared")
    monkeypatch.setattr(mail_module.session_auth_context_service, "get_session_context", lambda session_id, user_id=None: None)
    monkeypatch.setattr(mail_module.session_auth_context_service, "resolve_session_password", lambda session_id, user_id=None: "")
    monkeypatch.setattr(
        mail_module.MailService,
        "verify_mailbox_credentials",
        lambda self, *, mailbox_email, mailbox_login, mailbox_password: {
            "mailbox_email": mailbox_email,
            "effective_mailbox_login": mailbox_login,
        },
    )

    service.save_my_credentials(
        user_id=22,
        mailbox_email="ldap.shared@zsgp.ru",
        mailbox_login="ldap_shared@zsgp.corp",
        mailbox_password="OldPassword123!",
    )

    initial_config = service.get_my_config(user_id=22)
    assert initial_config["auth_mode"] == "stored_credentials"
    assert initial_config["mail_requires_password"] is False
    assert initial_config["mail_requires_relogin"] is False

    service.invalidate_saved_password(user_id=22)

    refreshed_config = service.get_my_config(user_id=22)
    assert refreshed_config["auth_mode"] == "stored_credentials"
    assert refreshed_config["mail_requires_password"] is True
    assert refreshed_config["mail_requires_relogin"] is False


def test_mail_test_connection_blocks_foreign_ldap_user_without_session_secret(monkeypatch):
    current_user = _mail_user(user_id=1, role="admin")

    monkeypatch.setattr(
        mail_api_module.user_service,
        "get_by_id",
        lambda user_id: {
            "id": int(user_id),
            "username": "target-user",
            "auth_source": "ldap",
        },
    )

    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_test_user] = lambda: current_user

    response = TestClient(app).post("/mail/test-connection", json={"user_id": 77})

    assert response.status_code == 403
    assert "current user session" in response.json()["detail"]
