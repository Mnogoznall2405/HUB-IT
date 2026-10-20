"""Unified employee photos keyed by ZUP employee_code.

Single storage ``{data_dir}/employee_photos/{urlquoted_code}.jpg`` feeds the
address book, mail sender/recipient avatars and org-structure cards, so one
portal photo covers every place where a person is shown.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

_SAFE_CODE_RE = re.compile(r"^[\w\-]{1,64}$", re.UNICODE)
PHOTO_URL_PREFIX = "/api/v1/address-book/photos"


def _photos_dir() -> Path:
    from backend.services.hub_service import hub_service
    photos_dir = Path(hub_service.data_dir) / "employee_photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    return photos_dir


def _normalize_code(value: Any) -> str:
    return str(value or "").strip()


def is_safe_employee_code(code: Any) -> bool:
    return bool(_SAFE_CODE_RE.match(_normalize_code(code)))


def employee_photo_file(code: Any) -> Path | None:
    """Return the stored photo path for an employee code, or None."""
    normalized = _normalize_code(code)
    if not is_safe_employee_code(normalized):
        return None
    path = _photos_dir() / f"{quote(normalized, safe='')}.jpg"
    return path if path.is_file() else None


def employee_photo_url(code: Any) -> str | None:
    """Public URL of the employee photo, or None when no photo is stored."""
    normalized = _normalize_code(code)
    if not normalized or employee_photo_file(normalized) is None:
        return None
    return f"{PHOTO_URL_PREFIX}/{quote(normalized, safe='')}"


class EmployeePhotoResolver:
    """Email -> photo URL resolver for mail/chat serializers.

    Hub user avatars win over the shared employee photo so a user's own
    uploaded avatar stays authoritative. The address-book index is rebuilt at
    most every ``cache_ttl_sec`` seconds.
    """

    def __init__(self, *, cache_ttl_sec: float = 300.0) -> None:
        self._cache_ttl_sec = max(float(cache_ttl_sec), 1.0)
        self._cache_lock = threading.Lock()
        self._cached_index: tuple[float, dict[str, str]] | None = None

    @staticmethod
    def _normalize_email(value: Any) -> str:
        return str(value or "").strip().lower()

    def _build_index(self) -> dict[str, str]:
        index: dict[str, str] = {}
        # 1) Address book: work e-mail -> employee photo (canonical ZUP photo).
        try:
            from backend.services.address_book_service import address_book_service
            cache = address_book_service.load_cache()
            for item in (cache or {}).get("items") or []:
                if not isinstance(item, dict):
                    continue
                url = employee_photo_url(item.get("employee_code"))
                if not url:
                    continue
                for entry in item.get("work_emails") or []:
                    if not isinstance(entry, dict):
                        continue
                    email = self._normalize_email(entry.get("normalized") or entry.get("value"))
                    if email and "@" in email:
                        index.setdefault(email, url)
        except Exception:
            logger.exception("Unable to build employee photo index from address book")
        # 2) Hub users: their avatar_url (custom uploads included) takes priority.
        try:
            from backend.services.user_service import user_service
            for user in user_service.list_users():
                url = self._normalize_email(user.get("avatar_url")) or str(user.get("avatar_url") or "").strip()
                if not url:
                    continue
                for field in ("email", "mailbox_email", "mailbox_login", "username"):
                    email = self._normalize_email(user.get(field))
                    if email and "@" in email:
                        index[email] = url
        except Exception:
            logger.exception("Unable to build employee photo index from hub users")
        return index

    def _get_index(self) -> dict[str, str]:
        now = time.monotonic()
        cached = self._cached_index
        if cached is not None and cached[0] > now:
            return cached[1]
        with self._cache_lock:
            cached = self._cached_index
            if cached is not None and cached[0] > now:
                return cached[1]
            index = self._build_index()
            self._cached_index = (now + self._cache_ttl_sec, index)
            return index

    def url_for_email(self, email: Any) -> str | None:
        normalized = self._normalize_email(email)
        if not normalized or "@" not in normalized:
            return None
        return self._get_index().get(normalized)

    def attach_to_person(self, person: dict[str, Any] | None) -> dict[str, Any] | None:
        """Add ``avatar_url`` to a serialized person dict (name/email/display)."""
        if not isinstance(person, dict):
            return person
        person["avatar_url"] = self.url_for_email(person.get("email"))
        return person


employee_photo_resolver = EmployeePhotoResolver()
