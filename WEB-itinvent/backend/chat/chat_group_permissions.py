"""Permission flags of a group (``chat_group_permissions``): may plain members send files.

Like the other group tables it arrives with an explicit release migration; until it exists every
member may send files and saving the flag answers with a clear 400, so deploying the code before the
migration never affects the chat process. The owner and moderators are never limited. The check on
the send path reads one cached flag per conversation (5 s), and looks the member's role up only when
files are actually forbidden.
"""
from __future__ import annotations

import threading
import time

from sqlalchemy import select

from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES
from backend.chat.models import ChatGroupPermissions, ChatMember
from backend.chat.utils import normalize_text as _normalize_text

FILES_FORBIDDEN_MESSAGE = "В этой группе файлы могут отправлять только владелец и модераторы"

_TABLE_RECHECK_SEC = 30.0
_CACHE_TTL_SEC = 5.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}
_cache: dict[str, tuple[float, bool]] = {}


def reset_runtime_state() -> None:
    """Forget the cached table probe and flags (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0
        _cache.clear()


def permissions_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatGroupPermissions.conversation_id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def load_members_send_files(session, conversation_id: str) -> bool:
    """True while plain members may send files (the default, and while the table is missing)."""
    normalized_id = _normalize_text(conversation_id)
    if not normalized_id or not permissions_table_available(session):
        return True
    now = time.monotonic()
    with _lock:
        cached = _cache.get(normalized_id)
        if cached is not None and now - cached[0] < _CACHE_TTL_SEC:
            return cached[1]
    value = session.execute(
        select(ChatGroupPermissions.members_send_files).where(
            ChatGroupPermissions.conversation_id == normalized_id
        )
    ).scalar_one_or_none()
    allowed = True if value is None else bool(value)
    with _lock:
        _cache[normalized_id] = (now, allowed)
    return allowed


def load_members_send_files_many(session, conversation_ids) -> dict[str, bool]:
    """The flag of many groups in one query (conversation list); {} while the table is missing."""
    ids = sorted({_normalize_text(item) for item in conversation_ids if _normalize_text(item)})
    if not ids or not permissions_table_available(session):
        return {}
    rows = session.execute(
        select(ChatGroupPermissions.conversation_id, ChatGroupPermissions.members_send_files).where(
            ChatGroupPermissions.conversation_id.in_(ids)
        )
    ).all()
    result = {conversation_id: True for conversation_id in ids}
    for conversation_id, allowed in rows:
        result[conversation_id] = True if allowed is None else bool(allowed)
    return result


def save_members_send_files(session, conversation_id: str, allowed: bool, *, updated_by_user_id: int = 0) -> bool:
    if not permissions_table_available(session):
        raise ValueError("Права группы станут доступны после обновления базы данных")
    normalized_id = _normalize_text(conversation_id)
    row = session.get(ChatGroupPermissions, normalized_id)
    if row is None:
        row = ChatGroupPermissions(conversation_id=normalized_id, members_send_files=True)
        session.add(row)
    row.members_send_files = bool(allowed)
    if int(updated_by_user_id or 0) > 0:
        row.updated_by_user_id = int(updated_by_user_id)
    session.flush()
    # The writer reads its own value back at once; a concurrent reader that cannot see the
    # uncommitted change must not put the old one into the cache (see ``forget``, called after commit).
    with _lock:
        _cache[normalized_id] = (time.monotonic(), bool(allowed))
    return bool(allowed)


def forget(conversation_id: str) -> None:
    """Drop the cached flag once the change is committed so every reader loads the committed value."""
    with _lock:
        _cache.pop(_normalize_text(conversation_id), None)


def enforce_files_allowed(session, conversation, current_user_id: int) -> None:
    """Raise PermissionError when a plain member sends a file into a group that forbids it."""
    if _normalize_text(getattr(conversation, "kind", None)) != "group":
        return
    conversation_id = _normalize_text(getattr(conversation, "id", None))
    if not conversation_id or load_members_send_files(session, conversation_id):
        return
    role = session.execute(
        select(ChatMember.member_role).where(
            ChatMember.conversation_id == conversation_id,
            ChatMember.user_id == int(current_user_id),
            ChatMember.left_at.is_(None),
        )
    ).scalar_one_or_none()
    if _normalize_text(role).lower() in CHAT_GROUP_MANAGER_ROLES:
        return
    raise PermissionError(FILES_FORBIDDEN_MESSAGE)
