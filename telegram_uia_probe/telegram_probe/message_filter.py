"""Filter HistoryInner messages by chat identity and tail-only deltas."""

from __future__ import annotations

import re
from typing import Any, Iterable

from .chat_kind import is_multi_peer_kind
from .chat_state import message_key

_STATUS_SENDERS = {
    "просмотрено",
    "не просмотрено",
    "просмотры",
    "отправитель",
    "сообщение",
    "получение",
    "время",
    "меня",
}


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def sender_belongs_to_chat(
    chat_name: str,
    msg: dict[str, Any],
    *,
    kind: str | None = None,
) -> bool:
    """
    Keep messages that belong to the open chat.

    - private/unknown: own messages + peer matching chat title (1:1)
    - group/channel: any non-status sender (multi-peer HistoryInner)
    """
    direction = _norm(str(msg.get("direction") or ""))
    sender = _norm(str(msg.get("sender") or ""))
    chat = _norm(chat_name)

    if not sender or sender in _STATUS_SENDERS:
        return False
    if direction == "outgoing" or sender in {"я", "me", "you"}:
        return True

    if is_multi_peer_kind(kind):
        # Drop obvious chrome leftovers; keep real member/channel names.
        if len(sender) < 1:
            return False
        return True

    if not chat:
        return False
    if sender == chat:
        return True
    if sender in chat or chat in sender:
        return True
    return False


def filter_messages_for_chat(
    chat_name: str,
    messages: Iterable[dict[str, Any] | Any],
    *,
    kind: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for msg in messages:
        data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
        if not sender_belongs_to_chat(chat_name, data, kind=kind):
            continue
        key = message_key(data)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(data)
    return out


def new_messages_from_tail(
    known_keys: set[str],
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Only accept unknown messages after the last already-known item in the
    current HistoryInner window (old→new order).

    This ignores older bubbles that appear when the user scrolls up, and
    refuses a full foreign window when no known keys overlap (chat switch lag).
    """
    if not messages:
        return []

    keys = [message_key(m) for m in messages]
    last_known_idx = -1
    for i, key in enumerate(keys):
        if key in known_keys:
            last_known_idx = i

    if last_known_idx < 0:
        if not known_keys:
            return list(messages)
        # No overlap with known history:
        # - large window ⇒ chat-switch lag / scroll dump → ignore
        # - tiny list ⇒ caller already passed a pure delta → accept unknowns
        if len(messages) <= 15:
            return [
                m
                for m in messages
                if message_key(m) not in known_keys
            ]
        return []

    candidates = messages[last_known_idx + 1 :]
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for data in candidates:
        key = message_key(data)
        if not key or key in known_keys or key in seen:
            continue
        seen.add(key)
        out.append(data)
    return out


def history_looks_like_chat(
    chat_name: str,
    messages: list[dict[str, Any]],
    *,
    kind: str | None = None,
) -> bool:
    """Reject windows where most incoming senders are clearly another peer."""
    if not messages:
        return False

    # Groups/channels intentionally have many senders ≠ chat title.
    if is_multi_peer_kind(kind):
        return True

    # Saved Messages aggregates forwards from many peers — never treat as switch lag.
    chat_norm = _norm(chat_name)
    if chat_norm in {"избранное", "saved messages", "saved message"}:
        return True

    incoming = [
        m
        for m in messages
        if _norm(str(m.get("direction") or "")) == "incoming"
        and _norm(str(m.get("sender") or "")) not in _STATUS_SENDERS
    ]
    if not incoming:
        # only outgoing visible — still plausible
        return True
    matched = sum(
        1 for m in incoming if sender_belongs_to_chat(chat_name, m, kind=kind)
    )
    return matched / len(incoming) >= 0.5
