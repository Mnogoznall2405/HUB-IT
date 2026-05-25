from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

from backend.api.v1.database import get_all_db_configs
from backend.config import config
from backend.services.settings_service import settings_service
from backend.services.user_db_selection_service import user_db_selection_service


# Cap on how many databases multi-DB admin search can fan-out to in one call.
# Prevents timeouts when admin has many databases configured.
AI_TOOL_MULTI_DB_MAX_TARGETS = max(1, int(os.environ.get("AI_TOOL_MULTI_DB_MAX_TARGETS", "5")))


ITINVENT_TOOL_DATABASE_CURRENT = "itinvent.database.current"
ITINVENT_TOOL_EQUIPMENT_SEARCH = "itinvent.equipment.search"
ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL = "itinvent.equipment.search_universal"
ITINVENT_TOOL_EQUIPMENT_GET_CARD = "itinvent.equipment.get_card"
ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH = "itinvent.equipment.list_by_branch"
ITINVENT_TOOL_EMPLOYEE_SEARCH = "itinvent.employee.search"
ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT = "itinvent.employee.list_equipment"
ITINVENT_TOOL_CONSUMABLES_SEARCH = "itinvent.consumables.search"
ITINVENT_TOOL_DIRECTORY_BRANCHES = "itinvent.directory.branches"
ITINVENT_TOOL_DIRECTORY_LOCATIONS = "itinvent.directory.locations"
ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES = "itinvent.directory.equipment_types"
ITINVENT_TOOL_DIRECTORY_STATUSES = "itinvent.directory.statuses"
ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB = "itinvent.equipment.search_multi_db"
ITINVENT_TOOL_ANALYTICS_SUMMARY = "itinvent.analytics.summary"
ITINVENT_TOOL_ENTITY_RESOLVE = "itinvent.entity.resolve"
ITINVENT_TOOL_ACTION_TRANSFER_DRAFT = "itinvent.action.transfer_draft"
ITINVENT_TOOL_ACTION_CONSUMABLE_CONSUME_DRAFT = "itinvent.action.consumable_consume_draft"
ITINVENT_TOOL_ACTION_CONSUMABLE_QTY_DRAFT = "itinvent.action.consumable_qty_draft"
AI_TOOL_FILES_CREATE = "ai.files.create"
AI_TOOL_FILES_REPORT = "ai.files.report"
OFFICE_TOOL_MAIL_SEARCH = "office.mail.search"
OFFICE_TOOL_MAIL_GET_MESSAGE = "office.mail.get_message"
OFFICE_TOOL_MAIL_CONTACTS_RESOLVE = "office.mail.contacts.resolve"
OFFICE_TOOL_TASKS_SEARCH = "office.tasks.search"
OFFICE_TOOL_TASKS_GET = "office.tasks.get"
OFFICE_TOOL_WORKDAY_SUMMARY = "office.workday.summary"
OFFICE_TOOL_ACTION_MAIL_SEND_DRAFT = "office.action.mail_send_draft"
OFFICE_TOOL_ACTION_MAIL_REPLY_DRAFT = "office.action.mail_reply_draft"
OFFICE_TOOL_ACTION_TASK_CREATE_DRAFT = "office.action.task_create_draft"
OFFICE_TOOL_ACTION_TASK_COMMENT_DRAFT = "office.action.task_comment_draft"
OFFICE_TOOL_ACTION_TASK_STATUS_DRAFT = "office.action.task_status_draft"
OFFICE_TOOL_TASKS_PROJECTS = "office.tasks.projects"
OFFICE_TOOL_ANNOUNCEMENTS_LIST = "office.announcements.list"
OFFICE_TOOL_ANNOUNCEMENTS_GET = "office.announcements.get"
ITINVENT_TOOL_EQUIPMENT_HISTORY = "itinvent.equipment.history"
ITINVENT_TOOL_EQUIPMENT_ACTS = "itinvent.equipment.acts"
ITINVENT_TOOL_EQUIPMENT_MODELS_SEARCH = "itinvent.equipment.models_search"
ITINVENT_TOOL_DIRECTORY_VENDORS = "itinvent.directory.vendors"
ITINVENT_TOOL_DIRECTORY_DEPARTMENTS = "itinvent.directory.departments"
ITINVENT_TOOL_ACTION_STATUS_CHANGE_DRAFT = "itinvent.action.status_change_draft"
ITINVENT_TOOL_ACTION_LOCATION_CHANGE_DRAFT = "itinvent.action.location_change_draft"
ITINVENT_TOOL_USER_BY_NAME = "itinvent.user.by_name"
ITINVENT_TOOL_USER_FULL_CONTEXT = "itinvent.user.full_context"
MFU_TOOL_DEVICES_LIST = "mfu.devices.list"
MFU_TOOL_DEVICE_STATUS = "mfu.device.status"
MFU_TOOL_PAGES_MONTHLY = "mfu.pages.monthly"
NETWORK_TOOL_SOCKET_SEARCH = "network.socket.search"
NETWORK_TOOL_BRANCH_OVERVIEW = "network.branch.overview"
NETWORK_TOOL_PORTS_SEARCH = "network.ports.search"
AD_TOOL_USER_PASSWORD_STATUS = "ad.user.password_status"
AD_TOOL_USERS_EXPIRING_SOON = "ad.users.expiring_soon"
AD_TOOL_MAILBOX_PASSWORD_STATUS = "ad.mailbox.password_status"
AD_TOOL_MAILBOXES_EXPIRING_SOON = "ad.mailboxes.expiring_soon"
AD_TOOL_USER_LOCKOUT_STATUS = "ad.user.lockout_status"
AD_TOOL_ACTION_UNLOCK_DRAFT = "ad.action.unlock_draft"
AD_TOOL_USER_GROUPS = "ad.user.groups"
AD_TOOL_USER_LOGON_HISTORY = "ad.user.logon_history"
NETWORK_TOOL_HOST_PING = "network.host.ping"
NETWORK_TOOL_DNS_LOOKUP = "network.dns.lookup"
NETWORK_TOOL_SSL_CHECK = "network.ssl.check"
NETWORK_TOOL_ACTION_WOL_DRAFT = "network.action.wol_draft"
NETWORK_TOOL_HOST_INFO = "network.host.info"

DEFAULT_ITINVENT_TOOL_IDS = [
    ITINVENT_TOOL_DATABASE_CURRENT,
    ITINVENT_TOOL_EQUIPMENT_SEARCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL,
    ITINVENT_TOOL_EQUIPMENT_GET_CARD,
    ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH,
    ITINVENT_TOOL_EMPLOYEE_SEARCH,
    ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT,
    ITINVENT_TOOL_CONSUMABLES_SEARCH,
    ITINVENT_TOOL_DIRECTORY_BRANCHES,
    ITINVENT_TOOL_DIRECTORY_LOCATIONS,
    ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES,
    ITINVENT_TOOL_DIRECTORY_STATUSES,
    ITINVENT_TOOL_ANALYTICS_SUMMARY,
    ITINVENT_TOOL_EQUIPMENT_HISTORY,
    ITINVENT_TOOL_EQUIPMENT_ACTS,
    ITINVENT_TOOL_EQUIPMENT_MODELS_SEARCH,
    ITINVENT_TOOL_DIRECTORY_VENDORS,
    ITINVENT_TOOL_DIRECTORY_DEPARTMENTS,
    ITINVENT_TOOL_ENTITY_RESOLVE,
    ITINVENT_TOOL_ACTION_TRANSFER_DRAFT,
    ITINVENT_TOOL_ACTION_CONSUMABLE_CONSUME_DRAFT,
    ITINVENT_TOOL_ACTION_CONSUMABLE_QTY_DRAFT,
    ITINVENT_TOOL_ACTION_STATUS_CHANGE_DRAFT,
    ITINVENT_TOOL_ACTION_LOCATION_CHANGE_DRAFT,
    ITINVENT_TOOL_USER_BY_NAME,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
    # AD tools (password expiry, rotation status)
    AD_TOOL_USER_PASSWORD_STATUS,
    AD_TOOL_USERS_EXPIRING_SOON,
    AD_TOOL_MAILBOX_PASSWORD_STATUS,
    AD_TOOL_MAILBOXES_EXPIRING_SOON,
    AD_TOOL_USER_LOCKOUT_STATUS,
    AD_TOOL_ACTION_UNLOCK_DRAFT,
    AD_TOOL_USER_GROUPS,
    AD_TOOL_USER_LOGON_HISTORY,
    # MFU/printer tools
    MFU_TOOL_DEVICES_LIST,
    MFU_TOOL_DEVICE_STATUS,
    MFU_TOOL_PAGES_MONTHLY,
    # Network infrastructure tools
    NETWORK_TOOL_SOCKET_SEARCH,
    NETWORK_TOOL_BRANCH_OVERVIEW,
    NETWORK_TOOL_PORTS_SEARCH,
    NETWORK_TOOL_HOST_PING,
    NETWORK_TOOL_DNS_LOOKUP,
    NETWORK_TOOL_SSL_CHECK,
    NETWORK_TOOL_ACTION_WOL_DRAFT,
    NETWORK_TOOL_HOST_INFO,
]

AI_TOOL_MULTI_DB_MODE_SINGLE = "single"
AI_TOOL_MULTI_DB_MODE_ADMIN = "admin_multi_db"

AI_TOOL_GROUP_ITINVENT = "itinvent"
AI_TOOL_GROUP_OFFICE = "office"
AI_TOOL_GROUP_FILES = "files"
AI_TOOL_GROUP_MFU = "mfu"
AI_TOOL_GROUP_NETWORK = "network"
AI_TOOL_GROUP_AD = "ad"
AI_TOOL_GROUP_OTHER = "other"
AI_TOOL_GROUPS_ALL = (
    AI_TOOL_GROUP_ITINVENT,
    AI_TOOL_GROUP_OFFICE,
    AI_TOOL_GROUP_FILES,
    AI_TOOL_GROUP_MFU,
    AI_TOOL_GROUP_NETWORK,
    AI_TOOL_GROUP_AD,
    AI_TOOL_GROUP_OTHER,
)


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def get_tool_group(tool_id: object) -> str:
    normalized = _normalize_text(tool_id)
    if normalized.startswith("itinvent."):
        return AI_TOOL_GROUP_ITINVENT
    if normalized.startswith("office."):
        return AI_TOOL_GROUP_OFFICE
    if normalized in {AI_TOOL_FILES_CREATE, AI_TOOL_FILES_REPORT}:
        return AI_TOOL_GROUP_FILES
    if normalized.startswith("mfu."):
        return AI_TOOL_GROUP_MFU
    if normalized.startswith("network."):
        return AI_TOOL_GROUP_NETWORK
    if normalized.startswith("ad."):
        return AI_TOOL_GROUP_AD
    return AI_TOOL_GROUP_OTHER


def get_enabled_tool_groups(enabled_tool_ids: list[str]) -> set[str]:
    return {get_tool_group(tid) for tid in enabled_tool_ids if _normalize_text(tid)}


def get_available_database_options() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for item in list(get_all_db_configs() or []):
        database_id = _normalize_text(item.get("id"))
        if not database_id or database_id in seen_ids:
            continue
        seen_ids.add(database_id)
        rows.append(
            {
                "id": database_id,
                "name": _normalize_text(item.get("name")) or database_id,
            }
        )
    default_database_id = _normalize_text(getattr(config.database, "database", None))
    if default_database_id and default_database_id not in seen_ids:
        rows.insert(
            0,
            {
                "id": default_database_id,
                "name": default_database_id,
            },
        )
    return rows


def get_available_database_ids() -> set[str]:
    return {item["id"] for item in get_available_database_options() if _normalize_text(item.get("id"))}


def normalize_database_id(value: object) -> str | None:
    normalized = _normalize_text(value)
    if not normalized:
        return None
    available_database_ids = get_available_database_ids()
    if available_database_ids and normalized not in available_database_ids:
        return None
    return normalized


def normalize_enabled_tools(value: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in list(value or []):
        tool_id = _normalize_text(item)
        if not tool_id or tool_id in seen:
            continue
        seen.add(tool_id)
        result.append(tool_id)
    return result


def normalize_tool_settings(value: Any) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    available_db_ids = get_available_database_ids()
    multi_db_mode = _normalize_text(payload.get("multi_db_mode")).lower() or AI_TOOL_MULTI_DB_MODE_SINGLE
    if multi_db_mode not in {AI_TOOL_MULTI_DB_MODE_SINGLE, AI_TOOL_MULTI_DB_MODE_ADMIN}:
        multi_db_mode = AI_TOOL_MULTI_DB_MODE_SINGLE
    allowed_databases: list[str] = []
    for item in list(payload.get("allowed_databases") or []):
        database_id = _normalize_text(item)
        if not database_id or database_id not in available_db_ids or database_id in allowed_databases:
            continue
        allowed_databases.append(database_id)

    # max_tool_rounds: integer, range 1–12, default 6
    try:
        max_tool_rounds = int(payload.get("max_tool_rounds", 6))
    except (TypeError, ValueError):
        max_tool_rounds = 6
    max_tool_rounds = max(1, min(12, max_tool_rounds))

    # max_tool_calls_per_round: integer, range 1–5, default 3
    try:
        max_tool_calls_per_round = int(payload.get("max_tool_calls_per_round", 3))
    except (TypeError, ValueError):
        max_tool_calls_per_round = 3
    max_tool_calls_per_round = max(1, min(5, max_tool_calls_per_round))

    return {
        "multi_db_mode": multi_db_mode,
        "allowed_databases": allowed_databases,
        "max_tool_rounds": max_tool_rounds,
        "max_tool_calls_per_round": max_tool_calls_per_round,
    }


def resolve_effective_database_id(
    *,
    user_payload: dict[str, Any] | None,
    explicit_database_id: str | None = None,
) -> str | None:
    explicit = normalize_database_id(explicit_database_id)
    user = user_payload if isinstance(user_payload, dict) else {}
    role = _normalize_text(user.get("role")).lower()
    assigned_database = normalize_database_id(user.get("assigned_database"))
    if not assigned_database:
        assigned_database = normalize_database_id(
            user_db_selection_service.get_assigned_database(user.get("telegram_id"))
        )
    if assigned_database and role != "admin":
        return assigned_database
    if explicit:
        return explicit
    user_id = int(user.get("id") or 0)
    if user_id > 0:
        pinned_database = normalize_database_id(
            settings_service.get_user_settings(user_id).get("pinned_database")
        )
        if pinned_database:
            return pinned_database
    default_database = normalize_database_id(getattr(config.database, "database", None))
    if default_database:
        return default_database
    for item in get_available_database_options():
        database_id = _normalize_text(item.get("id"))
        if database_id:
            return database_id
    return None


@dataclass(slots=True)
class AiToolExecutionContext:
    bot_id: str
    bot_title: str
    conversation_id: str
    run_id: str
    user_id: int
    user_payload: dict[str, Any]
    effective_database_id: str | None
    enabled_tools: list[str]
    tool_settings: dict[str, Any]
    allow_generated_artifacts: bool = True

    @property
    def is_admin(self) -> bool:
        return _normalize_text(self.user_payload.get("role")).lower() == "admin"

    @property
    def multi_db_mode(self) -> str:
        return _normalize_text(self.tool_settings.get("multi_db_mode")).lower() or AI_TOOL_MULTI_DB_MODE_SINGLE

    @property
    def allowed_databases(self) -> list[str]:
        normalized = normalize_tool_settings(self.tool_settings)
        return list(normalized.get("allowed_databases") or [])

    @property
    def max_tool_rounds(self) -> int:
        """Per-bot max tool rounds from tool_settings, with env fallback."""
        raw = self.tool_settings.get("max_tool_rounds") if self.tool_settings else None
        if raw is not None:
            try:
                value = int(raw)
                return max(1, min(12, value))
            except (TypeError, ValueError):
                pass
        env_value = os.environ.get("AI_TOOL_ROUND_LIMIT", "6")
        try:
            return max(1, min(12, int(env_value)))
        except (TypeError, ValueError):
            return 6

    @property
    def max_tool_calls_per_round(self) -> int:
        """Per-bot max tool calls per round from tool_settings, with env fallback."""
        raw = self.tool_settings.get("max_tool_calls_per_round") if self.tool_settings else None
        if raw is not None:
            try:
                value = int(raw)
                return max(1, min(5, value))
            except (TypeError, ValueError):
                pass
        env_value = os.environ.get("AI_TOOL_CALLS_PER_ROUND_LIMIT", "3")
        try:
            return max(1, min(5, int(env_value)))
        except (TypeError, ValueError):
            return 3

    def resolve_multi_db_targets(self) -> list[str]:
        if not self.is_admin or self.multi_db_mode != AI_TOOL_MULTI_DB_MODE_ADMIN:
            return []
        targets = [item for item in self.allowed_databases if item]
        if not targets:
            targets = [item["id"] for item in get_available_database_options() if _normalize_text(item.get("id"))]
        # Cap fan-out: querying many databases in one tool call is slow and risks timeouts.
        if len(targets) > AI_TOOL_MULTI_DB_MAX_TARGETS:
            targets = targets[:AI_TOOL_MULTI_DB_MAX_TARGETS]
        return targets

    def resolve_tool_database_id(self, requested_database_id: object = None) -> str | None:
        requested = normalize_database_id(requested_database_id)
        current = normalize_database_id(self.effective_database_id)
        if not requested:
            return current
        if not self.is_admin:
            return requested if current and requested == current else None
        if self.multi_db_mode == AI_TOOL_MULTI_DB_MODE_ADMIN:
            targets = set(self.resolve_multi_db_targets())
            return requested if requested in targets else None
        return requested if current and requested == current else None
