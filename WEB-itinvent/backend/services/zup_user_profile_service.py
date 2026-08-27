"""Safe HUB user to ZUP workplace profile resolution."""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from typing import Any

from backend.services.address_book_service import (
    address_book_service,
    normalize_email,
    normalize_search_text,
    normalize_text,
)


logger = logging.getLogger(__name__)


class ZupUserProfileService:
    """Resolve only non-personal workplace fields from the ZUP address cache.

    Matching order is intentionally strict: full corporate email, corporate
    email login, then a unique exact full name. Ambiguous identities are not
    resolved so one employee can never inherit another employee's profile.
    """

    def __init__(self, source_service: Any = None, *, cache_ttl_sec: float = 300.0) -> None:
        self._source_service = source_service or address_book_service
        self._cache_ttl_sec = max(float(cache_ttl_sec), 1.0)
        self._cache_lock = threading.Lock()
        self._cached_index: tuple[float, dict[str, Any]] | None = None

    @staticmethod
    def _account_login(value: Any) -> str:
        normalized = normalize_email(normalize_text(value))
        if not normalized:
            return ""
        if "\\" in normalized:
            normalized = normalized.rsplit("\\", 1)[-1]
        if "/" in normalized and "@" not in normalized:
            normalized = normalized.rsplit("/", 1)[-1]
        return normalized.split("@", 1)[0].strip()

    @staticmethod
    def _unique_profile(index: dict[str, list[dict[str, Any]]], keys: set[str]) -> dict[str, Any] | None:
        candidates: dict[str, dict[str, Any]] = {}
        for key in keys:
            for candidate in index.get(key, []):
                candidates[str(candidate["identity_key"])] = candidate
        if len(candidates) != 1:
            return None
        return dict(next(iter(candidates.values()))["profile"])

    @staticmethod
    def _first_work_contact(items: Any) -> str | None:
        if not isinstance(items, list):
            return None
        for item in items:
            if not isinstance(item, dict):
                continue
            value = normalize_text(item.get("value") or item.get("normalized"))
            if value:
                return value
        return None

    def _build_index(self) -> dict[str, Any]:
        try:
            cache = self._source_service.load_cache()
        except Exception:
            logger.exception("Unable to load ZUP address-book cache for chat profiles")
            cache = {}
        if not isinstance(cache, dict):
            cache = {}

        updated_at = normalize_text(cache.get("updated_at")) or None
        email_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
        login_index: dict[str, list[dict[str, Any]]] = defaultdict(list)
        name_index: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for row_number, item in enumerate(cache.get("items") or []):
            if not isinstance(item, dict):
                continue
            employee_code = normalize_text(item.get("employee_code"))
            full_name = normalize_search_text(item.get("full_name"))
            identity_key = employee_code or f"row:{row_number}"
            candidate = {
                "identity_key": identity_key,
                "profile": {
                    "job_title": normalize_text(item.get("position")) or None,
                    "department": normalize_text(item.get("department")) or None,
                    "city": normalize_text(item.get("department_location")) or None,
                    "corporate_email": self._first_work_contact(item.get("work_emails")),
                    "corporate_phone": self._first_work_contact(item.get("work_phones")),
                    "source": "zup",
                    "updated_at": updated_at,
                },
            }
            if full_name:
                name_index[full_name].append(candidate)
            for email_item in item.get("work_emails") or []:
                if not isinstance(email_item, dict):
                    continue
                email = normalize_email(email_item.get("normalized") or email_item.get("value"))
                if not email or "@" not in email:
                    continue
                email_index[email].append(candidate)
                login = self._account_login(email)
                if login:
                    login_index[login].append(candidate)

        return {
            "email": dict(email_index),
            "login": dict(login_index),
            "name": dict(name_index),
        }

    def _get_index(self) -> dict[str, Any]:
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

    def resolve_user(self, user: dict[str, Any] | None) -> dict[str, Any] | None:
        if not isinstance(user, dict):
            return None
        index = self._get_index()

        emails = {
            normalize_email(user.get(field))
            for field in ("email", "mailbox_email", "mailbox_login", "username")
            if "@" in normalize_email(user.get(field))
        }
        profile = self._unique_profile(index["email"], emails)
        if profile is not None:
            return profile

        logins = {
            self._account_login(user.get(field))
            for field in ("username", "mailbox_login", "email", "mailbox_email")
            if self._account_login(user.get(field))
        }
        profile = self._unique_profile(index["login"], logins)
        if profile is not None:
            return profile

        full_name = normalize_search_text(user.get("full_name"))
        if not full_name:
            return None
        return self._unique_profile(index["name"], {full_name})


zup_user_profile_service = ZupUserProfileService()
