"""Classification of chat events for the hub bell (Variant A hybrid).

Ordinary chat traffic is gated by two independent flags:

* CHAT_HUB_ORDINARY_WRITE_ENABLED — create new ordinary hub rows
* CHAT_HUB_ORDINARY_READ_VISIBLE — expose legacy ordinary rows in bell poll/unread/UI

Important events (e.g. chat.mention) never depend on these flags.

Do not add event types without a real producer and consumer.
"""
from __future__ import annotations

from typing import Any

from backend.chat.utils import normalize_text as _normalize_text

# Per-message / transport-like chat events. Represented by chat unread state,
# WebSocket, list badges and push outbox — not by hub_notifications (after cutover).
ORDINARY_CHAT_HUB_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "chat.message_received",
        "chat.file_shared",
        "chat.task_shared",
        "chat.message_forwarded",
    }
)

# Implemented important events that may create a hub bell row.
# Member/role/direct_reply are intentionally absent until producers exist.
HUB_BELL_CHAT_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "chat.mention",
    }
)

# Cleared automatically when the user opens/mark-reads the conversation.
CONVERSATION_READ_CHAT_HUB_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "chat.mention",
    }
)

# Explicit bell-read only (not cleared by conversation mark_read).
# Empty until member/role system hub events are implemented.
EXPLICIT_BELL_READ_CHAT_HUB_EVENT_TYPES: frozenset[str] = frozenset()

_LEGACY_COMBINED_FLAG = "CHAT_HUB_ORDINARY_NOTIFICATIONS_ENABLED"


def normalize_chat_hub_event_type(event_type: object) -> str:
    return _normalize_text(event_type).lower()


def is_ordinary_chat_hub_event(event_type: object) -> bool:
    return normalize_chat_hub_event_type(event_type) in ORDINARY_CHAT_HUB_EVENT_TYPES


def is_hub_bell_chat_event(event_type: object) -> bool:
    return normalize_chat_hub_event_type(event_type) in HUB_BELL_CHAT_EVENT_TYPES


def is_conversation_read_chat_hub_event(event_type: object) -> bool:
    return normalize_chat_hub_event_type(event_type) in CONVERSATION_READ_CHAT_HUB_EVENT_TYPES


def hub_ordinary_write_enabled() -> bool:
    """When true, ordinary chat events may INSERT hub_notifications rows."""
    try:
        from backend.chat.latency_profile import hub_ordinary_write_enabled as _enabled

        return bool(_enabled())
    except Exception:
        import os

        raw = str(os.getenv("CHAT_HUB_ORDINARY_WRITE_ENABLED", "") or "").strip()
        if raw:
            return raw.lower() in {"1", "true", "yes", "on"}
        legacy = str(os.getenv(_LEGACY_COMBINED_FLAG, "1") or "1").strip().lower()
        return legacy in {"1", "true", "yes", "on"}


def hub_ordinary_read_visible() -> bool:
    """When true, ordinary chat hub rows appear in poll/unread/bell UI."""
    try:
        from backend.chat.latency_profile import hub_ordinary_read_visible as _enabled

        return bool(_enabled())
    except Exception:
        import os

        raw = str(os.getenv("CHAT_HUB_ORDINARY_READ_VISIBLE", "") or "").strip()
        if raw:
            return raw.lower() in {"1", "true", "yes", "on"}
        legacy = str(os.getenv(_LEGACY_COMBINED_FLAG, "1") or "1").strip().lower()
        return legacy in {"1", "true", "yes", "on"}


# Back-compat alias used by older call sites/tests: means WRITE path.
def hub_ordinary_notifications_enabled() -> bool:
    return hub_ordinary_write_enabled()


def should_create_hub_bell_notification(
    event_type: object,
    *,
    ordinary_write_enabled: bool | None = None,
    ordinary_enabled: bool | None = None,
) -> bool:
    """Single gate for hub INSERT of chat events."""
    normalized = normalize_chat_hub_event_type(event_type)
    if not normalized:
        return False
    if normalized in HUB_BELL_CHAT_EVENT_TYPES:
        return True
    if normalized in ORDINARY_CHAT_HUB_EVENT_TYPES:
        if ordinary_write_enabled is None and ordinary_enabled is not None:
            ordinary_write_enabled = bool(ordinary_enabled)
        enabled = (
            hub_ordinary_write_enabled()
            if ordinary_write_enabled is None
            else bool(ordinary_write_enabled)
        )
        return enabled
    # Unknown chat event types: do not invent hub rows.
    return False


def default_mark_chat_notification_event_types(
    *,
    ordinary_write_enabled: bool | None = None,
    ordinary_enabled: bool | None = None,
) -> list[str]:
    """Event types cleared by conversation mark_read.

    Always clears ordinary types when present (legacy soft-read hygiene) plus
    conversation-read important events (mentions). Explicit bell-read system
    events are never included here.
    """
    del ordinary_write_enabled, ordinary_enabled  # reserved for future narrowing
    types = set(CONVERSATION_READ_CHAT_HUB_EVENT_TYPES) | set(ORDINARY_CHAT_HUB_EVENT_TYPES)
    return sorted(types)


def ordinary_chat_hub_event_types_sql_list() -> list[str]:
    return sorted(ORDINARY_CHAT_HUB_EVENT_TYPES)


def hub_ordinary_flags_snapshot() -> dict[str, Any]:
    """Diagnostic snapshot for admin/metrics (safe to expose to admins)."""
    write_enabled = hub_ordinary_write_enabled()
    read_visible = hub_ordinary_read_visible()
    source = "env"
    try:
        from backend.chat.latency_profile import hub_ordinary_flags_source

        source = str(hub_ordinary_flags_source() or "env")
    except Exception:
        source = "env"
    return {
        "ordinary_write_enabled": bool(write_enabled),
        "ordinary_read_visible": bool(read_visible),
        "important_event_types": sorted(HUB_BELL_CHAT_EVENT_TYPES),
        "ordinary_event_types": sorted(ORDINARY_CHAT_HUB_EVENT_TYPES),
        "source": source,
    }
