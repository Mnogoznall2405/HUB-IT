"""Inventory-agent computer tools for ai_chat (IT staff, permission computers.read).

The data comes from the HUB inventory agent (hostname, logged-in user, uptime,
pending reboot, disks, Outlook PST stores, user profile sizes). Search reuses the
same server-side search as the portal page, so database scoping and visibility
rules are identical to what the employee sees in "Computers".
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_COMPUTERS_GET,
    ITINVENT_TOOL_COMPUTERS_SEARCH,
)
from backend.ai_chat.tools.registry import ai_tool_registry

logger = logging.getLogger(__name__)

MAX_SEARCH_LIMIT = 20
_MAX_LIST_ROWS = 10
_GB = 1024 ** 3

_SEARCH_FIELDS = {
    "any": "identity,user,profiles,outlook,location",
    "identity": "identity",
    "user": "user",
    "profiles": "profiles",
    "outlook": "outlook",
    "location": "location",
}


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _gb(value: Any) -> Optional[float]:
    size = _to_int(value, -1)
    return round(size / _GB, 2) if size >= 0 else None


def _iso(ts: Any) -> Optional[str]:
    value = _to_int(ts, 0)
    if value <= 0:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def portal_user_model(user_payload: dict[str, Any]):
    """Build the API ``User`` model from a stored user payload (secrets are not copied)."""
    from backend.models.auth import User

    fields = set(User.model_fields)
    data = {key: value for key, value in dict(user_payload or {}).items() if key in fields}
    try:
        return User(**data)
    except Exception:
        # A malformed optional field (e.g. mailbox_email) must not hide the computers.
        for key in ("email", "mailbox_email"):
            data.pop(key, None)
        return User(**data)


def _outlook_stores(outlook: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for kind, items in (
        ("active", list(outlook.get("active_stores") or [])),
        ("archive", list(outlook.get("archives") or [])),
    ):
        for item in items:
            if not isinstance(item, dict):
                continue
            path = _normalize_text(item.get("path"))
            if not path or path.lower() in seen:
                continue
            seen.add(path.lower())
            rows.append(
                {
                    "kind": kind,
                    "path": path,
                    "size_gb": _gb(item.get("size_bytes")),
                    "last_modified": _iso(item.get("last_modified_at")),
                }
            )
    rows.sort(key=lambda row: -(row.get("size_gb") or 0))
    return rows[:_MAX_LIST_ROWS]


def _profiles(profile_sizes: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for item in list(profile_sizes.get("profiles") or []):
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                "user_name": _normalize_text(item.get("user_name")) or None,
                "profile_path": _normalize_text(item.get("profile_path")) or None,
                "size_gb": _gb(item.get("total_size_bytes")),
            }
        )
    rows.sort(key=lambda row: -(row.get("size_gb") or 0))
    return rows[:_MAX_LIST_ROWS]


def build_computer_view(raw: dict[str, Any], *, detail: bool = False) -> dict[str, Any]:
    """Compact, model-friendly view of one inventory host record."""
    from backend.api.v1.inventory import (
        _enrich_status,
        _ensure_identity_fields,
        _ensure_runtime_fields,
    )

    record = _enrich_status(dict(raw or {}), int(time.time()))
    _ensure_identity_fields(record)
    _ensure_runtime_fields(record)
    ops = record.get("ops_health") if isinstance(record.get("ops_health"), dict) else {}
    outlook = record.get("outlook") if isinstance(record.get("outlook"), dict) else {}
    profile_sizes = record.get("user_profile_sizes") if isinstance(record.get("user_profile_sizes"), dict) else {}
    storage = [row for row in list(record.get("storage") or []) if isinstance(row, dict)]
    storage_problems = [
        _normalize_text(row.get("name") or row.get("model") or row.get("device"))
        for row in storage
        if any(
            token in _normalize_text(row.get("health_status")).lower()
            for token in ("warning", "critical", "fail", "degrad", "unhealthy")
        )
    ]
    uptime_seconds = _to_int(record.get("uptime_seconds"), -1)
    view: dict[str, Any] = {
        "hostname": _normalize_text(record.get("hostname")) or None,
        "mac_address": _normalize_text(record.get("mac_address")) or None,
        "ip": _normalize_text(record.get("ip_primary")) or None,
        "status": _normalize_text(record.get("status")) or "unknown",
        "last_seen": _iso(record.get("last_seen_at")),
        "user_login": _normalize_text(record.get("user_login")) or None,
        "current_user": _normalize_text(record.get("current_user")) or None,
        "user_full_name": _normalize_text(record.get("user_full_name")) or None,
        "branch": _normalize_text(record.get("branch_name")) or None,
        "location": _normalize_text(record.get("location_name")) or None,
        "inv_no": _normalize_text(record.get("inventory_inv_no")) or None,
        "model": _normalize_text(record.get("inventory_model_name")) or None,
        "health": {
            "uptime_days": round(uptime_seconds / 86400, 1) if uptime_seconds >= 0 else None,
            "last_reboot": _iso(record.get("last_reboot_at")),
            "pending_reboot": bool(ops.get("pending_reboot")),
            "pending_reboot_reasons": [str(item) for item in list(ops.get("pending_reboot_reasons") or [])[:5]],
            "ram_used_percent": record.get("ram_used_percent"),
            "cpu_load_percent": record.get("cpu_load_percent"),
            "system_drive_free_gb": ops.get("system_drive_free_gb"),
            "low_disk": bool(ops.get("low_disk")),
            "storage_problems": storage_problems,
        },
        "outlook": {
            "status": _normalize_text(outlook.get("status")) or None,
            "total_size_gb": _gb(outlook.get("total_outlook_size_bytes")),
            "warning_size_gb": _gb(outlook.get("threshold_warning_bytes")),
        },
        "profiles": {
            "count": _to_int(profile_sizes.get("profiles_count"), 0),
            "total_size_gb": _gb(profile_sizes.get("total_size_bytes")),
        },
    }
    if detail:
        view["outlook"]["stores"] = _outlook_stores(outlook)
        view["profiles"]["items"] = _profiles(profile_sizes)
        view["logical_disks"] = [
            {
                "mountpoint": row.get("mountpoint") or row.get("device"),
                "total_gb": row.get("total_gb") or row.get("size_gb"),
                "free_gb": row.get("free_gb"),
                "used_percent": row.get("used_percent") or row.get("percent"),
            }
            for row in list(record.get("logical_disks") or [])[:_MAX_LIST_ROWS]
            if isinstance(row, dict)
        ]
    return view


def search_computers(
    *,
    context: AiToolExecutionContext,
    query: str,
    fields: str,
    status: Optional[str] = None,
    limit: int = 10,
) -> dict[str, Any]:
    from backend.api.v1.inventory import _build_computers_search_payload

    return _build_computers_search_payload(
        current_user=portal_user_model(context.user_payload),
        db_id_selected=_normalize_text(context.effective_database_id) or None,
        scope="selected",
        branch=None,
        status_filter=_normalize_text(status) or None,
        outlook_status=None,
        q=query,
        search_fields=fields,
        limit=max(1, min(int(limit or 10), MAX_SEARCH_LIMIT)),
        offset=0,
    )


def load_host(mac_address: str) -> Optional[dict[str, Any]]:
    from backend.api.v1.inventory import _get_inventory_host

    host = _get_inventory_host(mac_address)
    return host if isinstance(host, dict) else None


class ComputersSearchArgs(BaseModel):
    query: str = Field(..., min_length=2, max_length=160, description="Hostname, IP, MAC, login, surname, PST file name or profile name")
    field: Literal["any", "identity", "user", "profiles", "outlook", "location"] = Field(
        default="any",
        description="identity=hostname/IP/MAC, user=logged-in user, profiles=user profile folders, outlook=PST/OST files",
    )
    status: Optional[Literal["online", "stale", "offline"]] = None
    limit: int = Field(default=10, ge=1, le=MAX_SEARCH_LIMIT)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class ComputersGetArgs(BaseModel):
    mac_address: Optional[str] = Field(default=None, max_length=64)
    hostname: Optional[str] = Field(default=None, max_length=160)

    @field_validator("mac_address", "hostname", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


class ComputersSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_COMPUTERS_SEARCH
    description = (
        "Search computers reported by the HUB inventory agent by hostname, IP, MAC, logged-in user "
        "(login or surname), Outlook PST/OST file or user profile. Use for 'за каким ПК сидит Иванов', "
        "'где PST kozlovskii.me', 'где профиль Петрова', 'компьютер WS-042'. Returns compact cards with "
        "online status, user, uptime, pending reboot and Outlook size; open one with itinvent.computers.get."
    )
    input_model = ComputersSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ComputersSearchArgs) -> AiToolResult:
        try:
            payload = search_computers(
                context=context,
                query=args.query,
                fields=_SEARCH_FIELDS.get(args.field, _SEARCH_FIELDS["any"]),
                status=args.status,
                limit=args.limit,
            )
        except Exception as exc:
            logger.warning("ai computers.search failed: %s", type(exc).__name__)
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Поиск компьютеров недоступен: {exc}")
        items = []
        for item in list(payload.get("items") or []):
            if not isinstance(item, dict):
                continue
            mac = _normalize_text(item.get("mac_address"))
            raw = load_host(mac) if mac else None
            items.append(build_computer_view(raw or item, detail=args.field in {"outlook", "profiles"}))
        total = _to_int(payload.get("total"), len(items))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "query": args.query,
                "field": args.field,
                "total": total,
                "count": len(items),
                "truncated": total > len(items),
                "items": items,
            },
        )


class ComputersGetTool(AiTool):
    tool_id = ITINVENT_TOOL_COMPUTERS_GET
    description = (
        "Open one computer from the HUB inventory agent by mac_address (preferred) or exact hostname: "
        "online status, logged-in user, uptime, pending reboot reasons, RAM/CPU, disks, all Outlook "
        "PST/OST stores with sizes and user profiles with sizes."
    )
    input_model = ComputersGetArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ComputersGetArgs) -> AiToolResult:
        if not args.mac_address and not args.hostname:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Укажите mac_address или hostname компьютера.")
        mac = args.mac_address
        if not mac:
            # Resolve the hostname through the scoped search so visibility rules stay the same.
            try:
                payload = search_computers(context=context, query=args.hostname or "", fields="identity", limit=10)
            except Exception as exc:
                return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Поиск компьютеров недоступен: {exc}")
            exact = [
                item
                for item in list(payload.get("items") or [])
                if isinstance(item, dict)
                and _normalize_text(item.get("hostname")).lower() == _normalize_text(args.hostname).lower()
            ]
            if len(exact) != 1:
                return AiToolResult(
                    tool_id=self.tool_id,
                    ok=False,
                    error="Компьютер с таким именем не найден или найдено несколько — уточните через itinvent.computers.search.",
                )
            mac = _normalize_text(exact[0].get("mac_address"))
        else:
            # Explicit MAC: still require that the host is visible to this employee.
            try:
                payload = search_computers(context=context, query=mac, fields="identity", limit=5)
            except Exception as exc:
                return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Поиск компьютеров недоступен: {exc}")
            from backend.api.v1.inventory import _normalize_mac

            visible = {
                _normalize_mac(item.get("mac_address"))
                for item in list(payload.get("items") or [])
                if isinstance(item, dict)
            }
            if not _normalize_mac(mac) or _normalize_mac(mac) not in visible:
                return AiToolResult(tool_id=self.tool_id, ok=False, error="Компьютер не найден.")
        raw = load_host(mac)
        if raw is None:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Компьютер не найден.")
        return AiToolResult(tool_id=self.tool_id, ok=True, data=build_computer_view(raw, detail=True))


for tool in [ComputersSearchTool(), ComputersGetTool()]:
    ai_tool_registry.register(tool)
