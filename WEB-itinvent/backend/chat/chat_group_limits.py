"""Per-group limits kept in their own table (``chat_group_limits``): slow mode.

Like ``chat_group_settings`` the table is created by an explicit release migration; until it exists
every group behaves as before (no limit) and saving a limit answers with a clear 400, so the chat
process is never affected by deploying the code before the migration.

Slow mode: a plain member may send one message per ``slow_mode_seconds``; the owner and moderators
are exempt. The check reads the member's latest message in the conversation, so it works across
several chat nodes without shared state. It runs inside the send path without the conversation write
lock, so two parallel sends of one member can both pass: slow mode is a soft limit, not a quota.
"""
from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select

from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES
from backend.chat.models import ChatGroupLimits, ChatMember, ChatMessage
from backend.chat.utils import normalize_text as _normalize_text

# Telegram-like steps; 0 is "off".
SLOW_MODE_STEPS = (0, 10, 30, 60, 300, 900, 3600)

_TABLE_RECHECK_SEC = 30.0
_CACHE_TTL_SEC = 5.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}
_cache: dict[str, tuple[float, int]] = {}


class ChatSlowModeError(ValueError):
    """The member writes too often; answered as HTTP 429 with Retry-After."""

    def __init__(self, retry_after_sec: int, slow_mode_seconds: int):
        self.retry_after_sec = max(1, int(retry_after_sec))
        self.slow_mode_seconds = int(slow_mode_seconds)
        super().__init__(f"Медленный режим: следующее сообщение можно отправить через {self.retry_after_sec} с")


def reset_runtime_state() -> None:
    """Forget the cached table probe and limits (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0
        _cache.clear()


def limits_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatGroupLimits.conversation_id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def _normalize_seconds(value) -> int:
    try:
        seconds = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return seconds if seconds in SLOW_MODE_STEPS else 0


def load_slow_mode_seconds(session, conversation_id: str) -> int:
    normalized_id = _normalize_text(conversation_id)
    if not normalized_id or not limits_table_available(session):
        return 0
    now = time.monotonic()
    with _lock:
        cached = _cache.get(normalized_id)
        if cached is not None and now - cached[0] < _CACHE_TTL_SEC:
            return cached[1]
    value = session.execute(
        select(ChatGroupLimits.slow_mode_seconds).where(ChatGroupLimits.conversation_id == normalized_id)
    ).scalar_one_or_none()
    seconds = _normalize_seconds(value)
    with _lock:
        _cache[normalized_id] = (now, seconds)
    return seconds


def load_slow_modes_many(session, conversation_ids) -> dict[str, int]:
    """Slow mode of many groups in one query (conversation list); {} while the table is missing."""
    ids = sorted({_normalize_text(item) for item in conversation_ids if _normalize_text(item)})
    if not ids or not limits_table_available(session):
        return {}
    rows = session.execute(
        select(ChatGroupLimits.conversation_id, ChatGroupLimits.slow_mode_seconds).where(
            ChatGroupLimits.conversation_id.in_(ids)
        )
    ).all()
    result = {conversation_id: 0 for conversation_id in ids}
    for conversation_id, seconds in rows:
        result[conversation_id] = _normalize_seconds(seconds)
    return result


def save_slow_mode(session, conversation_id: str, seconds: int, *, updated_by_user_id: int = 0) -> int:
    if not limits_table_available(session):
        raise ValueError("Медленный режим станет доступен после обновления базы данных")
    normalized = int(seconds)
    if normalized not in SLOW_MODE_STEPS:
        raise ValueError("Недопустимое значение медленного режима")
    normalized_id = _normalize_text(conversation_id)
    row = session.get(ChatGroupLimits, normalized_id)
    if row is None:
        row = ChatGroupLimits(conversation_id=normalized_id, slow_mode_seconds=0)
        session.add(row)
    row.slow_mode_seconds = normalized
    if int(updated_by_user_id or 0) > 0:
        row.updated_by_user_id = int(updated_by_user_id)
    session.flush()
    # The writer reads its own value back at once; ``forget`` drops it after the commit.
    with _lock:
        _cache[normalized_id] = (time.monotonic(), normalized)
    return normalized


def forget(conversation_id: str) -> None:
    """Drop the cached value once the change is committed so every reader loads the committed one."""
    with _lock:
        _cache.pop(_normalize_text(conversation_id), None)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def enforce_slow_mode(session, conversation, current_user_id: int) -> None:
    """Raise ChatSlowModeError when a plain member writes sooner than the group allows."""
    if _normalize_text(getattr(conversation, "kind", None)) != "group":
        return
    conversation_id = _normalize_text(getattr(conversation, "id", None))
    if not conversation_id:
        return
    seconds = load_slow_mode_seconds(session, conversation_id)
    if seconds <= 0:
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
    now = datetime.now(timezone.utc)
    last_sent: Optional[datetime] = session.execute(
        select(func.max(ChatMessage.created_at)).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.sender_user_id == int(current_user_id),
            ChatMessage.kind != "system",
            ChatMessage.created_at >= now - timedelta(seconds=seconds),
        )
    ).scalar()
    if last_sent is None:
        return
    elapsed = (now - _aware(last_sent)).total_seconds()
    remaining = math.ceil(seconds - elapsed)
    if remaining > 0:
        raise ChatSlowModeError(remaining, seconds)
