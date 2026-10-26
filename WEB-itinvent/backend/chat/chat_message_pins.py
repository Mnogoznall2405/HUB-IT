"""Pinned messages of a conversation (``chat_message_pins``): several pins, newest first.

The table arrives with an explicit release migration. Until it exists the conversation keeps the single
legacy pin in ``chat_conversations.pinned_message_id`` (a new pin replaces it), so deploying the code
before the migration never affects the chat process. With the table, the legacy columns always mirror
the newest pin (``pinned_message_id``) and the time of the last change (``pinned_at``), which old
clients and the conversation list still read; clients refetch the full list when ``pinned_at`` changes.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

from sqlalchemy import delete, select

from backend.chat.models import ChatConversation, ChatMessage, ChatMessagePin
from backend.chat.utils import normalize_text as _normalize_text

MAX_PINNED_MESSAGES = 10
PIN_LIMIT_MESSAGE = f"Можно закрепить не больше {MAX_PINNED_MESSAGES} сообщений"

_TABLE_RECHECK_SEC = 30.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}


def reset_runtime_state() -> None:
    """Forget the cached table probe (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def pins_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatMessagePin.conversation_id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def _live_legacy_id(session, conversation: ChatConversation) -> str:
    legacy_id = _normalize_text(getattr(conversation, "pinned_message_id", None))
    if not legacy_id:
        return ""
    message = session.get(ChatMessage, legacy_id)
    if message is None or message.conversation_id != conversation.id or bool(getattr(message, "is_deleted", False)):
        return ""
    return legacy_id


def list_pin_ids(session, conversation: ChatConversation) -> list[str]:
    """Message ids pinned in the conversation, newest first; deleted messages are skipped."""
    legacy_id = _live_legacy_id(session, conversation)
    if not pins_table_available(session):
        return [legacy_id] if legacy_id else []
    rows = session.execute(
        select(ChatMessagePin.message_id)
        .join(ChatMessage, ChatMessage.id == ChatMessagePin.message_id)
        .where(
            ChatMessagePin.conversation_id == conversation.id,
            ChatMessage.is_deleted.is_(False),
        )
        .order_by(ChatMessagePin.pinned_at.desc(), ChatMessagePin.message_id.desc())
    ).scalars().all()
    ids = [str(item) for item in rows]
    # A pin made through the legacy column before the table was noticed still counts, as the newest.
    if legacy_id and legacy_id not in ids:
        ids.insert(0, legacy_id)
    return ids


def _sync_legacy_columns(session, conversation: ChatConversation, now) -> None:
    """Mirror the newest pin and the time of the change into the legacy columns."""
    ids = list_pin_ids(session, conversation)
    if not ids:
        conversation.pinned_message_id = None
        conversation.pinned_at = None
        conversation.pinned_by_user_id = None
        return
    newest = ids[0]
    pinned_by = session.execute(
        select(ChatMessagePin.pinned_by_user_id).where(
            ChatMessagePin.conversation_id == conversation.id,
            ChatMessagePin.message_id == newest,
        )
    ).scalar_one_or_none()
    conversation.pinned_message_id = newest
    conversation.pinned_at = now
    conversation.pinned_by_user_id = int(pinned_by) if pinned_by else None


def apply_pin(session, conversation: ChatConversation, message_id: str, user_id: int, now) -> None:
    """Pin a message (it becomes the newest pin); pinning an already pinned message changes nothing."""
    normalized_id = _normalize_text(message_id)
    if not pins_table_available(session):
        conversation.pinned_message_id = normalized_id
        conversation.pinned_at = now
        conversation.pinned_by_user_id = int(user_id)
        return
    ids = list_pin_ids(session, conversation)
    row = session.get(ChatMessagePin, (conversation.id, normalized_id))
    if normalized_id in ids and row is not None:
        return
    if normalized_id not in ids and len(ids) >= MAX_PINNED_MESSAGES:
        raise ValueError(PIN_LIMIT_MESSAGE)
    if row is None:
        session.add(
            ChatMessagePin(
                conversation_id=conversation.id,
                message_id=normalized_id,
                pinned_by_user_id=int(user_id),
                pinned_at=now,
            )
        )
    else:
        row.pinned_at = now
    session.flush()
    _sync_legacy_columns(session, conversation, now)


def apply_unpin(session, conversation: ChatConversation, message_id: Optional[str], now) -> bool:
    """Remove one pin (the newest one when ``message_id`` is empty); True when something was unpinned."""
    normalized_id = _normalize_text(message_id)
    if not pins_table_available(session):
        legacy_id = _normalize_text(getattr(conversation, "pinned_message_id", None))
        if not legacy_id or (normalized_id and normalized_id != legacy_id):
            return False
        conversation.pinned_message_id = None
        conversation.pinned_at = None
        conversation.pinned_by_user_id = None
        return True
    if not normalized_id:
        ids = list_pin_ids(session, conversation)
        if not ids:
            return False
        normalized_id = ids[0]
    deleted = session.execute(
        delete(ChatMessagePin).where(
            ChatMessagePin.conversation_id == conversation.id,
            ChatMessagePin.message_id == normalized_id,
        )
    ).rowcount or 0
    legacy_id = _normalize_text(getattr(conversation, "pinned_message_id", None))
    if not deleted and legacy_id != normalized_id:
        return False
    if legacy_id == normalized_id:
        conversation.pinned_message_id = None
    session.flush()
    _sync_legacy_columns(session, conversation, now)
    return True
