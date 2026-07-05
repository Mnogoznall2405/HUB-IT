from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    MFU_TOOL_DEVICES_LIST,
    MFU_TOOL_DEVICE_STATUS,
    MFU_TOOL_PAGES_MONTHLY,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.database.equipment_db import get_all_equipment_flat
from backend.services.authorization_service import PERM_MFU_READ, authorization_service


DEFAULT_LIMIT = 100
MAX_LIMIT = 500

_MFU_KEYWORDS = (
    "принтер", "printer", "мфу", "плоттер", "plotter", "hp", "canon", "xerox",
    "kyocera", "ricoh", "konica", "sharp", "epson", "brother",
)


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value if value is not None else "").strip()
    return text or default


def _to_int(value: object) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _is_mfu_row(row: dict[str, Any]) -> bool:
    combined = " ".join([
        _normalize_text(row.get("type_name")),
        _normalize_text(row.get("model_name")),
        _normalize_text(row.get("vendor_name")),
    ]).lower()
    return any(kw in combined for kw in _MFU_KEYWORDS)


def _build_device_preview(row: dict[str, Any], db_id: str | None) -> dict[str, Any]:
    return {
        "inv_no": _normalize_text(row.get("inv_no") or row.get("INV_NO")),
        "serial_no": _normalize_text(row.get("serial_no") or row.get("SERIAL_NO")),
        "type_name": _normalize_text(row.get("type_name") or row.get("TYPE_NAME")),
        "model_name": _normalize_text(row.get("model_name") or row.get("MODEL_NAME")),
        "vendor_name": _normalize_text(row.get("vendor_name") or row.get("VENDOR_NAME") or row.get("manufacturer")),
        "branch_name": _normalize_text(row.get("branch_name") or row.get("BRANCH_NAME")),
        "location_name": _normalize_text(row.get("location") or row.get("location_name") or row.get("LOCATION")),
        "ip_address": _normalize_text(row.get("ip_address") or row.get("IP_ADDRESS")),
        "mac_address": _normalize_text(row.get("mac_address") or row.get("MAC_ADDRESS")),
        "status": _normalize_text(row.get("status") or row.get("STATUS")),
        "db_id": db_id,
    }


class MfuDevicesListArgs(BaseModel):
    query: Optional[str] = Field(default=None, max_length=120)
    branch: Optional[str] = Field(default=None, max_length=180)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("query", "branch", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class MfuDeviceStatusArgs(BaseModel):
    inv_no: Optional[str] = Field(default=None, max_length=120)
    ip_address: Optional[str] = Field(default=None, max_length=80)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "ip_address", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class MfuPagesMonthlyArgs(BaseModel):
    inv_no: Optional[str] = Field(default=None, max_length=120)
    ip_address: Optional[str] = Field(default=None, max_length=80)
    months: int = Field(default=6, ge=1, le=36)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "ip_address", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


def _resolve_db(context: AiToolExecutionContext, database_id: str | None) -> str | None:
    from backend.ai_chat.tools.context import normalize_database_id
    requested = normalize_database_id(database_id)
    current = normalize_database_id(context.effective_database_id)
    return requested or current


def _has_permission(context: AiToolExecutionContext, permission: str) -> bool:
    payload = context.user_payload if isinstance(context.user_payload, dict) else {}
    return authorization_service.has_permission(
        payload.get("role"),
        permission,
        use_custom_permissions=bool(payload.get("use_custom_permissions", False)),
        custom_permissions=payload.get("custom_permissions") or [],
    )


def _require_permission(context: AiToolExecutionContext, permission: str) -> None:
    if not _has_permission(context, permission):
        raise PermissionError(f"Permission required: {permission}")


class MfuDevicesListTool(AiTool):
    tool_id = MFU_TOOL_DEVICES_LIST
    description = (
        "List MFU/printer devices from the ITinvent equipment database. "
        "Filters by type/model/vendor keywords. Optionally filter by branch name or search query."
    )
    input_model = MfuDevicesListArgs
    stage = "checking_mfu"

    def execute(self, *, context: AiToolExecutionContext, args: MfuDevicesListArgs) -> AiToolResult:
        try:
            _require_permission(context, PERM_MFU_READ)
        except PermissionError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        database_id = _resolve_db(context, args.database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="ITinvent database is not configured.")
        try:
            rows = get_all_equipment_flat(db_id=database_id, limit=5000) or []
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))

        query_text = _normalize_text(args.query).lower()
        branch_text = _normalize_text(args.branch).lower()

        filtered: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if not _is_mfu_row(row):
                continue
            if branch_text and branch_text not in _normalize_text(
                row.get("branch_name") or row.get("BRANCH_NAME")
            ).lower():
                continue
            if query_text:
                haystack = " ".join([
                    _normalize_text(row.get("inv_no") or row.get("INV_NO")),
                    _normalize_text(row.get("model_name") or row.get("MODEL_NAME")),
                    _normalize_text(row.get("vendor_name") or row.get("VENDOR_NAME") or row.get("manufacturer")),
                    _normalize_text(row.get("branch_name") or row.get("BRANCH_NAME")),
                    _normalize_text(row.get("location") or row.get("location_name") or row.get("LOCATION")),
                    _normalize_text(row.get("ip_address") or row.get("IP_ADDRESS")),
                ]).lower()
                if query_text not in haystack:
                    continue
            filtered.append(row)

        total = len(filtered)
        items = [_build_device_preview(row, database_id) for row in filtered[: max(1, min(args.limit, MAX_LIMIT))]]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "query": args.query,
                "branch": args.branch,
                "count": len(items),
                "total": total,
                "truncated": total > len(items),
                "items": items,
            },
        )


class MfuDeviceStatusTool(AiTool):
    tool_id = MFU_TOOL_DEVICE_STATUS
    description = (
        "Get runtime SNMP/ping status for a specific MFU/printer device. "
        "Provide inv_no or ip_address to identify the device. "
        "Returns ping status, supplies (toner/drum levels), page counter."
    )
    input_model = MfuDeviceStatusArgs
    stage = "checking_mfu"

    def execute(self, *, context: AiToolExecutionContext, args: MfuDeviceStatusArgs) -> AiToolResult:
        try:
            _require_permission(context, PERM_MFU_READ)
        except PermissionError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        import asyncio

        inv_no = _normalize_text(args.inv_no)
        ip_address = _normalize_text(args.ip_address)
        if not inv_no and not ip_address:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Provide inv_no or ip_address.")

        database_id = _resolve_db(context, args.database_id)

        device_key: str | None = None
        device_info: dict[str, Any] = {}

        if inv_no and database_id:
            try:
                from backend.database import queries
                row = queries.get_equipment_by_inv(inv_no, database_id)
                if isinstance(row, dict):
                    device_info = _build_device_preview(row, database_id)
                    resolved_ip = _normalize_text(row.get("ip_address") or row.get("IP_ADDRESS"))
                    resolved_mac = _normalize_text(row.get("mac_address") or row.get("MAC_ADDRESS"))
                    if resolved_ip or resolved_mac:
                        from backend.api.v1.mfu import _normalize_device_row
                        nd = _normalize_device_row(row, database_id)
                        device_key = nd.get("key")
            except Exception:
                pass

        if not device_key and ip_address:
            device_key = ip_address

        runtime: dict[str, Any] = {}
        if device_key:
            try:
                from backend.services.mfu_monitor_service import mfu_runtime_monitor
                loop = asyncio.new_event_loop()
                try:
                    runtime = loop.run_until_complete(mfu_runtime_monitor.get_snapshot(device_key))
                finally:
                    loop.close()
            except Exception:
                runtime = {}

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "inv_no": inv_no or None,
                "ip_address": ip_address or None,
                "device_key": device_key,
                "device_info": device_info or None,
                "runtime": runtime,
            },
        )


class MfuPagesMonthlyTool(AiTool):
    tool_id = MFU_TOOL_PAGES_MONTHLY
    description = (
        "Get monthly page count history for a specific MFU/printer device. "
        "Requires inv_no or ip_address. Returns monthly totals for the last N months."
    )
    input_model = MfuPagesMonthlyArgs
    stage = "checking_mfu"

    def execute(self, *, context: AiToolExecutionContext, args: MfuPagesMonthlyArgs) -> AiToolResult:
        try:
            _require_permission(context, PERM_MFU_READ)
        except PermissionError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        import asyncio

        inv_no = _normalize_text(args.inv_no)
        ip_address = _normalize_text(args.ip_address)
        if not inv_no and not ip_address:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Provide inv_no or ip_address.")

        database_id = _resolve_db(context, args.database_id)
        device_key: str | None = None

        if inv_no and database_id:
            try:
                from backend.database import queries
                row = queries.get_equipment_by_inv(inv_no, database_id)
                if isinstance(row, dict):
                    from backend.api.v1.mfu import _normalize_device_row
                    nd = _normalize_device_row(row, database_id)
                    device_key = nd.get("key")
            except Exception:
                pass

        if not device_key and ip_address:
            device_key = ip_address

        if not device_key:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Could not resolve device key.")

        try:
            from backend.services.mfu_monitor_service import mfu_runtime_monitor
            summary = mfu_runtime_monitor.get_monthly_page_summary(device_key=device_key, months=args.months)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))

        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "inv_no": inv_no or None,
                "ip_address": ip_address or None,
                "device_key": device_key,
                "months": args.months,
                "summary": summary,
            },
        )


for _tool in [
    MfuDevicesListTool(),
    MfuDeviceStatusTool(),
    MfuPagesMonthlyTool(),
]:
    ai_tool_registry.register(_tool)
