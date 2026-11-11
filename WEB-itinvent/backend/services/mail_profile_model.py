from __future__ import annotations

from typing import Any, Callable


MAILBOX_AUTH_MODES = {"stored_credentials", "primary_session", "primary_credentials"}


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def normalize_mailbox_auth_mode(value: Any, default: str = "stored_credentials") -> str:
    mode = normalize_text(value, default).lower()
    if mode in MAILBOX_AUTH_MODES:
        return mode
    return default


def mail_auth_mode_for_user(user: dict[str, Any] | None) -> str:
    auth_source = normalize_text((user or {}).get("auth_source"), "local").lower()
    return "ad_auto" if auth_source == "ldap" else "manual"


def legacy_user_mailbox_auth_mode(user: dict[str, Any] | None) -> str:
    if normalize_text((user or {}).get("mailbox_password_enc")):
        return "stored_credentials"
    return "primary_session" if mail_auth_mode_for_user(user) == "ad_auto" else "stored_credentials"


def build_effective_mailbox_email(
    user: dict[str, Any] | None,
    *,
    ldap_email_builder: Callable[[str | None], str],
) -> str:
    effective = normalize_text((user or {}).get("mailbox_email") or (user or {}).get("email")).lower()
    if effective:
        return effective
    if normalize_text((user or {}).get("auth_source"), "local").lower() == "ldap":
        return ldap_email_builder((user or {}).get("username"))
    return ""


def build_effective_mailbox_login(
    user: dict[str, Any] | None,
    *,
    session_context: dict[str, Any] | None = None,
    exchange_login_normalizer: Callable[[str], str],
) -> str:
    if normalize_text((user or {}).get("auth_source"), "local").lower() == "ldap":
        session_login = normalize_text((session_context or {}).get("exchange_login")).lower()
        if session_login:
            return session_login
        username = normalize_text((user or {}).get("username")).lower()
        return exchange_login_normalizer(username) if username else ""

    explicit_login = normalize_text((user or {}).get("mailbox_login")).lower()
    if explicit_login:
        return explicit_login
    return normalize_text((user or {}).get("mailbox_email") or (user or {}).get("email")).lower()
