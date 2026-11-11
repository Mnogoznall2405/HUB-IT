"""Detect private vs group/channel chats for filter policy."""

from __future__ import annotations

import re
from typing import Any, Iterable

from .uia_tree import UiDump

ChatKind = str  # "private" | "group" | "channel" | "unknown"

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

MEMBERS_RE = re.compile(
    r"(?P<n>\d[\d\s]*)\s*"
    r"(?P<label>участник(?:а|ов)?|members?|подписчик(?:а|ов)?|subscribers?)",
    flags=re.IGNORECASE,
)


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def detect_kind_from_uia(dump: UiDump | None, window_title: str = "") -> ChatKind | None:
    """Return group/channel if UIA/title subtitle mentions members/subscribers."""
    texts: list[str] = []
    if window_title:
        texts.append(window_title)
    if dump is not None:
        texts.extend(dump.visible_text or [])
        texts.extend(dump.raw_names or [])
        for node in (dump.nodes or [])[:500]:
            if getattr(node, "name", None):
                texts.append(str(node.name))

    for text in texts:
        m = MEMBERS_RE.search(text or "")
        if not m:
            continue
        label = (m.group("label") or "").lower()
        if "подпис" in label or "subscriber" in label:
            return "channel"
        return "group"
    return None


def detect_kind_from_messages(
    chat_name: str,
    messages: Iterable[dict[str, Any] | Any],
) -> ChatKind:
    """
    Infer kind from HistoryInner senders.

    Conservative by default (private), to avoid marking 1:1 chats as groups
    when UIA sender text ≠ window title or forwards leak extra names.

    - UIA members/subscribers is handled separately
    - 3+ distinct incoming senders → group (strong multi-peer signal)
    - 2 distinct incoming senders, neither matching chat title → group
    - otherwise → private / unknown
    """
    incoming_senders: set[str] = set()
    for msg in messages:
        data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
        direction = _norm(str(data.get("direction") or ""))
        sender = _norm(str(data.get("sender") or ""))
        if direction != "incoming":
            continue
        if not sender or sender in _STATUS_SENDERS or sender in {"я", "me", "you"}:
            continue
        incoming_senders.add(sender)

    if len(incoming_senders) == 0:
        return "unknown"

    chat = _norm(chat_name)
    matching = {
        s
        for s in incoming_senders
        if s == chat or s in chat or chat in s
    }

    if len(incoming_senders) >= 3:
        return "group"
    if len(incoming_senders) == 2 and not matching:
        return "group"
    if matching:
        return "private"
    # One (or two) senders that don't fuzzy-match title — still treat as private.
    # Real groups should hit UIA "N участников" or 3+ authors.
    return "private"


def resolve_chat_kind(
    chat_name: str,
    messages: Iterable[dict[str, Any] | Any],
    *,
    dump: UiDump | None = None,
    window_title: str = "",
    stored_kind: str | None = None,
) -> ChatKind:
    """Combine UIA signal, message heuristic, and previously stored kind."""
    uia_kind = detect_kind_from_uia(dump, window_title)
    msg_kind = detect_kind_from_messages(chat_name, messages)

    # Explicit UIA subtitle is the strongest signal.
    if uia_kind in {"group", "channel"}:
        if uia_kind == "channel" and msg_kind == "group":
            return "group"
        return uia_kind

    # Do not keep a stale wrong "group" if current evidence says private.
    if msg_kind == "private":
        return "private"
    if msg_kind == "group":
        return "group"

    if stored_kind in {"group", "channel", "private"}:
        return stored_kind

    return "unknown"


def is_multi_peer_kind(kind: str | None) -> bool:
    return (kind or "") in {"group", "channel"}
