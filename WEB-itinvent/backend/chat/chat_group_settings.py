"""Per-group settings kept in their own table (``chat_group_settings``).

A separate table keeps ``chat_conversations`` untouched, so the code is safe to
deploy before the migration runs: until the table exists every group behaves as
before (everyone may write, no description) and saving settings answers with a
clear 400 instead of breaking the chat.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from sqlalchemy import select

from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES
from backend.chat.models import ChatGroupSettings, ChatMember
from backend.chat.utils import normalize_text as _normalize_text

POSTING_POLICY_ALL = "all"
POSTING_POLICY_MANAGERS = "managers"
# Closed group: nobody writes (the owner reopens it); reading and leaving stay possible.
POSTING_POLICY_CLOSED = "closed"
POSTING_POLICIES = {POSTING_POLICY_ALL, POSTING_POLICY_MANAGERS, POSTING_POLICY_CLOSED}
DESCRIPTION_MAX_LENGTH = 1000

_TABLE_RECHECK_SEC = 30.0
_POLICY_CACHE_TTL_SEC = 5.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}
_policy_cache: dict[str, tuple[float, str]] = {}


def default_settings() -> dict:
    return {"description": None, "posting_policy": POSTING_POLICY_ALL}


def reset_runtime_state() -> None:
    """Forget the cached table probe and policies (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0
        _policy_cache.clear()


def settings_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatGroupSettings.conversation_id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def load_group_settings(session, conversation_id: str) -> dict:
    settings = default_settings()
    if not settings_table_available(session):
        return settings
    row = session.get(ChatGroupSettings, _normalize_text(conversation_id))
    if row is None:
        return settings
    settings["description"] = _normalize_text(row.description) or None
    policy = _normalize_text(row.posting_policy) or POSTING_POLICY_ALL
    settings["posting_policy"] = policy if policy in POSTING_POLICIES else POSTING_POLICY_ALL
    return settings


def load_group_posting_policies(session, conversation_ids) -> dict[str, str]:
    """Posting rule of many groups in one query (conversation list); {} while the table is missing."""
    ids = sorted({_normalize_text(item) for item in conversation_ids if _normalize_text(item)})
    if not ids or not settings_table_available(session):
        return {}
    rows = session.execute(
        select(ChatGroupSettings.conversation_id, ChatGroupSettings.posting_policy).where(
            ChatGroupSettings.conversation_id.in_(ids)
        )
    ).all()
    policies = {conversation_id: POSTING_POLICY_ALL for conversation_id in ids}
    for conversation_id, policy in rows:
        normalized = _normalize_text(policy) or POSTING_POLICY_ALL
        policies[conversation_id] = normalized if normalized in POSTING_POLICIES else POSTING_POLICY_ALL
    return policies


def save_group_settings(
    session,
    conversation_id: str,
    *,
    description: Optional[str] = None,
    posting_policy: Optional[str] = None,
    updated_by_user_id: int = 0,
) -> dict:
    """Upsert the provided fields; ``None`` leaves a field unchanged."""
    if not settings_table_available(session):
        raise ValueError("Настройки группы станут доступны после обновления базы данных")
    normalized_id = _normalize_text(conversation_id)
    row = session.get(ChatGroupSettings, normalized_id)
    if row is None:
        row = ChatGroupSettings(
            conversation_id=normalized_id,
            posting_policy=POSTING_POLICY_ALL,
        )
        session.add(row)
    if description is not None:
        normalized_description = _normalize_text(description)
        if len(normalized_description) > DESCRIPTION_MAX_LENGTH:
            raise ValueError(f"Описание не длиннее {DESCRIPTION_MAX_LENGTH} символов")
        row.description = normalized_description or None
    if posting_policy is not None:
        normalized_policy = _normalize_text(posting_policy).lower()
        if normalized_policy not in POSTING_POLICIES:
            raise ValueError("Unknown posting policy")
        row.posting_policy = normalized_policy
    if int(updated_by_user_id or 0) > 0:
        row.updated_by_user_id = int(updated_by_user_id)
    session.flush()
    with _lock:
        _policy_cache.pop(normalized_id, None)
    return {
        "description": _normalize_text(row.description) or None,
        "posting_policy": _normalize_text(row.posting_policy) or POSTING_POLICY_ALL,
    }


def _cached_posting_policy(session, conversation_id: str) -> str:
    now = time.monotonic()
    with _lock:
        cached = _policy_cache.get(conversation_id)
        if cached is not None and now - cached[0] < _POLICY_CACHE_TTL_SEC:
            return cached[1]
    policy = load_group_settings(session, conversation_id)["posting_policy"]
    with _lock:
        _policy_cache[conversation_id] = (now, policy)
    return policy


def enforce_group_posting_policy(
    session,
    conversation,
    current_user_id: int,
    *,
    check_slow_mode: bool = True,
) -> None:
    """Raise PermissionError when a plain member writes into a managers-only or closed group, and
    ChatSlowModeError when the group's slow mode has not elapsed (not checked when planning a send)."""
    if _normalize_text(getattr(conversation, "kind", None)) != "group":
        return
    conversation_id = _normalize_text(getattr(conversation, "id", None))
    if not conversation_id:
        return
    from backend.chat.chat_group_restrictions import enforce_not_restricted

    enforce_not_restricted(session, conversation, int(current_user_id))
    policy = _cached_posting_policy(session, conversation_id)
    if policy == POSTING_POLICY_CLOSED:
        raise PermissionError("Группа закрыта: писать в неё нельзя")
    if policy == POSTING_POLICY_MANAGERS:
        role = session.execute(
            select(ChatMember.member_role).where(
                ChatMember.conversation_id == conversation_id,
                ChatMember.user_id == int(current_user_id),
                ChatMember.left_at.is_(None),
            )
        ).scalar_one_or_none()
        if _normalize_text(role).lower() not in CHAT_GROUP_MANAGER_ROLES:
            raise PermissionError("В этой группе писать могут только владелец и модераторы")
    if check_slow_mode:
        from backend.chat.chat_group_limits import enforce_slow_mode

        enforce_slow_mode(session, conversation, int(current_user_id))
