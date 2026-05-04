from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

profile_model = importlib.import_module("backend.services.mail_profile_model")
mail_module = importlib.import_module("backend.services.mail_service")


def test_profile_model_normalizes_mailbox_auth_mode():
    assert profile_model.normalize_mailbox_auth_mode("PRIMARY_SESSION") == "primary_session"
    assert profile_model.normalize_mailbox_auth_mode("bad-value") == "stored_credentials"
    assert profile_model.normalize_mailbox_auth_mode("bad-value", "primary_credentials") == "primary_credentials"


def test_profile_model_resolves_manual_effective_email_and_login():
    user = {
        "auth_source": "local",
        "email": "User@Example.test",
        "mailbox_email": "",
        "mailbox_login": " Login@Example.test ",
    }

    assert profile_model.mail_auth_mode_for_user(user) == "manual"
    assert (
        profile_model.build_effective_mailbox_email(
            user,
            ldap_email_builder=lambda username: f"{username}@ldap.test",
        )
        == "user@example.test"
    )
    assert (
        profile_model.build_effective_mailbox_login(
            user,
            exchange_login_normalizer=lambda username: f"{username}@corp.test",
        )
        == "login@example.test"
    )


def test_profile_model_resolves_ldap_defaults_and_session_login():
    user = {
        "id": 42,
        "auth_source": "ldap",
        "username": "Ivanov_II",
        "email": "",
        "mailbox_email": "",
        "mailbox_login": "ignored@example.test",
    }

    assert profile_model.mail_auth_mode_for_user(user) == "ad_auto"
    assert profile_model.legacy_user_mailbox_auth_mode(user) == "primary_session"
    assert (
        profile_model.build_effective_mailbox_email(
            user,
            ldap_email_builder=lambda username: f"{str(username).lower().replace('_', '.')}@zsgp.ru",
        )
        == "ivanov.ii@zsgp.ru"
    )
    assert (
        profile_model.build_effective_mailbox_login(
            user,
            session_context={"exchange_login": "Ivanov_II@Corp.test"},
            exchange_login_normalizer=lambda username: f"{username}@corp.test",
        )
        == "ivanov_ii@corp.test"
    )


def test_profile_model_resolves_ldap_login_from_username_without_session():
    user = {
        "id": 42,
        "auth_source": "ldap",
        "username": "Ivanov_II",
    }

    assert (
        profile_model.build_effective_mailbox_login(
            user,
            session_context=None,
            exchange_login_normalizer=lambda username: f"{username}@corp.test",
        )
        == "ivanov_ii@corp.test"
    )


def test_mail_service_profile_wrappers_preserve_session_lookup(monkeypatch):
    service = mail_module.MailService.__new__(mail_module.MailService)
    user = {"id": 7, "auth_source": "ldap", "username": "petrov_pp"}
    calls = []

    monkeypatch.setattr(mail_module, "get_request_session_id", lambda: "sess-7")
    monkeypatch.setattr(
        mail_module.session_auth_context_service,
        "get_session_context",
        lambda session_id, user_id=None: calls.append((session_id, user_id)) or {"exchange_login": "petrov@corp.test"},
    )

    assert service._mail_auth_mode_for_user(user) == "ad_auto"
    assert service._legacy_user_mail_auth_mode(user) == "primary_session"
    assert service._build_effective_mailbox_login(user) == "petrov@corp.test"
    assert calls == [("sess-7", 7)]
