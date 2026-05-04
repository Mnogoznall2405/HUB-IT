from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

resolver_module = importlib.import_module("backend.services.mail_account_profile_resolver")


def _resolver(primary_row=None, *, session_context=None, session_password=""):
    return resolver_module.MailAccountProfileResolver(
        resolve_primary_mailbox_row=lambda **_kwargs: primary_row,
        normalize_mailbox_auth_mode=lambda value, default="stored_credentials": str(value or default).strip() or default,
        normalize_exchange_login=lambda username: f"{username}@corp.test" if username else "",
        decrypt_secret=lambda value: "primary-pass" if value == "primary-enc" else "",
        get_request_session_id=lambda: "sess-1",
        get_session_context=lambda _session_id, _user_id: session_context,
        resolve_session_password=lambda _session_id, _user_id: session_password,
        normalize_signature_html=lambda value: str(value or "").strip(),
    )


def test_account_profile_resolver_primary_credentials_uses_primary_password():
    resolver = _resolver(
        {
            "id": "primary",
            "auth_mode": "stored_credentials",
            "mailbox_email": "primary@example.test",
            "mailbox_login": "primary-login@example.test",
            "mailbox_password_enc": "primary-enc",
        }
    )

    profile = resolver.build_profile(
        user={"id": 7, "username": "ivanov"},
        mailbox_row={
            "id": "shared",
            "auth_mode": "primary_credentials",
            "mailbox_email": "shared@example.test",
            "mailbox_login": "",
            "label": "Shared",
            "is_primary": False,
            "is_active": True,
        },
        require_password=True,
    )

    assert profile["email"] == "shared@example.test"
    assert profile["login"] == "primary-login@example.test"
    assert profile["password"] == "primary-pass"
    assert profile["mail_auth_mode"] == "primary_credentials"


def test_account_profile_resolver_rejects_primary_credentials_self_reference():
    resolver = _resolver({"id": "same", "auth_mode": "stored_credentials", "mailbox_email": "same@example.test"})

    with pytest.raises(resolver_module.MailAccountProfileError, match="itself") as exc:
        resolver.resolve_primary_credentials(
            user={"id": 7, "username": "ivanov"},
            current_mailbox_id="same",
            require_password=True,
        )

    assert exc.value.status_code == 409


def test_account_profile_resolver_reports_missing_primary_password_flags_without_password_requirement():
    resolver = _resolver(
        {
            "id": "primary",
            "auth_mode": "stored_credentials",
            "mailbox_email": "primary@example.test",
            "mailbox_login": "",
            "mailbox_password_enc": "",
        }
    )

    profile = resolver.build_profile(
        user={"id": 7, "username": "ivanov"},
        mailbox_row={
            "id": "shared",
            "auth_mode": "primary_credentials",
            "mailbox_email": "shared@example.test",
            "mailbox_login": "",
            "is_primary": False,
            "is_active": True,
        },
        require_password=False,
    )

    assert profile["login"] == "ivanov@corp.test"
    assert profile["mail_requires_password"] is True
    assert profile["mail_requires_relogin"] is False
    assert profile["mail_is_configured"] is False


def test_account_profile_resolver_primary_session_requires_relogin_without_session_secret():
    resolver = _resolver(session_context=None, session_password="")

    with pytest.raises(resolver_module.MailAccountProfileError) as exc:
        resolver.build_profile(
            user={"id": 7, "username": "ivanov"},
            mailbox_row={
                "id": "primary",
                "auth_mode": "primary_session",
                "mailbox_email": "ivanov@example.test",
                "mailbox_login": "",
                "is_primary": True,
                "is_active": True,
            },
            require_password=True,
        )

    assert exc.value.code == "MAIL_RELOGIN_REQUIRED"
    assert exc.value.status_code == 409


def test_account_profile_resolver_primary_session_uses_session_login_and_flags_relogin():
    resolver = _resolver(session_context={"exchange_login": "ivanov@corp.test"}, session_password="")

    profile = resolver.build_profile(
        user={"id": 7, "username": "ivanov"},
        mailbox_row={
            "id": "primary",
            "auth_mode": "primary_session",
            "mailbox_email": "ivanov@example.test",
            "mailbox_login": "",
            "is_primary": True,
            "is_active": True,
        },
        require_password=False,
    )

    assert profile["login"] == "ivanov@corp.test"
    assert profile["mail_auth_mode"] == "ad_auto"
    assert profile["mail_requires_relogin"] is True
