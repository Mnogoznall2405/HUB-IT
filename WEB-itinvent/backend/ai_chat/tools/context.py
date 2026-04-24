from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from backend.api.v1.database import get_all_db_configs
from backend.config import config
from backend.services.settings_service import settings_service
from backend.services.user_db_selection_service import user_db_selection_service


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
]

AI_TOOL_MULTI_DB_MODE_SINGLE = "single"
AI_TOOL_MULTI_DB_MODE_ADMIN = "admin_multi_db"


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


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
    return {
        "multi_db_mode": multi_db_mode,
        "allowed_databases": allowed_databases,
    }


def resolve_effective_database_id(
    *,
    user_payload: dict[str, Any] | None,
    explicit_database_id: str | None = None,
) -> str | None:
    available_database_ids = get_available_database_ids()

    def _normalize_database_id(value: object) -> str | None:
        normalized = _normalize_text(value)
        if not normalized:
            return None
        if available_database_ids and normalized not in available_database_ids:
            return None
        return normalized

    explicit = _normalize_database_id(explicit_database_id)
    user = user_payload if isinstance(user_payload, dict) else {}
    role = _normalize_text(user.get("role")).lower()
    assigned_database = _normalize_database_id(user.get("assigned_database"))
    if not assigned_database:
        assigned_database = _normalize_database_id(
            user_db_selection_service.get_assigned_database(user.get("telegram_id"))
        )
    if assigned_database and role != "admin":
        return assigned_database
    if explicit:
        return explicit
    user_id = int(user.get("id") or 0)
    if user_id > 0:
        pinned_database = _normalize_database_id(
            settings_service.get_user_settings(user_id).get("pinned_database")
        )
        if pinned_database:
            return pinned_database
    default_database = _normalize_database_id(getattr(config.database, "database", None))
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

    def resolve_multi_db_targets(self) -> list[str]:
        if not self.is_admin or self.multi_db_mode != AI_TOOL_MULTI_DB_MODE_ADMIN:
            return []
        targets = [item for item in self.allowed_databases if item]
        return targets
