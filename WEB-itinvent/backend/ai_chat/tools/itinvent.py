from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_ANALYTICS_SUMMARY,
    ITINVENT_TOOL_ACTION_CONSUMABLE_CONSUME_DRAFT,
    ITINVENT_TOOL_ACTION_CONSUMABLE_QTY_DRAFT,
    ITINVENT_TOOL_ACTION_TRANSFER_DRAFT,
    ITINVENT_TOOL_DATABASE_CURRENT,
    ITINVENT_TOOL_CONSUMABLES_SEARCH,
    ITINVENT_TOOL_DIRECTORY_BRANCHES,
    ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES,
    ITINVENT_TOOL_DIRECTORY_LOCATIONS,
    ITINVENT_TOOL_DIRECTORY_STATUSES,
    ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT,
    ITINVENT_TOOL_EMPLOYEE_SEARCH,
    ITINVENT_TOOL_ENTITY_RESOLVE,
    ITINVENT_TOOL_EQUIPMENT_GET_CARD,
    ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB,
    get_available_database_options,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.database import equipment_db, queries


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
    tool_id = ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT
    description = "List equipment assigned to an employee by OWNER_NO."
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
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "owner_no": args.owner_no,
                **_result_metadata(returned_count=len(items), total=total, limit=args.limit),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


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


for _tool in [
    DatabaseCurrentTool(),
    EquipmentSearchTool(),
    EquipmentSearchUniversalTool(),
    EquipmentGetCardTool(),
    EquipmentListByBranchTool(),
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
]:
    ai_tool_registry.register(_tool)
