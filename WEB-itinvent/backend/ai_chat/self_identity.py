"""Who is "me" for self-service AI tools.

Self-service tools (``me.*``, ``helpdesk.*``) must answer only about the employee who
asks. The identity is always taken from the portal account of the run — never from
tool arguments — and is matched exactly, never by a fuzzy search:

- ITinvent owner: exact OWNER_EMAIL match with the account e-mail (or mailbox e-mail);
  if there is none, an exact OWNER_DISPLAY_NAME match with the full name. Anything but
  exactly one candidate is treated as "not resolved" — a namesake must never get
  someone else's equipment.
- AD login: the portal username of an LDAP account (auth_source == "ldap").
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)

OWNER_MATCH_EMAIL = "email"
OWNER_MATCH_NAME = "name"
OWNER_MATCH_NONE = "none"
OWNER_MATCH_AMBIGUOUS = "ambiguous"
OWNER_MATCH_ERROR = "error"


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def normalize_login(value: object) -> str:
    """'DOMAIN\\Login' / 'login@domain' -> 'login' (lowercase) for exact comparison."""
    text = _normalize_text(value).lower()
    if "\\" in text:
        text = text.rsplit("\\", 1)[-1]
    if "@" in text:
        text = text.split("@", 1)[0]
    return text


@dataclass(frozen=True)
class SelfIdentity:
    user_id: int
    full_name: Optional[str]
    emails: tuple[str, ...]
    ad_login: Optional[str]
    database_id: Optional[str]
    owner_no: Optional[int]
    owner_match: str

    @property
    def owner_resolved(self) -> bool:
        return self.owner_no is not None


def resolve_self_identity(context: Any) -> SelfIdentity:
    from backend.services.user_service import user_service

    user_id = int(getattr(context, "user_id", 0) or 0)
    user = None
    try:
        user = user_service.get_by_id(user_id) if user_id > 0 else None
    except Exception as exc:
        logger.warning("self_identity user lookup failed: user_id=%s error=%s", user_id, type(exc).__name__)
    user = user if isinstance(user, dict) else {}
    full_name = " ".join(_normalize_text(user.get("full_name")).split()) or None
    emails = tuple(
        dict.fromkeys(
            item.lower()
            for item in (_normalize_text(user.get("email")), _normalize_text(user.get("mailbox_email")))
            if "@" in item
        )
    )
    ad_login = (
        normalize_login(user.get("username"))
        if _normalize_text(user.get("auth_source")).lower() == "ldap"
        else None
    ) or None
    database_id = _normalize_text(getattr(context, "effective_database_id", None)) or None

    owner_no: Optional[int] = None
    owner_match = OWNER_MATCH_NONE
    if database_id and (emails or full_name):
        try:
            owner_no, owner_match = _match_owner(emails=emails, full_name=full_name, database_id=database_id)
        except Exception as exc:
            logger.warning("self_identity owner lookup failed: user_id=%s error=%s", user_id, type(exc).__name__)
            owner_no, owner_match = None, OWNER_MATCH_ERROR
    return SelfIdentity(
        user_id=user_id,
        full_name=full_name,
        emails=emails,
        ad_login=ad_login,
        database_id=database_id,
        owner_no=owner_no,
        owner_match=owner_match,
    )


def _match_owner(*, emails: tuple[str, ...], full_name: Optional[str], database_id: str) -> tuple[Optional[int], str]:
    from backend.database import queries

    by_email: set[int] = set()
    by_name: set[int] = set()
    for index, email in enumerate(emails or (None,)):
        found = queries.find_owner_nos_by_identity(
            email=email,
            display_name=full_name if index == 0 else None,
            db_id=database_id,
        )
        by_email.update(found.get("email") or [])
        by_name.update(found.get("name") or [])
    if len(by_email) == 1:
        return next(iter(by_email)), OWNER_MATCH_EMAIL
    if len(by_email) > 1:
        return None, OWNER_MATCH_AMBIGUOUS
    if len(by_name) == 1:
        return next(iter(by_name)), OWNER_MATCH_NAME
    if len(by_name) > 1:
        return None, OWNER_MATCH_AMBIGUOUS
    return None, OWNER_MATCH_NONE
