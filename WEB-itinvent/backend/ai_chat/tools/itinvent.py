from __future__ import annotations

import logging
import math
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Literal, Optional

logger = logging.getLogger(__name__)

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_ANALYTICS_SUMMARY,
    ITINVENT_TOOL_ACTION_CONSUMABLE_CONSUME_DRAFT,
    ITINVENT_TOOL_ACTION_CONSUMABLE_QTY_DRAFT,
    ITINVENT_TOOL_ACTION_TRANSFER_DRAFT,
    ITINVENT_TOOL_ACTION_STATUS_CHANGE_DRAFT,
    ITINVENT_TOOL_ACTION_LOCATION_CHANGE_DRAFT,
    ITINVENT_TOOL_DATABASE_CURRENT,
    ITINVENT_TOOL_CONSUMABLES_SEARCH,
    ITINVENT_TOOL_DIRECTORY_BRANCHES,
    ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES,
    ITINVENT_TOOL_DIRECTORY_LOCATIONS,
    ITINVENT_TOOL_DIRECTORY_STATUSES,
    ITINVENT_TOOL_DIRECTORY_VENDORS,
    ITINVENT_TOOL_DIRECTORY_DEPARTMENTS,
    ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT,
    ITINVENT_TOOL_EMPLOYEE_SEARCH,
    ITINVENT_TOOL_ENTITY_RESOLVE,
    ITINVENT_TOOL_EQUIPMENT_GET_CARD,
    ITINVENT_TOOL_EQUIPMENT_EXPORT,
    ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB,
    ITINVENT_TOOL_EQUIPMENT_HISTORY,
    ITINVENT_TOOL_EQUIPMENT_ACTS,
    ITINVENT_TOOL_EQUIPMENT_MODELS_SEARCH,
    ITINVENT_TOOL_USER_BY_NAME,
    ITINVENT_TOOL_USER_FULL_CONTEXT,
    WAREHOUSE_TOOL_BALANCES_SEARCH,
    get_available_database_options,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.database import connection, equipment_db, queries
from backend.database.connection import get_db


DEFAULT_RESULT_LIMIT = 250
MAX_RESULT_LIMIT = 250
ANALYTICS_EQUIPMENT_SOURCE_LIMIT = 10000
ANALYTICS_CONSUMABLES_SOURCE_LIMIT = 1000


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _truncate_text(value: object, limit: int = 280) -> str:
    text = _normalize_text(value)
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}…"


def _row_value(row: dict[str, Any] | None, *candidates: str) -> Any:
    payload = row if isinstance(row, dict) else {}
    if not payload:
        return None
    normalized_map = {str(key or "").strip().lower(): value for key, value in payload.items()}
    for key in candidates:
        candidate = str(key or "").strip().lower()
        if candidate in normalized_map:
            value = normalized_map[candidate]
            if value not in (None, ""):
                return value
    return None


def _build_source(database_id: str | None) -> dict[str, str]:
    return {"database_id": _normalize_text(database_id)}


def _resolve_tool_database_id(context: AiToolExecutionContext, args: BaseModel | None = None) -> str:
    requested = getattr(args, "database_id", None) if args is not None else None
    return _normalize_text(context.resolve_tool_database_id(requested))


def _database_error(tool_id: str, requested: object = None) -> AiToolResult:
    requested_text = _normalize_text(requested)
    if requested_text:
        return AiToolResult(
            tool_id=tool_id,
            ok=False,
            error=f"Database '{requested_text}' is not available for this user or bot configuration.",
        )
    return AiToolResult(tool_id=tool_id, ok=False, error="Current ITinvent database is not resolved.")


def _safe_limit(value: object, default: int = DEFAULT_RESULT_LIMIT) -> int:
    try:
        parsed = int(value or default)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, MAX_RESULT_LIMIT))


def _cap_rows(items: list[dict[str, Any]] | None, limit: int = DEFAULT_RESULT_LIMIT) -> list[dict[str, Any]]:
    return list(items or [])[: _safe_limit(limit)]


def _result_metadata(*, returned_count: int, limit: int, total: object | None = None) -> dict[str, Any]:
    try:
        total_count = int(total) if total is not None else int(returned_count)
    except (TypeError, ValueError):
        total_count = int(returned_count)
    returned = int(returned_count)
    total_count = max(total_count, returned)
    safe_limit = _safe_limit(limit)
    return {
        "count": returned,
        "returned_count": returned,
        "total": total_count,
        "limit": safe_limit,
        "truncated": total_count > returned,
    }


_EQUIPMENT_TYPE_ALIASES: tuple[tuple[tuple[str, ...], str, tuple[str, ...]], ...] = (
    (("монитор", "мониторы", "монитора", "monitor", "display", "дисплей", "экран"), "монитор", ("монитор", "monitor", "display", "дисплей", "экран")),
    (("ноутбук", "ноутбуки", "ноутбука", "laptop"), "ноутбук", ("ноутбук", "laptop")),
    (("принтер", "принтеры", "принтера", "printer"), "принтер", ("принтер", "printer")),
    (("мфу", "многофункциональное", "multifunction"), "мфу", ("мфу", "многофункцион", "multifunction")),
    (("системный блок", "системные блоки", "компьютер", "компьютеры", "пк", "pc"), "системный блок", ("системный блок", "компьютер", "пк", "pc")),
    (("телефон", "телефоны", "phone"), "телефон", ("телефон", "phone")),
    (("сканер", "сканеры", "scanner"), "сканер", ("сканер", "scanner")),
)

_EQUIPMENT_QUERY_STOPWORDS = {
    "найди",
    "найти",
    "покажи",
    "выведи",
    "дай",
    "мне",
    "все",
    "всех",
    "всю",
    "список",
    "техника",
    "технику",
    "оборудование",
    "на",
    "в",
    "по",
    "адресу",
    "адрес",
    "филиал",
    "филиале",
    "локация",
    "локации",
    "таблица",
    "таблицу",
    "excel",
    "xlsx",
    "эксель",
    "файл",
    "отчет",
}


def _normalize_search_text(value: object) -> str:
    text = _normalize_text(value).casefold().replace("ё", "е")
    text = re.sub(r"[^0-9a-zа-я]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _search_tokens(value: object) -> list[str]:
    return [token for token in _normalize_search_text(value).split(" ") if token]


def _strip_query_noise(value: object, *, type_aliases: tuple[str, ...] = ()) -> str:
    aliases = {_normalize_search_text(alias) for alias in type_aliases if _normalize_search_text(alias)}
    tokens = []
    skip_next = False
    raw_tokens = _search_tokens(value)
    for index, token in enumerate(raw_tokens):
        if skip_next:
            skip_next = False
            continue
        two_word = f"{token} {raw_tokens[index + 1]}" if index + 1 < len(raw_tokens) else ""
        if two_word and two_word in aliases:
            skip_next = True
            continue
        if token in aliases or token in _EQUIPMENT_QUERY_STOPWORDS:
            continue
        tokens.append(token)
    return " ".join(tokens).strip()


def _extract_equipment_search_hints(query: str) -> dict[str, Any]:
    normalized = _normalize_search_text(query)
    if not normalized:
        return {}

    type_query = ""
    type_match_terms: tuple[str, ...] = ()
    matched_aliases: tuple[str, ...] = ()
    normalized_tokens = set(_search_tokens(normalized))
    for aliases, canonical, match_terms in _EQUIPMENT_TYPE_ALIASES:
        normalized_aliases = tuple(_normalize_search_text(alias) for alias in aliases)
        if any((" " in alias and alias in normalized) or alias in normalized_tokens for alias in normalized_aliases):
            type_query = canonical
            type_match_terms = tuple(_normalize_search_text(term) for term in match_terms)
            matched_aliases = normalized_aliases
            break

    place_query = ""
    marker_match = re.search(
        r"(?:^|\s)(?:по\s+адресу|адрес(?:е)?|локаци(?:я|и)|филиал(?:е)?|на|в)\s+(.+)$",
        normalized,
    )
    if marker_match:
        place_query = _strip_query_noise(marker_match.group(1), type_aliases=matched_aliases)
    if not place_query and type_query:
        place_query = _strip_query_noise(normalized, type_aliases=matched_aliases)

    hints: dict[str, Any] = {}
    if type_query:
        hints["type_query"] = type_query
        hints["type_match_terms"] = type_match_terms
    if place_query:
        hints["place_query"] = place_query
        hints["place_tokens"] = _search_tokens(place_query)
    return hints


def _equipment_row_key(row: dict[str, Any]) -> str:
    for key in ("inv_no", "inventory_number", "inventory_no", "serial_no", "serial_number", "hw_serial_no"):
        value = _normalize_text(_row_value(row, key))
        if value:
            return f"{key}:{value}"
    return "|".join(_normalize_text(value) for value in row.values())[:300]


def _equipment_row_matches_hints(row: dict[str, Any], hints: dict[str, Any]) -> bool:
    type_terms = tuple(hints.get("type_match_terms") or ())
    if type_terms:
        type_text = _normalize_search_text(
            " ".join(
                [
                    _normalize_text(_row_value(row, "type_name", "item_type", "type")),
                    _normalize_text(_row_value(row, "model_name", "model")),
                    _normalize_text(_row_value(row, "name", "equipment_name", "item_name", "description")),
                ]
            )
        )
        if not any(term and term in type_text for term in type_terms):
            return False

    place_tokens = list(hints.get("place_tokens") or [])
    if place_tokens:
        place_text = _normalize_search_text(
            " ".join(
                [
                    _normalize_text(_row_value(row, "branch", "branch_name", "filial", "company")),
                    _normalize_text(_row_value(row, "location", "location_name", "room", "cabinet")),
                    _normalize_text(_row_value(row, "summary")),
                ]
            )
        )
        if not all(token in place_text for token in place_tokens):
            return False
    return True


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _calculate_agent_status(last_seen_at: int) -> str:
    """Determine agent status based on last heartbeat timestamp."""
    from backend.services.inventory_read import ONLINE_MAX_AGE_SECONDS, STALE_MAX_AGE_SECONDS

    if not last_seen_at:
        return "unknown"
    age = int(time.time()) - last_seen_at
    if age <= ONLINE_MAX_AGE_SECONDS:
        return "online"
    elif age <= STALE_MAX_AGE_SECONDS:
        return "stale"
    else:
        return "offline"


def _normalize_equipment_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    inv_no = _truncate_text(_row_value(row, "inv_no", "inventory_number", "inventory_no"), limit=120)
    serial_no = _truncate_text(_row_value(row, "serial_no", "serial_number", "sn"), limit=180)
    hardware_serial = _truncate_text(_row_value(row, "hardware_serial", "hw_serial", "hw_serial_no"), limit=180)
    type_name = _truncate_text(_row_value(row, "type_name", "item_type", "type"), limit=180)
    model_name = _truncate_text(_row_value(row, "model_name", "model"), limit=220)
    vendor_name = _truncate_text(_row_value(row, "vendor_name", "vendor"), limit=180)
    item_name = model_name or _truncate_text(
        _row_value(row, "name", "equipment_name", "item_name", "description", "item_type"),
        limit=220,
    ) or type_name
    owner_name = _truncate_text(_row_value(row, "employee_name", "fio", "owner_fio", "owner_name", "user_fio"), limit=180)
    employee_email = _truncate_text(_row_value(row, "employee_email", "owner_email", "email"), limit=220)
    department = _truncate_text(_row_value(row, "department", "employee_dept", "owner_dept", "otdel"), limit=180)
    branch = _truncate_text(_row_value(row, "branch", "branch_name", "filial", "company"), limit=180)
    location = _truncate_text(_row_value(row, "location", "location_name", "room", "cabinet"), limit=180)
    network_name = _truncate_text(_row_value(row, "network_name", "hostname", "host_name", "netbios_name"), limit=180)
    ip_address = _truncate_text(_row_value(row, "ip_address", "ip"), limit=120)
    mac_address = _truncate_text(_row_value(row, "mac_address", "mac"), limit=180)
    domain_name = _truncate_text(_row_value(row, "domain_name", "domain"), limit=180)
    description = _truncate_text(_row_value(row, "description", "descr"), limit=280)
    part_no = _truncate_text(_row_value(row, "part_no"), limit=180)
    qty = _coerce_int(_row_value(row, "qty"))
    status = _truncate_text(_row_value(row, "status", "status_name", "item_status"), limit=120)
    summary_parts = [
        item_name or type_name,
        vendor_name,
        f"inv {inv_no}" if inv_no else "",
        owner_name,
        department,
        status,
        location,
    ]
    return {
        "inv_no": inv_no or None,
        "serial_no": serial_no or None,
        "hardware_serial": hardware_serial or None,
        "name": item_name or None,
        "type_name": type_name or None,
        "model_name": model_name or None,
        "vendor_name": vendor_name or None,
        "part_no": part_no or None,
        "owner_name": owner_name or None,
        "employee_name": owner_name or None,
        "employee_email": employee_email or None,
        "department": department or None,
        "branch": branch or None,
        "location": location or None,
        "network_name": network_name or None,
        "ip_address": ip_address or None,
        "mac_address": mac_address or None,
        "domain_name": domain_name or None,
        "status": status or None,
        "description": description or None,
        "qty": qty,
        "summary": ", ".join([part for part in summary_parts if part]),
        "source": _build_source(database_id),
    }


def _normalize_employee_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    owner_no = _row_value(row, "owner_no", "id", "employee_id")
    full_name = _truncate_text(_row_value(row, "fio", "full_name", "name", "owner_display_name"), limit=180)
    department = _truncate_text(_row_value(row, "department", "employee_dept", "owner_dept", "otdel"), limit=180)
    branch = _truncate_text(_row_value(row, "branch", "branch_name", "filial"), limit=180)
    position = _truncate_text(_row_value(row, "job_title", "position", "dolzhnost"), limit=180)
    equipment_count = _coerce_int(_row_value(row, "equipment_count", "count"))
    return {
        "owner_no": int(owner_no) if str(owner_no or "").strip().isdigit() else owner_no,
        "full_name": full_name or None,
        "department": department or None,
        "branch": branch or None,
        "position": position or None,
        "equipment_count": equipment_count,
        "summary": ", ".join(
            [
                part
                for part in [
                    full_name,
                    department,
                    position,
                    branch,
                    f"техники: {equipment_count}" if equipment_count is not None else "",
                ]
                if part
            ]
        ),
        "source": _build_source(database_id),
    }


def _normalize_branch_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    branch_no = _truncate_text(_row_value(row, "branch_no", "branch_id", "id"), limit=60)
    branch_name = _truncate_text(_row_value(row, "branch", "branch_name", "name", "description"), limit=220)
    return {
        "branch_no": branch_no or None,
        "name": branch_name or None,
        "summary": ", ".join([part for part in [branch_no, branch_name] if part]),
        "source": _build_source(database_id),
    }


def _normalize_location_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    location_no = _truncate_text(_row_value(row, "location_no", "location_id", "id"), limit=60)
    location_name = _truncate_text(_row_value(row, "location", "location_name", "name", "description"), limit=220)
    branch_no = _truncate_text(_row_value(row, "branch_no", "branch_id"), limit=60)
    branch_name = _truncate_text(_row_value(row, "branch", "branch_name"), limit=180)
    return {
        "location_no": location_no or None,
        "name": location_name or None,
        "branch_no": branch_no or None,
        "branch_name": branch_name or None,
        "summary": ", ".join([part for part in [location_name, branch_name, branch_no] if part]),
        "source": _build_source(database_id),
    }


def _normalize_equipment_type_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    ci_type = _coerce_int(_row_value(row, "ci_type"))
    type_no = _coerce_int(_row_value(row, "type_no"))
    name = _truncate_text(_row_value(row, "type_name", "name", "description"), limit=220)
    return {
        "ci_type": ci_type,
        "type_no": type_no,
        "name": name or None,
        "summary": ", ".join([part for part in [name, f"TYPE_NO {type_no}" if type_no is not None else ""] if part]),
        "source": _build_source(database_id),
    }


def _normalize_status_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    status_no = _coerce_int(_row_value(row, "status_no", "id"))
    status_name = _truncate_text(_row_value(row, "status_name", "status", "name", "description"), limit=220)
    return {
        "status_no": status_no,
        "status_name": status_name or None,
        "summary": ", ".join(
            [part for part in [status_name, f"STATUS_NO {status_no}" if status_no is not None else ""] if part]
        ),
        "source": _build_source(database_id),
    }


def _normalize_consumable_item(row: dict[str, Any], *, database_id: str | None) -> dict[str, Any]:
    item_id = _coerce_int(_row_value(row, "id"))
    inv_no = _truncate_text(_row_value(row, "inv_no", "inventory_number", "inventory_no"), limit=120)
    type_no = _coerce_int(_row_value(row, "type_no"))
    model_no = _coerce_int(_row_value(row, "model_no"))
    qty = _coerce_int(_row_value(row, "qty"))
    part_no = _truncate_text(_row_value(row, "part_no"), limit=180)
    description = _truncate_text(_row_value(row, "description", "descr"), limit=280)
    type_name = _truncate_text(_row_value(row, "type_name", "item_type", "type"), limit=180)
    model_name = _truncate_text(_row_value(row, "model_name", "model", "name"), limit=220)
    branch_no = _truncate_text(_row_value(row, "branch_no", "branch_id"), limit=60)
    branch = _truncate_text(_row_value(row, "branch", "branch_name", "filial", "company"), limit=180)
    location_no = _truncate_text(_row_value(row, "location_no", "loc_no", "location_id"), limit=60)
    location = _truncate_text(_row_value(row, "location", "location_name", "room", "cabinet"), limit=180)
    summary_parts = [
        model_name or type_name,
        f"qty {qty}" if qty is not None else "",
        branch,
        location,
    ]
    return {
        "id": item_id,
        "inv_no": inv_no or None,
        "type_no": type_no,
        "model_no": model_no,
        "qty": qty,
        "part_no": part_no or None,
        "description": description or None,
        "type_name": type_name or None,
        "model_name": model_name or None,
        "branch_no": branch_no or None,
        "branch": branch or None,
        "location_no": location_no or None,
        "location": location or None,
        "summary": ", ".join([part for part in summary_parts if part]),
        "source": _build_source(database_id),
    }


EQUIPMENT_ANALYTICS_GROUPS: dict[str, tuple[str, ...]] = {
    "branch": ("branch", "branch_name", "filial", "company"),
    "location": ("location", "location_name", "room", "cabinet"),
    "type": ("type_name", "item_type", "type"),
    "status": ("status", "status_name", "item_status"),
    "owner_department": ("department", "employee_dept", "owner_dept", "otdel"),
    "owner": ("employee_name", "fio", "owner_fio", "owner_name", "user_fio"),
    "model": ("model_name", "model"),
    "vendor": ("vendor_name", "vendor"),
}
CONSUMABLE_ANALYTICS_GROUPS: dict[str, tuple[str, ...]] = {
    "branch": ("branch", "branch_name", "filial", "company"),
    "location": ("location", "location_name", "room", "cabinet"),
    "type": ("type_name", "item_type", "type"),
    "model": ("model_name", "model", "name"),
}
ANALYTICS_FILTER_FIELDS: tuple[tuple[str, ...], ...] = (
    ("branch", "branch_name", "filial", "company"),
    ("location", "location_name", "room", "cabinet"),
    ("type_name", "item_type", "type"),
    ("model_name", "model", "name"),
    ("vendor_name", "vendor"),
    ("status", "status_name", "item_status"),
    ("employee_name", "fio", "owner_fio", "owner_name", "user_fio"),
    ("department", "employee_dept", "owner_dept", "otdel"),
    ("description", "descr"),
)


def _analytics_group_value(row: dict[str, Any], candidates: tuple[str, ...]) -> str:
    return _truncate_text(_row_value(row, *candidates), limit=220) or "Unspecified"


def _analytics_row_matches_query(row: dict[str, Any], query: str | None) -> bool:
    query_text = _normalize_text(query).lower()
    if not query_text:
        return True
    haystack = " ".join(
        _normalize_text(_row_value(row, *candidates))
        for candidates in ANALYTICS_FILTER_FIELDS
    ).lower()
    return query_text in haystack


def _build_analytics_rows(
    rows: list[dict[str, Any]],
    *,
    group_candidates: tuple[str, ...],
    scope: str,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = _analytics_group_value(row, group_candidates)
        item = grouped.setdefault(key, {"key": key, "count": 0})
        item["count"] += 1
        if scope == "consumables":
            item["qty_total"] = int(item.get("qty_total") or 0) + int(_coerce_int(_row_value(row, "qty")) or 0)
    ordered = sorted(grouped.values(), key=lambda item: (-int(item.get("count") or 0), str(item.get("key") or "")))
    return ordered[: _safe_limit(limit)], len(ordered)


class _LimitMixin(BaseModel):
    limit: int = Field(default=DEFAULT_RESULT_LIMIT, ge=1, le=MAX_RESULT_LIMIT)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("database_id", mode="before")
    @classmethod
    def _normalize_database_id(cls, value):
        text = _normalize_text(value)
        return text or None


class DatabaseCurrentArgs(BaseModel):
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("database_id", mode="before")
    @classmethod
    def _normalize_database_id(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentSearchArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class EquipmentGetCardArgs(BaseModel):
    inv_no: str = Field(..., min_length=1, max_length=120)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", mode="before")
    @classmethod
    def _normalize_inv_no(cls, value):
        return _normalize_text(value)

    @field_validator("database_id", mode="before")
    @classmethod
    def _normalize_database_id(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentSearchUniversalArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class EquipmentListByBranchArgs(_LimitMixin):
    branch_name: str = Field(..., min_length=1, max_length=180)

    @field_validator("branch_name", mode="before")
    @classmethod
    def _normalize_branch_name(cls, value):
        return _normalize_text(value)


class EmployeeSearchArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class EmployeeListEquipmentArgs(_LimitMixin):
    owner_no: int = Field(..., ge=1)
    compare_1c: bool = Field(default=False, description=(
        "For an explicit ITinvent vs connected 1C warehouse comparison, include the existing portal "
        "employee comparison/highlight summary. Resolve OWNER_NO with employee.search first."
    ))


class ConsumablesSearchArgs(_LimitMixin):
    query: Optional[str] = Field(default=None, max_length=120)
    branch_no: Optional[str] = Field(default=None, max_length=120)
    only_positive_qty: bool = True

    @field_validator("query", "branch_no", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class DirectoryBranchesArgs(_LimitMixin):
    pass


class DirectoryLocationsArgs(_LimitMixin):
    branch_no: Optional[str] = Field(default=None, max_length=120)

    @field_validator("branch_no", mode="before")
    @classmethod
    def _normalize_branch_no(cls, value):
        text = _normalize_text(value)
        return text or None


class DirectoryEquipmentTypesArgs(_LimitMixin):
    query: Optional[str] = Field(default=None, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        text = _normalize_text(value)
        return text or None


class DirectoryStatusesArgs(_LimitMixin):
    query: Optional[str] = Field(default=None, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentSearchMultiDbArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class AnalyticsSummaryArgs(_LimitMixin):
    scope: Literal["equipment", "consumables"] = "equipment"
    group_by: str = Field(default="branch", max_length=80)
    query: Optional[str] = Field(default=None, max_length=120)
    only_positive_qty: bool = True

    @field_validator("scope", mode="before")
    @classmethod
    def _normalize_scope(cls, value):
        return _normalize_text(value).lower() or "equipment"

    @field_validator("group_by", mode="before")
    @classmethod
    def _normalize_group_by(cls, value):
        return _normalize_text(value).lower() or "branch"

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class EntityResolveArgs(_LimitMixin):
    entity: Literal["equipment", "employee", "branch", "location", "status", "consumable"] = "equipment"
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("entity", mode="before")
    @classmethod
    def _normalize_entity(cls, value):
        return _normalize_text(value).lower() or "equipment"

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class TransferDraftArgs(BaseModel):
    inv_nos: list[str] = Field(..., min_length=1, max_length=50)
    new_employee: str = Field(..., min_length=2, max_length=180)
    new_employee_no: Optional[int] = Field(default=None, ge=1)
    new_employee_dept: Optional[str] = Field(default=None, max_length=180)
    branch_no: Optional[str | int] = None
    loc_no: Optional[str | int] = None
    comment: Optional[str] = Field(default=None, max_length=500)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_nos", mode="before")
    @classmethod
    def _normalize_inv_nos(cls, value):
        items = value if isinstance(value, list) else [value]
        result: list[str] = []
        for item in items:
            text = _normalize_text(item)
            if text and text not in result:
                result.append(text)
        return result

    @field_validator("new_employee", "new_employee_dept", "comment", "database_id", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class ConsumableDraftArgs(BaseModel):
    item_id: Optional[int] = Field(default=None, ge=1)
    inv_no: Optional[str] = Field(default=None, max_length=120)
    qty: int = Field(..., ge=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "reason", "database_id", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class DatabaseCurrentTool(AiTool):
    tool_id = ITINVENT_TOOL_DATABASE_CURRENT
    description = "Return the current ITinvent database and, for admin multi-db bots, available database targets."
    input_model = DatabaseCurrentArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        database_meta = next(
            (item for item in get_available_database_options() if _normalize_text(item.get("id")) == database_id),
            None,
        )
        admin_targets = context.resolve_multi_db_targets()
        return AiToolResult(
            tool_id=self.tool_id,
            ok=bool(database_id),
            database_id=database_id or None,
            data={
                "database_id": database_id or None,
                "database_name": _normalize_text((database_meta or {}).get("name")) or database_id or None,
                "is_admin": bool(context.is_admin),
                "multi_db_mode": context.multi_db_mode,
                "available_databases": (
                    get_available_database_options()
                    if context.is_admin and context.multi_db_mode == "admin_multi_db"
                    else []
                ),
                "multi_db_targets": admin_targets,
            },
            sources=[_build_source(database_id)] if database_id else [],
            error=None if database_id else _database_error(self.tool_id, getattr(args, "database_id", None)).error,
        )


class EquipmentSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_SEARCH
    description = "Search ITinvent equipment by inventory number, serial number, or hardware serial."
    input_model = EquipmentSearchArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentSearchArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.search_equipment_by_serial(args.query, database_id)
        total = len(rows or [])
        items = [
            _normalize_equipment_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentSearchUniversalTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL
    description = (
        "Search ITinvent equipment across type, model, vendor, owner, department, branch, location and network fields. "
        "Understands compound requests like equipment type plus branch, location or address."
    )
    input_model = EquipmentSearchUniversalArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentSearchUniversalArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.search_equipment_universal(args.query, page=1, limit=args.limit, db_id=database_id)
        raw_items = list((rows or {}).get("equipment") or [])
        total = int((rows or {}).get("total") or len(raw_items))
        query_hints = _extract_equipment_search_hints(args.query)
        expanded_terms: list[str] = []
        if query_hints:
            merged: dict[str, dict[str, Any]] = {
                _equipment_row_key(row): row for row in raw_items if isinstance(row, dict)
            }
            if not any(_equipment_row_matches_hints(row, query_hints) for row in merged.values()):
                for term in [query_hints.get("type_query"), query_hints.get("place_query")]:
                    search_term = _normalize_text(term)
                    if not search_term or search_term == args.query or search_term in expanded_terms:
                        continue
                    expanded_terms.append(search_term)
                    expanded_rows = queries.search_equipment_universal(
                        search_term,
                        page=1,
                        limit=args.limit,
                        db_id=database_id,
                    )
                    for row in list((expanded_rows or {}).get("equipment") or []):
                        if isinstance(row, dict):
                            merged.setdefault(_equipment_row_key(row), row)
            filtered_items = [
                row for row in merged.values() if isinstance(row, dict) and _equipment_row_matches_hints(row, query_hints)
            ]
            raw_items = filtered_items
            total = len(filtered_items)
        items = [
            _normalize_equipment_item(row, database_id=database_id)
            for row in _cap_rows(raw_items, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "query_hints": {
                    key: value
                    for key, value in {
                        "type": query_hints.get("type_query"),
                        "place": query_hints.get("place_query"),
                    }.items()
                    if value
                },
                "expanded_search_terms": expanded_terms,
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


EXPORT_MAX_ROWS = 5000
EXPORT_PAGE_SIZE = 250
EXPORT_COLUMNS: dict[str, tuple[str, str]] = {
    "type": ("type_name", "Тип"),
    "model": ("model_name", "Модель"),
    "vendor": ("vendor_name", "Производитель"),
    "inv_no": ("inv_no", "Инв. номер"),
    "serial_no": ("serial_no", "Серийный номер"),
    "owner": ("owner_name", "Сотрудник"),
    "department": ("department", "Отдел"),
    "status": ("status", "Статус"),
    "branch": ("branch", "Филиал"),
    "location": ("location", "Локация"),
    "network_name": ("network_name", "Сетевое имя"),
    "ip_address": ("ip_address", "IP"),
    "mac_address": ("mac_address", "MAC"),
    "description": ("description", "Описание"),
}
EXPORT_DEFAULT_COLUMNS = ["model", "inv_no", "serial_no", "owner", "status", "branch", "location"]


class EquipmentExportArgs(BaseModel):
    query: str = Field(..., min_length=1, max_length=120)
    columns: list[Literal[tuple(EXPORT_COLUMNS)]] = Field(default_factory=lambda: list(EXPORT_DEFAULT_COLUMNS), max_length=len(EXPORT_COLUMNS))
    format: Literal["xlsx", "csv"] = "xlsx"
    file_name: str = Field(default="equipment_export", max_length=120)
    title: str = Field(default="Выгрузка оборудования", max_length=200)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("query", "file_name", "title", mode="before")
    @classmethod
    def _normalize_strings(cls, value):
        return _normalize_text(value)

    @field_validator("database_id", mode="before")
    @classmethod
    def _normalize_database_id(cls, value):
        return _normalize_text(value) or None


def _fetch_universal_rows(query: str, database_id: str, *, max_rows: int) -> tuple[list[dict[str, Any]], int]:
    """Read every page of the universal search on the server (the model never sees the rows)."""
    rows: list[dict[str, Any]] = []
    total = 0
    page = 1
    while len(rows) < max_rows:
        chunk = queries.search_equipment_universal(query, page=page, limit=EXPORT_PAGE_SIZE, db_id=database_id)
        batch = [row for row in list((chunk or {}).get("equipment") or []) if isinstance(row, dict)]
        total = max(total, int((chunk or {}).get("total") or 0))
        if not batch:
            break
        rows.extend(batch)
        if len(rows) >= total or len(batch) < EXPORT_PAGE_SIZE:
            break
        page += 1
    return rows[:max_rows], total


class EquipmentExportTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_EXPORT
    description = (
        "Build an Excel (xlsx) or CSV file with ALL equipment matching a search phrase. The server reads every page and "
        "writes the file itself, so use this INSTEAD of search + ai.files.report whenever the user asks for a file/Excel/table "
        "export of equipment (any number of rows). query is a universal search phrase like 'телефонный аппарат Panasonic' or "
        "'монитор Первомайская 21'. columns: type, model, vendor, inv_no, serial_no, owner, department, status, branch, "
        "location, network_name, ip_address, mac_address, description (default: model, inv_no, serial_no, owner, status, "
        "branch, location). Returns only a short summary; the file is attached to the chat automatically."
    )
    input_model = EquipmentExportArgs
    stage = "generating_files"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentExportArgs) -> AiToolResult:
        if not bool(context.allow_generated_artifacts):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Generated files are disabled for this bot.")
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        raw_items, total = _fetch_universal_rows(args.query, database_id, max_rows=EXPORT_MAX_ROWS)
        hints = _extract_equipment_search_hints(args.query)
        if hints:
            merged = {_equipment_row_key(row): row for row in raw_items}
            if not any(_equipment_row_matches_hints(row, hints) for row in merged.values()):
                for term in [hints.get("type_query"), hints.get("place_query")]:
                    search_term = _normalize_text(term)
                    if not search_term or search_term == args.query:
                        continue
                    extra, _ = _fetch_universal_rows(search_term, database_id, max_rows=EXPORT_MAX_ROWS)
                    for row in extra:
                        merged.setdefault(_equipment_row_key(row), row)
            raw_items = [row for row in merged.values() if _equipment_row_matches_hints(row, hints)]
            total = len(raw_items)
        if not raw_items:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                database_id=database_id,
                error=f"Nothing found for '{args.query}', the file was not created.",
                sources=[_build_source(database_id)],
            )
        items = [_normalize_equipment_item(row, database_id=database_id) for row in raw_items]
        columns = list(dict.fromkeys(args.columns or EXPORT_DEFAULT_COLUMNS))
        table = [[EXPORT_COLUMNS[key][1] for key in columns]]
        table.extend([_normalize_text(item.get(EXPORT_COLUMNS[key][0])) for key in columns] for item in items)
        base_name = re.sub(r"[^\w.-]+", "_", args.file_name or "equipment_export", flags=re.UNICODE).strip("_") or "equipment_export"
        spec: dict[str, Any] = {
            "format": args.format,
            "file_name": base_name,
            "title": args.title,
            "metadata": {"report": True, "source": "itinvent.equipment.export", "query": args.query},
        }
        if args.format == "xlsx":
            spec["sheets"] = [{"title": "Оборудование", "rows": table, "header_row_index": 1}]
        else:
            spec["rows"] = table
        try:
            from backend.ai_chat.artifact_generator import GeneratedFileError, normalize_generated_file_specs

            files = normalize_generated_file_specs([spec])
        except GeneratedFileError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                "rows_exported": len(items),
                "total_found": total,
                "truncated": total > len(items) and not hints,
                "columns": [EXPORT_COLUMNS[key][1] for key in columns],
                "files": files,
                "count": len(files),
            },
            sources=[_build_source(database_id)],
        )


class EquipmentGetCardTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_GET_CARD
    description = "Open a full equipment card by inventory number."
    input_model = EquipmentGetCardArgs
    stage = "opening_equipment_card"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentGetCardArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        row = queries.get_equipment_by_inv(args.inv_no, database_id)
        if not isinstance(row, dict):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                database_id=database_id,
                error=f"Equipment card was not found for inventory number {args.inv_no}.",
                sources=[_build_source(database_id)],
            )
        item = _normalize_equipment_item(row, database_id=database_id)
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "inv_no": args.inv_no,
                "item": item,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentListByBranchTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH
    description = "List branch equipment by exact ITinvent branch name."
    input_model = EquipmentListByBranchArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentListByBranchArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = equipment_db.get_equipment_by_branch(args.branch_name, page=1, limit=args.limit, db_id=database_id)
        total = int((rows or {}).get("total") or len((rows or {}).get("equipment") or []))
        items = [
            _normalize_equipment_item(row, database_id=database_id)
            for row in _cap_rows(list((rows or {}).get("equipment") or []), args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "branch_name": args.branch_name,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class EmployeeSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_EMPLOYEE_SEARCH
    description = "Search ITinvent employees by name or department."
    input_model = EmployeeSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: EmployeeSearchArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.search_employees(args.query, page=1, limit=args.limit, db_id=database_id)
        total = int((rows or {}).get("total") or len((rows or {}).get("employees") or []))
        items = [
            _normalize_employee_item(row, database_id=database_id)
            for row in _cap_rows(list((rows or {}).get("employees") or []), args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class EmployeeListEquipmentTool(AiTool):
    # Worker runs use different asyncio.run loops. Keep the portal service's
    # asyncio cache lock uncontended across those threads.
    _comparison_lock = threading.Lock()
    tool_id = ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT
    description = (
        "List equipment assigned to an employee by OWNER_NO in the selected ITinvent database. "
        "For 'сравни технику сотрудника в ITinvent и 1С / покажи расхождения', set compare_1c=true: "
        "returns the same comparison summary used by portal highlighting (nomenclature code and quantity, "
        "not proof of a serial-number match). Ambiguous employees must be clarified first."
    )
    input_model = EmployeeListEquipmentArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EmployeeListEquipmentArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.get_equipment_by_owner(args.owner_no, database_id)
        total = len(rows or [])
        items = [
            _normalize_equipment_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        comparison = None
        if args.compare_1c:
            comparison = self._comparison(context=context, owner_no=args.owner_no, database_id=database_id,
                                          equipment_rows=rows or [], limit=args.limit)
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "owner_no": args.owner_no,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
                **({"comparison_1c": comparison} if args.compare_1c else {}),
            },
            sources=[_build_source(database_id)] + (
                [{"system": "warehouse_1c", "source": comparison.get("meta", {}).get("source"),
                  "as_of": comparison.get("meta", {}).get("as_of")}]
                if comparison and comparison.get("meta") else []
            ),
        )

    @staticmethod
    def _comparison(*, context, owner_no, database_id, equipment_rows, limit):
        # Reuse the portal's badge/highlight service; do not build a second reconcile algorithm.
        from backend.ai_chat.tool_permissions import user_can_use_tool
        from backend.ai_chat.tools.warehouse import _warehouse_service, run_coroutine
        from backend.services.warehouse_1c_service import (
            EMPLOYEE_COMPARE_SUMMARY_TTL_SECONDS, WAREHOUSE_1C_FAILURE_CODES,
        )

        unavailable = {"status": "unknown", "complete": False, "matches_all": None,
                       "method": "nomenclature_code_and_quantity", "part_status": {}, "part_quantities": {}}
        employee_names = {_truncate_text(_row_value(row, "employee_name", "fio", "owner_name", "owner_display_name"), limit=180)
                          for row in equipment_rows if isinstance(row, dict)} - {""}
        if len(employee_names) == 1:
            unavailable["employee_name"] = employee_names.pop()
        if (WAREHOUSE_TOOL_BALANCES_SEARCH not in context.enabled_tools
                or not user_can_use_tool(WAREHOUSE_TOOL_BALANCES_SEARCH, context.user_payload)):
            return {**unavailable, "status": "forbidden", "reason": "Нет доступа к подключённому Складу 1С."}
        if not EmployeeListEquipmentTool._comparison_lock.acquire(timeout=30):
            return {**unavailable, "status": "error", "reason_code": "comparison_busy",
                    "reason": "Сверка занята другим запросом; повторите позже."}
        try:
            payload = run_coroutine(_warehouse_service().get_employee_compare_summary(db_id=database_id))
        except Exception as exc:
            reason_code = getattr(exc, "reason_code", None)
            if reason_code not in WAREHOUSE_1C_FAILURE_CODES:
                reason_code = "timeout" if isinstance(exc, TimeoutError) else "query_failed"
            logger.warning("ai employee comparison failed run_id=%s database_id=%s owner_no=%s error_type=%s reason_code=%s",
                           context.run_id, database_id, owner_no, type(exc).__name__, reason_code)
            return {**unavailable, "status": "error", "reason_code": reason_code,
                    "reason": "Сверка со Складом 1С недоступна."}
        finally:
            EmployeeListEquipmentTool._comparison_lock.release()
        meta = dict(payload.get("meta") or {})
        summary = next((row for row in payload.get("items") or [] if row.get("owner_no") == owner_no), None)
        if summary is None:
            return {**unavailable, "meta": meta, "reason": "Сводка сверки для сотрудника отсутствует."}
        counts = dict(summary.get("counts") or {})
        status = str(summary.get("status") or "unknown")
        quantities = dict(summary.get("part_quantities") or {})
        # Fresh data can contain only cards without linkage codes. Source loading
        # succeeded even though there is no position that can be compared.
        only_unlinked = (status == "unknown" and not quantities and counts.get("hub_items", 0) > 0
                         and (counts.get("no_part", 0) + counts.get("not_in_1c", 0)) == counts["hub_items"])
        complete = (meta.get("status") == "ok" and meta.get("balances_status") == "ok"
                    and not any(meta.get(key) for key in (
                        "truncated", "has_more", "balances_truncated", "catalog_truncated"))
                    and (status in {"match", "diff", "only_hub", "only_1c"} or only_unlinked))
        try:
            as_of = datetime.fromisoformat(str(meta.get("as_of") or "").replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - as_of).total_seconds()
            complete = complete and 0 <= age <= EMPLOYEE_COMPARE_SUMMARY_TTL_SECONDS
        except (ValueError, TypeError):
            complete = False
        # A cached snapshot must not override equipment that has already changed.
        current_counts = {}
        for row in equipment_rows:
            code = _normalize_text(_row_value(row, "part_no"))
            if queries._is_usable_hub_part_no(code):
                key = queries._normalize_hub_part_no_text(code)
                current_counts[key] = current_counts.get(key, 0) + 1
        snapshot_counts = {key: value.get("hub_count") for key, value in quantities.items() if value.get("hub_count")}
        if snapshot_counts != current_counts or counts.get("hub_items") != len(equipment_rows):
            complete = False
        for value in quantities.values():
            qty = value.get("qty_1c")
            if qty is not None and (isinstance(qty, bool) or not isinstance(qty, (int, float)) or not math.isfinite(qty) or qty < 0):
                complete = False
        if not complete:
            for key in ("match", "diff", "only_hub", "only_1c"):
                counts[key] = None
        keys = sorted(quantities, key=lambda key: (summary.get("part_status", {}).get(key) == "match", key))[:_safe_limit(limit)] if complete else []
        truncated = complete and len(quantities) > len(keys)
        coverage_complete = complete and not counts.get("no_part") and not counts.get("not_in_1c") and not truncated
        matches_all = (status == "match" if coverage_complete else None)
        counts["matched_items"] = (sum(value.get("hub_count") or 0 for key, value in quantities.items()
                                        if summary.get("part_status", {}).get(key) == "match") if complete else None)
        counts["one_c_positions"] = (sum(value.get("qty_1c") is not None for value in quantities.values())
                                      if complete else None)
        counts["one_c_units"] = (sum(value.get("qty_1c") or 0 for value in quantities.values())
                                  if complete else None)
        if counts["one_c_units"] is not None and not math.isfinite(counts["one_c_units"]):
            counts["one_c_units"] = None
        unverified_items = [
            {"inv_no": _row_value(row, "inv_no"), "model_name": _row_value(row, "model_name"),
             "type_name": _row_value(row, "type_name")}
            for row in equipment_rows if not queries._is_usable_hub_part_no(_row_value(row, "part_no"))
        ][:_safe_limit(limit)]
        part_names = dict(summary.get("part_names") or {})
        missing_names = [key for key in keys if not part_names.get(key)]
        if missing_names:
            try:
                catalog = _warehouse_service().lookup_nomenclature_codes(missing_names)
                part_names.update({key: _truncate_text(row.get("name"), limit=220)
                                   for key, row in catalog.items() if isinstance(row, dict) and row.get("name")})
            except Exception as exc:
                # Missing labels must not discard valid quantities or leak transport details.
                logger.warning("ai comparison name lookup failed error_type=%s", type(exc).__name__)
        return {**unavailable, "employee_name": summary.get("employee_name"),
                "warehouse_ref": summary.get("warehouse_ref"), "warehouse_name": summary.get("warehouse_name"),
                "status": status if complete or status in {"ambiguous", "no_warehouse"} else "unknown",
                "complete": complete, "matches_all": matches_all, "meta": meta, "counts": counts,
                "part_status": {key: summary.get("part_status", {}).get(key) for key in keys},
                "part_quantities": {key: quantities[key] for key in keys},
                "part_names": {key: _truncate_text(part_names[key], limit=220) for key in keys if part_names.get(key)},
                "coverage_complete": coverage_complete, "unverified_items": unverified_items,
                "truncated": truncated,
                **({"reason_code": "invalid_quantity"} if meta.get("reason_code") == "invalid_quantity" else {}),
                "reason": ("Сопоставление по коду номенклатуры и количеству; серийные номера не проверены."
                           if complete else "Сверка не подтверждена: проверьте выбор склада и полноту/давность данных.")}


class ConsumablesSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_CONSUMABLES_SEARCH
    description = "Search consumables, cartridges and components with quantity and branch/location metadata."
    input_model = ConsumablesSearchArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: ConsumablesSearchArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        fetch_limit = max(int(args.limit or DEFAULT_RESULT_LIMIT), 1) * 20
        raw_rows = list(
            queries.get_consumables_lookup(
                db_id=database_id,
                model_name=None,
                branch_no=args.branch_no,
                only_positive_qty=bool(args.only_positive_qty),
                limit=max(50, min(fetch_limit, ANALYTICS_CONSUMABLES_SOURCE_LIMIT)),
            )
            or []
        )
        query_text = _normalize_text(args.query).lower()
        if query_text:
            filtered_rows = []
            for row in raw_rows:
                haystack = " ".join(
                    [
                        _normalize_text(_row_value(row, "inv_no")),
                        _normalize_text(_row_value(row, "type_name", "type")),
                        _normalize_text(_row_value(row, "model_name", "model", "name")),
                        _normalize_text(_row_value(row, "description", "descr")),
                        _normalize_text(_row_value(row, "branch_name", "branch")),
                        _normalize_text(_row_value(row, "location_name", "location")),
                    ]
                ).lower()
                if query_text in haystack:
                    filtered_rows.append(row)
        else:
            filtered_rows = raw_rows
        total = len(filtered_rows or [])
        items = [
            _normalize_consumable_item(row, database_id=database_id)
            for row in _cap_rows(filtered_rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                "branch_no": args.branch_no,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class DirectoryBranchesTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_BRANCHES
    description = "List ITinvent branches in the current database."
    input_model = DirectoryBranchesArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryBranchesArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.get_all_branches(database_id)
        total = len(rows or [])
        items = [
            _normalize_branch_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={**_result_metadata(returned_count=len(items), total=total, limit=args.limit), "items": items},
            sources=[_build_source(database_id)],
        )


class DirectoryEquipmentTypesTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES
    description = "List ITinvent equipment types."
    input_model = DirectoryEquipmentTypesArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryEquipmentTypesArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = list(queries.get_all_equipment_types(database_id) or [])
        query_text = _normalize_text(args.query).lower()
        if query_text:
            rows = [
                row
                for row in rows
                if query_text in _normalize_text(_row_value(row, "type_name", "name", "description")).lower()
            ]
        total = len(rows or [])
        items = [
            _normalize_equipment_type_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class DirectoryLocationsTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_LOCATIONS
    description = "List ITinvent locations in the current database, optionally filtered by branch."
    input_model = DirectoryLocationsArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryLocationsArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = queries.get_all_locations(database_id, branch_no=args.branch_no)
        total = len(rows or [])
        items = [
            _normalize_location_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "branch_no": args.branch_no,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class DirectoryStatusesTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_STATUSES
    description = "List ITinvent equipment statuses."
    input_model = DirectoryStatusesArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryStatusesArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        rows = list(queries.get_all_statuses(database_id) or [])
        query_text = _normalize_text(args.query).lower()
        if query_text:
            rows = [
                row
                for row in rows
                if query_text in _normalize_text(_row_value(row, "status_name", "status", "description")).lower()
            ]
        total = len(rows or [])
        items = [
            _normalize_status_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentSearchMultiDbTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB
    description = "Search equipment across multiple allowed ITinvent databases. Admin only."
    input_model = EquipmentSearchMultiDbArgs
    admin_only = True
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentSearchMultiDbArgs) -> AiToolResult:
        database_ids = [item for item in context.resolve_multi_db_targets() if item]
        if not database_ids:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Multi-database search is not configured for this bot.",
            )
        items: list[dict[str, Any]] = []
        sources: list[dict[str, str]] = []
        total = 0
        safe_limit = _safe_limit(args.limit)
        for database_id in database_ids:
            rows = queries.search_equipment_by_serial(args.query, database_id)
            total += len(rows or [])
            if len(items) < safe_limit:
                remaining_limit = safe_limit - len(items)
                normalized_rows = [
                    _normalize_equipment_item(row, database_id=database_id)
                    for row in _cap_rows(rows, remaining_limit)
                    if isinstance(row, dict)
                ]
                if normalized_rows:
                    items.extend(normalized_rows)
            sources.append(_build_source(database_id))
        capped_items = items[:safe_limit]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(capped_items), total=total, limit=args.limit),
                "items": capped_items,
            },
            sources=sources,
        )


class AnalyticsSummaryTool(AiTool):
    tool_id = ITINVENT_TOOL_ANALYTICS_SUMMARY
    description = (
        "Build read-only ITinvent inventory analytics grouped by branch, location, type, status, owner, model or vendor."
    )
    input_model = AnalyticsSummaryArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: AnalyticsSummaryArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))

        scope = _normalize_text(args.scope).lower() or "equipment"
        group_by = _normalize_text(args.group_by).lower() or "branch"
        group_map = CONSUMABLE_ANALYTICS_GROUPS if scope == "consumables" else EQUIPMENT_ANALYTICS_GROUPS
        group_candidates = group_map.get(group_by)
        if group_candidates is None:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                database_id=database_id,
                error=f"Unsupported analytics group_by '{group_by}' for scope '{scope}'.",
                sources=[_build_source(database_id)],
            )

        if scope == "consumables":
            source_rows = list(
                queries.get_consumables_lookup(
                    db_id=database_id,
                    only_positive_qty=bool(args.only_positive_qty),
                    limit=ANALYTICS_CONSUMABLES_SOURCE_LIMIT,
                )
                or []
            )
            source_total = len(source_rows)
            source_truncated = len(source_rows) >= ANALYTICS_CONSUMABLES_SOURCE_LIMIT
        else:
            source_rows = list(
                equipment_db.get_all_equipment_flat(
                    db_id=database_id,
                    limit=ANALYTICS_EQUIPMENT_SOURCE_LIMIT,
                )
                or []
            )
            try:
                source_total = int((queries.get_all_equipment(page=1, limit=1, db_id=database_id) or {}).get("total") or len(source_rows))
            except Exception:
                source_total = len(source_rows)
            source_truncated = source_total > len(source_rows)

        filtered_rows = [row for row in source_rows if isinstance(row, dict) and _analytics_row_matches_query(row, args.query)]
        rows, total_groups = _build_analytics_rows(
            filtered_rows,
            group_candidates=group_candidates,
            scope=scope,
            limit=args.limit,
        )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "scope": scope,
                "group_by": group_by,
                "query": args.query,
                "source_rows": len(filtered_rows),
                "source_total": source_total,
                "source_limit": ANALYTICS_CONSUMABLES_SOURCE_LIMIT if scope == "consumables" else ANALYTICS_EQUIPMENT_SOURCE_LIMIT,
                "source_truncated": source_truncated,
                **_result_metadata(returned_count=len(rows), total=total_groups, limit=args.limit),
                "rows": rows,
            },
            sources=[_build_source(database_id)],
        )


class EntityResolveTool(AiTool):
    tool_id = ITINVENT_TOOL_ENTITY_RESOLVE
    description = "Resolve exact ITinvent entities before drafting actions: equipment, employee, branch, location, status or consumable."
    input_model = EntityResolveArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: EntityResolveArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        entity = _normalize_text(args.entity).lower() or "equipment"
        query_text = _normalize_text(args.query)
        query_lower = query_text.lower()
        items: list[dict[str, Any]] = []
        total = 0
        if entity == "equipment":
            rows = list(queries.search_equipment_by_serial(query_text, database_id) or [])
            total = len(rows)
            items = [_normalize_equipment_item(row, database_id=database_id) for row in _cap_rows(rows, args.limit) if isinstance(row, dict)]
        elif entity == "employee":
            rows = queries.search_employees(query_text, page=1, limit=args.limit, db_id=database_id) or {}
            raw_items = list(rows.get("employees") or [])
            total = int(rows.get("total") or len(raw_items))
            items = [_normalize_employee_item(row, database_id=database_id) for row in _cap_rows(raw_items, args.limit) if isinstance(row, dict)]
        elif entity == "branch":
            rows = list(queries.get_all_branches(database_id) or [])
            filtered = [
                row for row in rows
                if query_lower in _normalize_text(_row_value(row, "branch", "branch_name", "name", "description")).lower()
                or query_lower in _normalize_text(_row_value(row, "branch_no", "branch_id", "id")).lower()
            ]
            total = len(filtered)
            items = [_normalize_branch_item(row, database_id=database_id) for row in _cap_rows(filtered, args.limit) if isinstance(row, dict)]
        elif entity == "location":
            rows = list(queries.get_all_locations(database_id) or [])
            filtered = [
                row for row in rows
                if query_lower in _normalize_text(_row_value(row, "location", "location_name", "name", "description")).lower()
                or query_lower in _normalize_text(_row_value(row, "location_no", "location_id", "id")).lower()
            ]
            total = len(filtered)
            items = [_normalize_location_item(row, database_id=database_id) for row in _cap_rows(filtered, args.limit) if isinstance(row, dict)]
        elif entity == "status":
            rows = list(queries.get_all_statuses(database_id) or [])
            filtered = [
                row for row in rows
                if query_lower in _normalize_text(_row_value(row, "status_name", "status", "name", "description")).lower()
                or query_lower in _normalize_text(_row_value(row, "status_no", "id")).lower()
            ]
            total = len(filtered)
            items = [_normalize_status_item(row, database_id=database_id) for row in _cap_rows(filtered, args.limit) if isinstance(row, dict)]
        elif entity == "consumable":
            rows = list(queries.get_consumables_lookup(db_id=database_id, limit=ANALYTICS_CONSUMABLES_SOURCE_LIMIT) or [])
            filtered = [
                row for row in rows
                if query_lower in " ".join([
                    _normalize_text(_row_value(row, "id")),
                    _normalize_text(_row_value(row, "inv_no")),
                    _normalize_text(_row_value(row, "type_name", "type")),
                    _normalize_text(_row_value(row, "model_name", "model", "name")),
                    _normalize_text(_row_value(row, "branch_name", "branch")),
                    _normalize_text(_row_value(row, "location_name", "location")),
                ]).lower()
            ]
            total = len(filtered)
            items = [_normalize_consumable_item(row, database_id=database_id) for row in _cap_rows(filtered, args.limit) if isinstance(row, dict)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "entity": entity,
                "query": query_text,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class TransferDraftTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTION_TRANSFER_DRAFT
    description = "Create a pending action card to transfer equipment. Does not modify ITinvent until a user confirms the card."
    input_model = TransferDraftArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: TransferDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.ai_chat.action_cards import build_transfer_draft

            card = build_transfer_draft(
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=database_id,
                payload=args.model_dump(),
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                database_id=database_id,
                error=str(exc),
                sources=[_build_source(database_id)],
            )


class ConsumableConsumeDraftTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTION_CONSUMABLE_CONSUME_DRAFT
    description = "Create a pending action card to consume/decrease consumable stock. Does not modify ITinvent until confirmation."
    input_model = ConsumableDraftArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ConsumableDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.ai_chat.action_cards import ACTION_CONSUMABLE_CONSUME, build_consumable_draft

            card = build_consumable_draft(
                action_type=ACTION_CONSUMABLE_CONSUME,
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=database_id,
                payload=args.model_dump(),
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc), sources=[_build_source(database_id)])


class ConsumableQtyDraftTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTION_CONSUMABLE_QTY_DRAFT
    description = "Create a pending action card to set exact consumable stock quantity. Does not modify ITinvent until confirmation."
    input_model = ConsumableDraftArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ConsumableDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.ai_chat.action_cards import ACTION_CONSUMABLE_QTY, build_consumable_draft

            card = build_consumable_draft(
                action_type=ACTION_CONSUMABLE_QTY,
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=database_id,
                payload=args.model_dump(),
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc), sources=[_build_source(database_id)])


class EquipmentHistoryArgs(BaseModel):
    inv_no: str = Field(..., min_length=1, max_length=120)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentActsArgs(BaseModel):
    inv_no: str = Field(..., min_length=1, max_length=120)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentModelsSearchArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class DirectoryVendorsArgs(_LimitMixin):
    query: Optional[str] = Field(default=None, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        text = _normalize_text(value)
        return text or None


class DirectoryDepartmentsArgs(_LimitMixin):
    query: Optional[str] = Field(default=None, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        text = _normalize_text(value)
        return text or None


class StatusChangeDraftArgs(BaseModel):
    inv_nos: list[str] = Field(..., min_length=1, max_length=50)
    new_status: str = Field(..., min_length=1, max_length=180)
    new_status_no: Optional[int] = Field(default=None, ge=1)
    comment: Optional[str] = Field(default=None, max_length=500)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_nos", mode="before")
    @classmethod
    def _normalize_inv_nos(cls, value):
        items = value if isinstance(value, list) else [value]
        result: list[str] = []
        for item in items:
            text = _normalize_text(item)
            if text and text not in result:
                result.append(text)
        return result

    @field_validator("new_status", "comment", "database_id", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class LocationChangeDraftArgs(BaseModel):
    inv_nos: list[str] = Field(..., min_length=1, max_length=50)
    new_branch: Optional[str] = Field(default=None, max_length=180)
    new_branch_no: Optional[str | int] = None
    new_location: Optional[str] = Field(default=None, max_length=180)
    new_location_no: Optional[str | int] = None
    comment: Optional[str] = Field(default=None, max_length=500)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_nos", mode="before")
    @classmethod
    def _normalize_inv_nos(cls, value):
        items = value if isinstance(value, list) else [value]
        result: list[str] = []
        for item in items:
            text = _normalize_text(item)
            if text and text not in result:
                result.append(text)
        return result

    @field_validator("new_branch", "new_location", "comment", "database_id", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class EquipmentHistoryTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_HISTORY
    description = "Get the transfer and change history for a specific equipment item by inventory number."
    input_model = EquipmentHistoryArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentHistoryArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.database.equipment_act_history_reads import get_equipment_history_by_inv
            rows = get_equipment_history_by_inv(args.inv_no, database_id) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "inv_no": args.inv_no,
                **_result_metadata(returned_count=len(rows), total=len(rows), limit=len(rows) + 1),
                "items": rows,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentActsTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_ACTS
    description = "Get documents (transfer acts) linked to a specific equipment item by inventory number."
    input_model = EquipmentActsArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentActsArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.database.equipment_act_history_reads import get_equipment_acts_by_inv
            rows = get_equipment_acts_by_inv(args.inv_no, database_id) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "inv_no": args.inv_no,
                **_result_metadata(returned_count=len(rows), total=len(rows), limit=len(rows) + 1),
                "items": rows,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentModelsSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_MODELS_SEARCH
    description = "Search equipment models and vendors in the ITinvent directory by name or keyword."
    input_model = EquipmentModelsSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentModelsSearchArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        from backend.database.connection import get_db
        db = get_db(database_id)
        query_param = f"%{args.query}%"
        sql = """
            SELECT TOP 100
                m.MODEL_NO as model_no,
                m.MODEL_NAME as model_name,
                t.TYPE_NAME as type_name,
                v.VENDOR_NAME as vendor_name
            FROM CI_MODELS m
            LEFT JOIN CI_TYPES t ON t.TYPE_NO = m.TYPE_NO AND t.CI_TYPE = m.CI_TYPE
            LEFT JOIN VENDORS v ON v.VENDOR_NO = m.VENDOR_NO
            WHERE m.CI_TYPE = 1
              AND (m.MODEL_NAME LIKE ? OR v.VENDOR_NAME LIKE ? OR t.TYPE_NAME LIKE ?)
            ORDER BY m.MODEL_NAME
        """
        try:
            rows = db.execute_query(sql, (query_param, query_param, query_param)) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        items = [
            {
                "model_no": row.get("model_no"),
                "model_name": _normalize_text(row.get("model_name")),
                "type_name": _normalize_text(row.get("type_name")),
                "vendor_name": _normalize_text(row.get("vendor_name")),
            }
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=len(rows), limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class DirectoryVendorsTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_VENDORS
    description = "List all vendors (manufacturers) registered in the ITinvent directory."
    input_model = DirectoryVendorsArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryVendorsArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        from backend.database.connection import get_db
        db = get_db(database_id)
        query_text = _normalize_text(args.query).lower()
        sql = "SELECT TOP 500 v.VENDOR_NO as vendor_no, v.VENDOR_NAME as vendor_name FROM VENDORS v ORDER BY v.VENDOR_NAME"
        try:
            rows = db.execute_query(sql, ()) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        filtered = [
            row for row in rows
            if isinstance(row, dict) and (
                not query_text or query_text in _normalize_text(row.get("vendor_name")).lower()
            )
        ]
        items = [
            {"vendor_no": row.get("vendor_no"), "vendor_name": _normalize_text(row.get("vendor_name"))}
            for row in _cap_rows(filtered, args.limit)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=len(filtered), limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class DirectoryDepartmentsTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_DEPARTMENTS
    description = "List all departments (owner departments) registered in ITinvent."
    input_model = DirectoryDepartmentsArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryDepartmentsArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        query_text = _normalize_text(args.query).lower()
        try:
            departments = queries.get_owner_departments(limit=500, db_id=database_id) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))
        filtered = [d for d in departments if not query_text or query_text in _normalize_text(d).lower()]
        items = filtered[: _safe_limit(args.limit)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                **_result_metadata(returned_count=len(items), total=len(filtered), limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class StatusChangeDraftTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTION_STATUS_CHANGE_DRAFT
    description = (
        "Create a pending action card to change equipment status. "
        "Does not modify ITinvent until the user confirms the card."
    )
    input_model = StatusChangeDraftArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: StatusChangeDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.appdb.db import app_session
            from backend.appdb.models import AppAiPendingAction
            from backend.ai_chat.action_cards import DRAFT_EXPIRES_IN, _utc_now, _json_dumps
            import uuid
            card_id = str(uuid.uuid4())
            payload = {
                "inv_nos": args.inv_nos,
                "new_status": args.new_status,
                "new_status_no": args.new_status_no,
                "comment": args.comment,
                "database_id": database_id,
            }
            expires_at = _utc_now() + DRAFT_EXPIRES_IN
            with app_session() as session:
                action = AppAiPendingAction(
                    id=card_id,
                    action_type=self.tool_id,
                    conversation_id=context.conversation_id,
                    run_id=context.run_id,
                    requester_user_id=int(context.user_id),
                    payload_json=_json_dumps(payload),
                    expires_at=expires_at,
                )
                session.add(action)
                session.commit()
            card = {"id": card_id, "action_type": self.tool_id, "payload": payload, "expires_at": expires_at.isoformat()}
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))


class LocationChangeDraftTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTION_LOCATION_CHANGE_DRAFT
    description = (
        "Create a pending action card to change equipment location or branch. "
        "Does not modify ITinvent until the user confirms the card."
    )
    input_model = LocationChangeDraftArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: LocationChangeDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.appdb.db import app_session
            from backend.appdb.models import AppAiPendingAction
            from backend.ai_chat.action_cards import DRAFT_EXPIRES_IN, _utc_now, _json_dumps
            import uuid
            card_id = str(uuid.uuid4())
            payload = {
                "inv_nos": args.inv_nos,
                "new_branch": args.new_branch,
                "new_branch_no": args.new_branch_no,
                "new_location": args.new_location,
                "new_location_no": args.new_location_no,
                "comment": args.comment,
                "database_id": database_id,
            }
            expires_at = _utc_now() + DRAFT_EXPIRES_IN
            with app_session() as session:
                action = AppAiPendingAction(
                    id=card_id,
                    action_type=self.tool_id,
                    conversation_id=context.conversation_id,
                    run_id=context.run_id,
                    requester_user_id=int(context.user_id),
                    payload_json=_json_dumps(payload),
                    expires_at=expires_at,
                )
                session.add(action)
                session.commit()
            card = {"id": card_id, "action_type": self.tool_id, "payload": payload, "expires_at": expires_at.isoformat()}
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))


class UserByNameArgs(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("name", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class UserByNameTool(AiTool):
    tool_id = ITINVENT_TOOL_USER_BY_NAME
    description = (
        "Search for a user/employee by name, surname, or login. "
        "Returns employee details including OWNER_NO, full name, department, email. "
        "Useful to resolve ambiguous employee names before looking up their equipment."
    )
    input_model = UserByNameArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: UserByNameArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            result = queries.search_employees(args.name, page=1, limit=10, db_id=database_id)
            employees = list((result or {}).get("employees") or [])
            # Also try direct owner lookup by name for exact matches
            owner_no = queries.get_owner_no_by_name(args.name, strict=False, db_id=database_id)
            owner_details = None
            if owner_no:
                owner_row = queries.get_owner_by_no(owner_no, db_id=database_id)
                if owner_row:
                    owner_details = dict(owner_row)
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={
                    "query": args.name,
                    "count": len(employees),
                    "employees": employees,
                    "exact_match": owner_details,
                },
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))


class UserFullContextArgs(BaseModel):
    query: str = Field(..., min_length=1, max_length=160,
        description="Фамилия, имя, логин или email сотрудника")
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("query", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class UserFullContextTool(AiTool):
    tool_id = ITINVENT_TOOL_USER_FULL_CONTEXT
    description = (
        "Get full IT context for an employee by name, surname, login, or email. "
        "Returns employee details, all assigned equipment, active computer sessions "
        "(hostname, IP, online/offline status from monitoring agent), and Active Directory info. "
        "Use this tool to check if an employee's computer is online."
    )
    input_model = UserFullContextArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: UserFullContextArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))

        query = args.query
        try:
            # Step 1: Search for employee — first try exact match, then fuzzy
            owner_no = queries.get_owner_no_by_name(query, strict=False, db_id=database_id)

            employee_row = None
            if owner_no:
                employee_row = queries.get_owner_by_no(owner_no, db_id=database_id)
            else:
                # Fallback: search_employees
                result = queries.search_employees(query, page=1, limit=5, db_id=database_id)
                employees = list((result or {}).get("employees") or [])
                if employees:
                    # Pick the first (best) match
                    employee_row = employees[0]
                    owner_no = employee_row.get("OWNER_NO") or employee_row.get("owner_no")
                    if owner_no is not None:
                        owner_no = int(owner_no)

            if not employee_row or not owner_no:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    database_id=database_id,
                    error=f"Сотрудник не найден по запросу: '{query}'",
                    sources=[_build_source(database_id)],
                )

            # Build employee section
            name = _normalize_text(
                employee_row.get("OWNER_DISPLAY_NAME")
                or employee_row.get("owner_display_name")
                or employee_row.get("name")
            )
            department = _normalize_text(
                employee_row.get("OWNER_DEPT")
                or employee_row.get("owner_dept")
                or employee_row.get("department")
            )
            login = _normalize_text(
                employee_row.get("OWNER_LOGIN")
                or employee_row.get("owner_login")
            ) or None
            email = _normalize_text(
                employee_row.get("OWNER_EMAIL")
                or employee_row.get("owner_email")
            ) or None
            branch = _normalize_text(
                employee_row.get("BRANCH_NAME")
                or employee_row.get("branch_name")
                or employee_row.get("branch")
            ) or None

            # If email not in row, try dedicated lookup
            if not email:
                email = queries.get_owner_email_by_no(owner_no, db_id=database_id)

            # Derive login from email if not available
            if not login and email and "@" in email:
                login = email.split("@", 1)[0]

            employee_section = {
                "name": name or None,
                "login": login,
                "department": department or None,
                "branch": branch,
                "email": email,
                "owner_no": owner_no,
            }

            # Equipment and AD will be added in subsequent tasks (2.4)
            # Step 2: Get equipment for this employee
            equipment_rows = queries.get_equipment_by_owner(owner_no, database_id)
            equipment_list = []
            for row in (equipment_rows or []):
                mac_address = _normalize_text(
                    _row_value(row, "mac_address", "mac")
                )
                hostname = _normalize_text(
                    _row_value(row, "network_name", "hostname", "host_name")
                )
                inv_no = _truncate_text(
                    _row_value(row, "inv_no", "inventory_number", "inventory_no"), limit=120
                ) or None
                serial_no = _truncate_text(
                    _row_value(row, "serial_no", "serial_number", "sn"), limit=180
                ) or None
                type_name = _truncate_text(
                    _row_value(row, "type_name", "item_type", "type"), limit=180
                ) or None
                model_name = _truncate_text(
                    _row_value(row, "model_name", "model"), limit=220
                ) or None
                status = _truncate_text(
                    _row_value(row, "status", "status_name", "item_status"), limit=120
                ) or None
                location = _truncate_text(
                    _row_value(row, "location", "location_name", "room", "cabinet"), limit=180
                ) or None

                # Agent enrichment
                ip_address = None
                agent_status = "unknown"
                agent_last_seen = None
                current_user = None

                if mac_address or hostname:
                    try:
                        from backend.services.inventory_read import get_inventory_host as _get_inventory_host, get_inventory_app_store as _get_inventory_app_store
                        host = None
                        # 1. Try by MAC address (most reliable)
                        if mac_address:
                            host = _get_inventory_host(mac_address)
                            logger.info("full_context enrichment MAC=%s -> host=%s", mac_address, type(host).__name__ if host else None)
                        # 2. Fallback: search by hostname
                        if not isinstance(host, dict) and hostname:
                            app_store = _get_inventory_app_store()
                            if app_store is not None:
                                found_keys = app_store.search_host_keys(
                                    hostname, {"identity"}
                                )
                                logger.info("full_context enrichment hostname=%s -> keys=%s", hostname, found_keys)
                                if found_keys:
                                    for found_mac in found_keys:
                                        host = _get_inventory_host(found_mac)
                                        if isinstance(host, dict):
                                            break
                        if isinstance(host, dict):
                            last_seen_raw = host.get("last_seen_at") or host.get("timestamp")
                            last_seen_at = int(last_seen_raw) if last_seen_raw else 0
                            agent_status = _calculate_agent_status(last_seen_at)
                            if last_seen_at > 0:
                                from datetime import datetime, timezone
                                agent_last_seen = datetime.fromtimestamp(
                                    last_seen_at, tz=timezone.utc
                                ).isoformat()
                            ip_address = _normalize_text(
                                host.get("ip_primary") or host.get("ip_address")
                            ) or None
                            current_user = _normalize_text(
                                host.get("current_user") or host.get("user_login")
                            ) or None
                    except Exception as exc:
                        # Snapshot unavailable — keep defaults
                        logger.warning("full_context enrichment failed for inv_no=%s: %s", inv_no, exc)
                        pass

                equipment_list.append({
                    "inv_no": inv_no,
                    "serial_no": serial_no,
                    "type": type_name,
                    "model": model_name,
                    "status": status,
                    "hostname": hostname or None,
                    "ip_address": ip_address,
                    "mac_address": mac_address or None,
                    "agent_status": agent_status,
                    "agent_last_seen": agent_last_seen,
                    "current_user": current_user,
                    "location": location,
                })

            # Step 2b: Find active sessions for this employee (hosts where they are logged in)
            active_sessions = []
            try:
                from backend.services.inventory_read import get_inventory_host as _get_inventory_host, get_inventory_app_store as _get_inventory_app_store
                app_store = _get_inventory_app_store()
                if app_store is not None and (login or name):
                    # Try login variants first, then surname
                    search_queries = []
                    if login:
                        search_queries.append(login)
                        if "." in login:
                            search_queries.append(login.replace(".", "_"))
                        if "_" in login:
                            search_queries.append(login.replace("_", "."))
                    # Add surname (first word of name) as fallback
                    if name:
                        surname = name.split()[0] if name.split() else None
                        if surname and len(surname) >= 3:
                            search_queries.append(surname)

                    session_keys = set()
                    for q in search_queries:
                        session_keys = app_store.search_host_keys(q, {"user"})
                        if session_keys:
                            break

                    # Also collect MACs already matched to equipment
                    equipment_macs = {
                        item.get("mac_address", "").lower().replace("-", "").replace(":", "")
                        for item in equipment_list if item.get("mac_address")
                    }

                    for found_mac in session_keys:
                        host = _get_inventory_host(found_mac)
                        if isinstance(host, dict):
                            last_seen_raw = host.get("last_seen_at") or host.get("timestamp")
                            last_seen_at = int(last_seen_raw) if last_seen_raw else 0
                            sess_status = _calculate_agent_status(last_seen_at)
                            sess_last_seen = None
                            if last_seen_at > 0:
                                from datetime import datetime, timezone
                                sess_last_seen = datetime.fromtimestamp(
                                    last_seen_at, tz=timezone.utc
                                ).isoformat()
                            active_sessions.append({
                                "hostname": _normalize_text(host.get("hostname")) or None,
                                "ip_address": _normalize_text(host.get("ip_primary") or host.get("ip_address")) or None,
                                "mac_address": _normalize_text(host.get("mac_address")) or None,
                                "agent_status": sess_status,
                                "agent_last_seen": sess_last_seen,
                                "current_user": _normalize_text(host.get("current_user") or host.get("user_login")) or None,
                            })
            except Exception as exc:
                logger.warning("full_context active_sessions lookup failed: %s", exc)

            # Step 3: Active Directory integration
            ad_section = None
            ad_error = None

            if login:
                try:
                    from backend.services.ad_users_service import (
                        get_ad_user_logon_history,
                        get_ad_user_lockout_status,
                        get_ad_password_max_age_days,
                    )

                    logon_data = get_ad_user_logon_history(login)
                    lockout_data = get_ad_user_lockout_status(login)

                    logon_status = str(logon_data.get("status") or "").strip().lower()
                    lockout_status = str(lockout_data.get("status") or "").strip().lower()

                    # Check for LDAP connection errors
                    if logon_status == "error" or lockout_status == "error":
                        ad_section = None
                        ad_error = "LDAP connection unavailable"
                    elif logon_status == "not_found" and lockout_status == "not_found":
                        ad_section = None
                        ad_error = "User not found in AD"
                    else:
                        # At least one query returned data — assemble AD section
                        ad_login = (
                            logon_data.get("login")
                            or lockout_data.get("login")
                            or login
                        )
                        ad_display_name = (
                            logon_data.get("display_name")
                            or lockout_data.get("display_name")
                        ) or None
                        ad_account_type = (
                            logon_data.get("account_type")
                            or lockout_data.get("account_type")
                            or "user"
                        )
                        ad_last_logon = logon_data.get("last_logon") if logon_status == "ok" else None
                        ad_logon_count = logon_data.get("logon_count", 0) if logon_status == "ok" else 0
                        ad_is_locked = lockout_data.get("is_locked", False) if lockout_status == "ok" else False

                        # Calculate password_expires_in_days from last_password_change
                        password_expires_in_days = None
                        if logon_status == "ok":
                            last_pwd_change_str = logon_data.get("last_password_change")
                            if last_pwd_change_str:
                                try:
                                    from datetime import datetime, timezone, timedelta
                                    pwd_last_set_dt = datetime.fromisoformat(last_pwd_change_str)
                                    if pwd_last_set_dt.tzinfo is None:
                                        pwd_last_set_dt = pwd_last_set_dt.replace(tzinfo=timezone.utc)
                                    max_age_days = get_ad_password_max_age_days()
                                    expiration_date = pwd_last_set_dt + timedelta(days=max_age_days)
                                    now = datetime.now(timezone.utc)
                                    remaining = (expiration_date - now).total_seconds()
                                    import math
                                    password_expires_in_days = max(0, int(math.ceil(remaining / 86400))) if remaining > 0 else 0
                                except (ValueError, TypeError, OSError):
                                    password_expires_in_days = None

                        # Handle case where logon found user but lockout didn't (or vice versa)
                        if logon_status == "not_found" and lockout_status == "ok":
                            # Only lockout data available
                            ad_last_logon = None
                            ad_logon_count = 0
                            password_expires_in_days = None
                        elif logon_status == "ok" and lockout_status == "not_found":
                            # Only logon data available
                            ad_is_locked = False

                        ad_section = {
                            "login": ad_login,
                            "display_name": ad_display_name,
                            "account_type": ad_account_type,
                            "last_logon": ad_last_logon,
                            "logon_count": ad_logon_count,
                            "password_expires_in_days": password_expires_in_days,
                            "is_locked": ad_is_locked,
                        }
                except Exception:
                    # LDAP connection failure or any other AD error — graceful degradation
                    ad_section = None
                    ad_error = "LDAP connection unavailable"

            result_data = {
                "employee": employee_section,
                "equipment": equipment_list,
                "active_sessions": active_sessions if active_sessions else None,
                "ad": ad_section,
            }
            if ad_error:
                result_data["ad_error"] = ad_error

            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data=result_data,
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, database_id=database_id, error=str(exc))


for _tool in [
    DatabaseCurrentTool(),
    EquipmentSearchTool(),
    EquipmentSearchUniversalTool(),
    EquipmentGetCardTool(),
    EquipmentListByBranchTool(),
    EquipmentExportTool(),
    EmployeeSearchTool(),
    EmployeeListEquipmentTool(),
    ConsumablesSearchTool(),
    DirectoryBranchesTool(),
    DirectoryEquipmentTypesTool(),
    DirectoryLocationsTool(),
    DirectoryStatusesTool(),
    EquipmentSearchMultiDbTool(),
    AnalyticsSummaryTool(),
    EntityResolveTool(),
    TransferDraftTool(),
    ConsumableConsumeDraftTool(),
    ConsumableQtyDraftTool(),
    EquipmentHistoryTool(),
    EquipmentActsTool(),
    EquipmentModelsSearchTool(),
    DirectoryVendorsTool(),
    DirectoryDepartmentsTool(),
    StatusChangeDraftTool(),
    LocationChangeDraftTool(),
    UserByNameTool(),
    UserFullContextTool(),
]:
    ai_tool_registry.register(_tool)
