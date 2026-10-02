"""Portal permission requirements for AI chat tools.

Section 25 of the stability plan (phase AG-2): an AI bot must never expose
data or actions beyond what the employee can do in the portal itself.
Tools are matched by exact tool_id first, then by the longest prefix.
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from backend.ai_chat.tools.context import (
    AD_TOOL_ACTION_UNLOCK_DRAFT,
    ITINVENT_TOOL_AUDIT_DISMISSED,
    CHAT_TOOL_ACTION_MESSAGE_SEND_DRAFT,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB,
    NETWORK_TOOL_ACTION_WOL_DRAFT,
    OFFICE_TOOL_ACTION_TASK_COMMENT_DRAFT,
    OFFICE_TOOL_ACTION_TASK_CREATE_DRAFT,
    OFFICE_TOOL_ACTION_TASK_STATUS_DRAFT,
    OFFICE_TOOL_WORKDAY_SUMMARY,
)
from backend.services.authorization_service import (
    PERM_AD_USERS_MANAGE,
    PERM_AD_USERS_READ,
    PERM_ADDRESS_BOOK_DISMISSED_READ,
    PERM_ADDRESS_BOOK_READ,
    PERM_ANNOUNCEMENTS_READ,
    PERM_CHAT_AI_USE,
    PERM_CHAT_READ,
    PERM_CHAT_WRITE,
    PERM_COMPANY_STRUCTURE_READ,
    PERM_COMPUTERS_READ,
    PERM_DATABASE_READ,
    PERM_DATABASE_WRITE,
    PERM_KB_READ,
    PERM_MAIL_ACCESS,
    PERM_MAIL_QUOTAS_READ,
    PERM_MFU_READ,
    PERM_MY_FILES_READ,
    PERM_NETWORKS_READ,
    PERM_NETWORKS_WRITE,
    PERM_TASKS_CREATE,
    PERM_TASKS_READ,
    PERM_TASKS_WRITE,
    PERM_VOICE_READ,
    authorization_service,
)

# Tools that stay admin-only regardless of portal permissions.
_ADMIN_ONLY_TOOL_IDS = frozenset({ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB})

# Exact tool_id -> required portal permissions (all of them must be held).
_EXACT_PERMISSIONS: dict[str, tuple[str, ...]] = {
    OFFICE_TOOL_ACTION_TASK_CREATE_DRAFT: (PERM_TASKS_CREATE,),
    OFFICE_TOOL_ACTION_TASK_COMMENT_DRAFT: (PERM_TASKS_WRITE,),
    OFFICE_TOOL_ACTION_TASK_STATUS_DRAFT: (PERM_TASKS_WRITE,),
    OFFICE_TOOL_WORKDAY_SUMMARY: (PERM_TASKS_READ,),
    AD_TOOL_ACTION_UNLOCK_DRAFT: (PERM_AD_USERS_MANAGE,),
    NETWORK_TOOL_ACTION_WOL_DRAFT: (PERM_NETWORKS_WRITE,),
    CHAT_TOOL_ACTION_MESSAGE_SEND_DRAFT: (PERM_CHAT_WRITE,),
    # Joins ITinvent equipment with the ZUP list of dismissed employees.
    ITINVENT_TOOL_AUDIT_DISMISSED: (PERM_DATABASE_READ, PERM_ADDRESS_BOOK_DISMISSED_READ),
    # Legacy computer-profile tool ids (kept in case they are re-enabled).
    "itinvent.user.computer": (PERM_COMPUTERS_READ,),
    "itinvent.equipment.online_status": (PERM_COMPUTERS_READ,),
}

# Prefix -> required portal permissions. Longest prefix wins.
_PREFIX_PERMISSIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("itinvent.action.", (PERM_DATABASE_WRITE,)),
    ("itinvent.computers.", (PERM_COMPUTERS_READ,)),
    ("itinvent.", (PERM_DATABASE_READ,)),
    ("ai.files.", (PERM_CHAT_AI_USE,)),
    ("kb.", (PERM_KB_READ,)),
    ("office.action.mail_", (PERM_MAIL_ACCESS,)),
    ("office.mail.", (PERM_MAIL_ACCESS,)),
    ("office.action.task_", (PERM_TASKS_WRITE,)),
    ("office.tasks.", (PERM_TASKS_READ,)),
    ("office.announcements.", (PERM_ANNOUNCEMENTS_READ,)),
    ("mfu.", (PERM_MFU_READ,)),
    ("ad.", (PERM_AD_USERS_READ,)),
    ("network.", (PERM_NETWORKS_READ,)),
    ("chat.action.", (PERM_CHAT_WRITE,)),
    ("chat.", (PERM_CHAT_READ,)),
    ("voice.", (PERM_VOICE_READ,)),
    # Self-service: only the asking employee's own data, so the assistant permission is enough.
    ("me.files.", (PERM_MY_FILES_READ,)),
    ("me.", (PERM_CHAT_AI_USE,)),
    ("helpdesk.", (PERM_CHAT_AI_USE,)),
    ("directory.people.", (PERM_ADDRESS_BOOK_READ,)),
    ("directory.department.", (PERM_COMPANY_STRUCTURE_READ,)),
    ("office.mailbox.", (PERM_MAIL_QUOTAS_READ,)),
)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def tool_requires_admin(tool_id: object) -> bool:
    normalized = _normalize_text(tool_id)
    if normalized in _ADMIN_ONLY_TOOL_IDS:
        return True
    # Defer to the registry flag so admin_only stays the single source of truth.
    from backend.ai_chat.tools.registry import ai_tool_registry

    tool = ai_tool_registry.get(normalized)
    return bool(getattr(tool, "admin_only", False)) if tool is not None else False


def tool_required_permissions(tool_id: object) -> list[str]:
    """Portal permissions required to call the tool (all must be held).

    Tools without a rule fall back to chat.ai.use — the same permission the
    chat endpoints require.
    """
    normalized = _normalize_text(tool_id)
    if not normalized:
        return [PERM_CHAT_AI_USE]
    exact = _EXACT_PERMISSIONS.get(normalized)
    if exact is not None:
        return list(exact)
    for prefix, permissions in sorted(_PREFIX_PERMISSIONS, key=lambda item: -len(item[0])):
        if normalized.startswith(prefix):
            return list(permissions)
    return [PERM_CHAT_AI_USE]


def _payload_custom_permissions(payload: dict[str, Any]) -> list[str]:
    raw = payload.get("custom_permissions")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except (TypeError, ValueError):
            raw = []
    return [str(item) for item in list(raw or []) if _normalize_text(item)]


def user_can_use_tool(tool_id: object, user_payload: dict[str, Any] | None) -> bool:
    payload = user_payload if isinstance(user_payload, dict) else {}
    if _normalize_text(payload.get("role")).lower() == "admin":
        return True
    normalized = _normalize_text(tool_id)
    if not normalized or tool_requires_admin(normalized):
        return False
    required = tool_required_permissions(normalized)
    if not required:
        return True
    custom_permissions = _payload_custom_permissions(payload)
    use_custom = bool(payload.get("use_custom_permissions", False))
    return all(
        authorization_service.has_permission(
            payload.get("role"),
            permission,
            use_custom_permissions=use_custom,
            custom_permissions=custom_permissions,
        )
        for permission in required
    )


def filter_tools_for_user(tool_ids: Iterable[object] | None, user_payload: dict[str, Any] | None) -> list[str]:
    """Return the subset of tool_ids the user may call, preserving order."""
    allowed: list[str] = []
    seen: set[str] = set()
    for item in list(tool_ids or []):
        tool_id = _normalize_text(item)
        if not tool_id or tool_id in seen:
            continue
        seen.add(tool_id)
        if user_can_use_tool(tool_id, user_payload):
            allowed.append(tool_id)
    return allowed
