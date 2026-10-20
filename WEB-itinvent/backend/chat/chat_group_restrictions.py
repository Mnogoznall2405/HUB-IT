"""Restrictions of single group members (``chat_group_restrictions``): the owner or a moderator takes
a member's right to write for a while or until it is lifted. The member still reads the group.

Like the other group tables it arrives with an explicit release migration; until it exists nobody is
restricted and restricting answers a clear 400, so the chat process is never affected by deploying
the code first. The sender check reads one small per-conversation set with a short cache, so the
send path pays one query per conversation per few seconds, and other nodes see a change within it.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select

from backend.chat.models import ChatGroupRestriction
from backend.chat.utils import normalize_text as _normalize_text

# Offered durations in seconds; None restricts until the restriction is lifted.
RESTRICTION_DURATIONS = (3600, 86400, 604800)

_TABLE_RECHECK_SEC = 30.0
_CACHE_TTL_SEC = 5.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}
_cache: dict[str, tuple[float, dict[int, Optional[datetime]]]] = {}


def reset_runtime_state() -> None:
    """Forget the cached table probe and restrictions (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0
        _cache.clear()


def restrictions_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatGroupRestriction.conversation_id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _is_active(until: Optional[datetime], now: datetime) -> bool:
    return until is None or _aware(until) > now


def load_restrictions(session, conversation_id: str) -> dict[int, Optional[datetime]]:
    """Active restrictions of a group: user id -> end (None: until lifted). {} without the table."""
    normalized_id = _normalize_text(conversation_id)
    if not normalized_id or not restrictions_table_available(session):
        return {}
    monotonic_now = time.monotonic()
    with _lock:
        cached = _cache.get(normalized_id)
        if cached is not None and monotonic_now - cached[0] < _CACHE_TTL_SEC:
            snapshot = cached[1]
        else:
            snapshot = None
    if snapshot is None:
        rows = session.execute(
            select(ChatGroupRestriction.user_id, ChatGroupRestriction.restricted_until).where(
                ChatGroupRestriction.conversation_id == normalized_id
            )
        ).all()
        snapshot = {int(user_id): until for user_id, until in rows}
        with _lock:
            _cache[normalized_id] = (monotonic_now, snapshot)
    now = datetime.now(timezone.utc)
    return {user_id: until for user_id, until in snapshot.items() if _is_active(until, now)}


def load_viewer_restrictions_many(session, conversation_ids, user_id: int) -> dict[str, Optional[datetime]]:
    """Active restrictions of one user across groups (conversation list), one query."""
    ids = sorted({_normalize_text(item) for item in conversation_ids if _normalize_text(item)})
    if not ids or not restrictions_table_available(session):
        return {}
    rows = session.execute(
        select(ChatGroupRestriction.conversation_id, ChatGroupRestriction.restricted_until).where(
            ChatGroupRestriction.user_id == int(user_id),
            ChatGroupRestriction.conversation_id.in_(ids),
        )
    ).all()
    now = datetime.now(timezone.utc)
    return {conversation_id: until for conversation_id, until in rows if _is_active(until, now)}


def set_restriction(
    session,
    conversation_id: str,
    user_id: int,
    *,
    duration_seconds: Optional[int],
    restricted_by_user_id: int,
) -> Optional[datetime]:
    if not restrictions_table_available(session):
        raise ValueError("Ограничения участников станут доступны после обновления базы данных")
    if duration_seconds is not None and int(duration_seconds) not in RESTRICTION_DURATIONS:
        raise ValueError("Недопустимая длительность ограничения")
    normalized_id = _normalize_text(conversation_id)
    until = (
        datetime.now(timezone.utc) + timedelta(seconds=int(duration_seconds))
        if duration_seconds is not None
        else None
    )
    row = session.get(ChatGroupRestriction, (normalized_id, int(user_id)))
    if row is None:
        row = ChatGroupRestriction(conversation_id=normalized_id, user_id=int(user_id))
        session.add(row)
    row.restricted_until = until
    row.restricted_by_user_id = int(restricted_by_user_id)
    session.flush()
    _store_snapshot(session, normalized_id)
    return until


def clear_restriction(session, conversation_id: str, user_id: int) -> bool:
    if not restrictions_table_available(session):
        raise ValueError("Ограничения участников станут доступны после обновления базы данных")
    normalized_id = _normalize_text(conversation_id)
    row = session.get(ChatGroupRestriction, (normalized_id, int(user_id)))
    if row is None:
        return False
    session.delete(row)
    session.flush()
    _store_snapshot(session, normalized_id)
    return True


def _store_snapshot(session, conversation_id: str) -> None:
    """The writer reads its own change back at once; ``forget`` drops it after the commit so a
    concurrent reader that could not see the change never leaves the old set cached."""
    rows = session.execute(
        select(ChatGroupRestriction.user_id, ChatGroupRestriction.restricted_until).where(
            ChatGroupRestriction.conversation_id == conversation_id
        )
    ).all()
    with _lock:
        _cache[conversation_id] = (time.monotonic(), {int(user_id): until for user_id, until in rows})


def forget(conversation_id: str) -> None:
    with _lock:
        _cache.pop(_normalize_text(conversation_id), None)


def format_until(until: Optional[datetime]) -> Optional[str]:
    aware = _aware(until)
    return aware.isoformat() if aware is not None else None


def enforce_not_restricted(session, conversation, current_user_id: int) -> None:
    """Raise PermissionError when the member's right to write in this group was taken away."""
    if _normalize_text(getattr(conversation, "kind", None)) != "group":
        return
    conversation_id = _normalize_text(getattr(conversation, "id", None))
    if not conversation_id:
        return
    restrictions = load_restrictions(session, conversation_id)
    if int(current_user_id) not in restrictions:
        return
    until = restrictions[int(current_user_id)]
    if until is None:
        raise PermissionError("Вам ограничена отправка сообщений в этой группе")
    raise PermissionError(
        "Вам ограничена отправка сообщений в этой группе до "
        f"{_aware(until).astimezone().strftime('%d.%m.%Y %H:%M')}"
    )
