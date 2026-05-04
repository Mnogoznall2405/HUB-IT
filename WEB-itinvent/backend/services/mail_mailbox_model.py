from __future__ import annotations

from datetime import datetime
from typing import Any


def normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class MailboxSelectionError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = int(status_code or 400)


def build_legacy_mailbox_seed(
    user: dict[str, Any] | None,
    *,
    mailbox_email: str,
    auth_mode: str,
    now_iso: str,
    default_label: str,
) -> dict[str, Any] | None:
    if not user:
        return None
    normalized_email = normalize_text(mailbox_email).lower()
    if not normalized_email:
        return None
    return {
        "id": f"legacy-{int(user.get('id') or 0)}",
        "user_id": int(user.get("id") or 0),
        "label": normalize_text(user.get("mailbox_email") or user.get("email") or normalized_email) or default_label,
        "mailbox_email": normalized_email,
        "mailbox_login": normalize_text(user.get("mailbox_login")) or None,
        "mailbox_password_enc": normalize_text(user.get("mailbox_password_enc")),
        "auth_mode": normalize_text(auth_mode, "stored_credentials"),
        "is_primary": True,
        "is_active": True,
        "sort_order": 0,
        "last_selected_at": None,
        "created_at": normalize_text(user.get("created_at")) or now_iso,
        "updated_at": normalize_text(user.get("updated_at")) or now_iso,
    }


def primary_mailbox_row(
    rows: list[dict[str, Any]],
    *,
    allow_inactive: bool = True,
) -> dict[str, Any] | None:
    for row in rows:
        if not to_bool(row.get("is_primary"), default=False):
            continue
        if not allow_inactive and not to_bool(row.get("is_active"), default=True):
            continue
        return row
    return None


def select_mailbox_row(
    rows: list[dict[str, Any]],
    *,
    mailbox_id: str | None = None,
    allow_inactive: bool = False,
) -> dict[str, Any]:
    if not rows:
        raise MailboxSelectionError("Mailbox email is not configured")
    normalized_mailbox_id = normalize_text(mailbox_id)
    if normalized_mailbox_id:
        for row in rows:
            if normalize_text(row.get("id")) == normalized_mailbox_id:
                if not allow_inactive and not to_bool(row.get("is_active"), default=False):
                    raise MailboxSelectionError("Mailbox is inactive", status_code=409)
                return row
        raise MailboxSelectionError("Mailbox not found", status_code=404)

    def _row_sort_key(row: dict[str, Any]) -> tuple[int, float, int, int]:
        is_active = 1 if to_bool(row.get("is_active"), default=True) else 0
        last_selected_raw = normalize_text(row.get("last_selected_at"))
        try:
            last_selected = datetime.fromisoformat(last_selected_raw.replace("Z", "+00:00")).timestamp() if last_selected_raw else 0.0
        except Exception:
            last_selected = 0.0
        return (
            is_active,
            last_selected,
            1 if to_bool(row.get("is_primary"), default=False) else 0,
            -int(row.get("sort_order") or 0),
        )

    candidates = rows if allow_inactive else [row for row in rows if to_bool(row.get("is_active"), default=True)]
    if not candidates:
        raise MailboxSelectionError("Mailbox is inactive", status_code=409)
    return sorted(candidates, key=_row_sort_key, reverse=True)[0]


def next_mailbox_sort_order(rows: list[dict[str, Any]]) -> int:
    return max([int(item.get("sort_order") or 0) for item in rows] or [0]) + 1


def has_duplicate_mailbox_email(
    rows: list[dict[str, Any]],
    *,
    mailbox_email: str,
    exclude_mailbox_id: str = "",
) -> bool:
    normalized_email = normalize_text(mailbox_email).lower()
    excluded_id = normalize_text(exclude_mailbox_id)
    return any(
        normalize_text(item.get("id")) != excluded_id
        and normalize_text(item.get("mailbox_email")).lower() == normalized_email
        for item in rows
    )


def serialize_mailbox_entry(
    *,
    user: dict[str, Any],
    mailbox_row: dict[str, Any],
    profile: dict[str, Any],
    signature_html: str | None,
    unread_count: int = 0,
    unread_count_state: str = "deferred",
    selected: bool = False,
) -> dict[str, Any]:
    return {
        "id": profile["mailbox_id"],
        "label": profile["label"],
        "mailbox_email": profile["email"],
        "mailbox_login": normalize_text(mailbox_row.get("mailbox_login")) or None,
        "effective_mailbox_login": profile["login"] or None,
        "auth_mode": normalize_text(mailbox_row.get("auth_mode"), "stored_credentials"),
        "mail_auth_mode": profile["mail_auth_mode"],
        "is_primary": bool(profile["is_primary"]),
        "is_active": bool(profile["is_active"]),
        "is_selected": bool(selected),
        "mail_requires_password": bool(profile["mail_requires_password"]),
        "mail_requires_relogin": bool(profile["mail_requires_relogin"]),
        "mail_is_configured": bool(profile["mail_is_configured"]),
        "mail_signature_html": signature_html or None,
        "unread_count": max(0, int(unread_count or 0)),
        "unread_count_state": normalize_text(unread_count_state, "deferred"),
        "last_selected_at": normalize_text(mailbox_row.get("last_selected_at")) or None,
        "sort_order": int(mailbox_row.get("sort_order") or 0),
        "mail_updated_at": normalize_text(user.get("mail_updated_at")) or None,
    }
