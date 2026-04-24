from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_DATABASE_CURRENT,
    ITINVENT_TOOL_CONSUMABLES_SEARCH,
    ITINVENT_TOOL_DIRECTORY_BRANCHES,
    ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES,
    ITINVENT_TOOL_DIRECTORY_LOCATIONS,
    ITINVENT_TOOL_DIRECTORY_STATUSES,
    ITINVENT_TOOL_EMPLOYEE_LIST_EQUIPMENT,
    ITINVENT_TOOL_EMPLOYEE_SEARCH,
    ITINVENT_TOOL_EQUIPMENT_GET_CARD,
    ITINVENT_TOOL_EQUIPMENT_LIST_BY_BRANCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL,
    ITINVENT_TOOL_EQUIPMENT_SEARCH_MULTI_DB,
    get_available_database_options,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.database import equipment_db, queries


DEFAULT_RESULT_LIMIT = 5


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


def _cap_rows(items: list[dict[str, Any]] | None, limit: int = DEFAULT_RESULT_LIMIT) -> list[dict[str, Any]]:
    return list(items or [])[: max(1, min(int(limit or DEFAULT_RESULT_LIMIT), DEFAULT_RESULT_LIMIT))]


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


class _LimitMixin(BaseModel):
    limit: int = Field(default=DEFAULT_RESULT_LIMIT, ge=1, le=DEFAULT_RESULT_LIMIT)


class DatabaseCurrentArgs(BaseModel):
    pass


class EquipmentSearchArgs(_LimitMixin):
    query: str = Field(..., min_length=1, max_length=120)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize_query(cls, value):
        return _normalize_text(value)


class EquipmentGetCardArgs(BaseModel):
    inv_no: str = Field(..., min_length=1, max_length=120)

    @field_validator("inv_no", mode="before")
    @classmethod
    def _normalize_inv_no(cls, value):
        return _normalize_text(value)


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


class DatabaseCurrentTool(AiTool):
    tool_id = ITINVENT_TOOL_DATABASE_CURRENT
    description = "Return the current ITinvent database that will be used for live queries."
    input_model = DatabaseCurrentArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        database_id = _normalize_text(context.effective_database_id)
        database_meta = next(
            (item for item in get_available_database_options() if _normalize_text(item.get("id")) == database_id),
            None,
        )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=bool(database_id),
            database_id=database_id or None,
            data={
                "database_id": database_id or None,
                "database_name": _normalize_text((database_meta or {}).get("name")) or database_id or None,
            },
            sources=[_build_source(database_id)] if database_id else [],
            error=None if database_id else "Current ITinvent database is not resolved.",
        )


class EquipmentSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_SEARCH
    description = "Search ITinvent equipment by inventory number, serial number, or hardware serial."
    input_model = EquipmentSearchArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentSearchArgs) -> AiToolResult:
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.search_equipment_by_serial(args.query, database_id)
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
                "count": len(items),
                "items": items,
            },
            sources=[_build_source(database_id)],
        )


class EquipmentSearchUniversalTool(AiTool):
    tool_id = ITINVENT_TOOL_EQUIPMENT_SEARCH_UNIVERSAL
    description = (
        "Search ITinvent equipment across type, model, vendor, owner, department, branch, location and network fields."
    )
    input_model = EquipmentSearchUniversalArgs
    stage = "searching_equipment"

    def execute(self, *, context: AiToolExecutionContext, args: EquipmentSearchUniversalArgs) -> AiToolResult:
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.search_equipment_universal(args.query, page=1, limit=args.limit, db_id=database_id)
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
                "query": args.query,
                "count": len(items),
                "total": int((rows or {}).get("total") or len(items)),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = equipment_db.get_equipment_by_branch(args.branch_name, page=1, limit=args.limit, db_id=database_id)
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
                "count": len(items),
                "total": int((rows or {}).get("total") or len(items)),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.search_employees(args.query, page=1, limit=args.limit, db_id=database_id)
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
                "count": len(items),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.get_equipment_by_owner(args.owner_no, database_id)
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
                "count": len(items),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        fetch_limit = max(int(args.limit or DEFAULT_RESULT_LIMIT), 1) * 20
        raw_rows = list(
            queries.get_consumables_lookup(
                db_id=database_id,
                model_name=None,
                branch_no=args.branch_no,
                only_positive_qty=bool(args.only_positive_qty),
                limit=max(50, min(fetch_limit, 300)),
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
                "count": len(items),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.get_all_branches(database_id)
        items = [
            _normalize_branch_item(row, database_id=database_id)
            for row in _cap_rows(rows, args.limit)
            if isinstance(row, dict)
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={"count": len(items), "items": items},
            sources=[_build_source(database_id)],
        )


class DirectoryEquipmentTypesTool(AiTool):
    tool_id = ITINVENT_TOOL_DIRECTORY_EQUIPMENT_TYPES
    description = "List ITinvent equipment types."
    input_model = DirectoryEquipmentTypesArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DirectoryEquipmentTypesArgs) -> AiToolResult:
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = list(queries.get_all_equipment_types(database_id) or [])
        query_text = _normalize_text(args.query).lower()
        if query_text:
            rows = [
                row
                for row in rows
                if query_text in _normalize_text(_row_value(row, "type_name", "name", "description")).lower()
            ]
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
                "count": len(items),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = queries.get_all_locations(database_id, branch_no=args.branch_no)
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
                "count": len(items),
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
        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Current ITinvent database is not resolved.")
        rows = list(queries.get_all_statuses(database_id) or [])
        query_text = _normalize_text(args.query).lower()
        if query_text:
            rows = [
                row
                for row in rows
                if query_text in _normalize_text(_row_value(row, "status_name", "status", "description")).lower()
            ]
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
                "count": len(items),
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
        for database_id in database_ids:
            rows = queries.search_equipment_by_serial(args.query, database_id)
            normalized_rows = [
                _normalize_equipment_item(row, database_id=database_id)
                for row in _cap_rows(rows, args.limit)
                if isinstance(row, dict)
            ]
            if normalized_rows:
                items.extend(normalized_rows)
            sources.append(_build_source(database_id))
            if len(items) >= int(args.limit or DEFAULT_RESULT_LIMIT):
                break
        capped_items = items[: int(args.limit or DEFAULT_RESULT_LIMIT)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={
                "query": args.query,
                "count": len(capped_items),
                "items": capped_items,
            },
            sources=sources,
        )


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
]:
    ai_tool_registry.register(_tool)
