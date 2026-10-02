"""1C warehouse tools for ai_chat (group "warehouse", read-only).

The warehouse service is asynchronous; its 1C work runs in a thread pool or in the
killable COM child process, so a coroutine can be driven from the tool thread with
its own short-lived event loop.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    SELF_TOOL_IT_REQUESTS,
    WAREHOUSE_TOOL_BALANCES_SEARCH,
    WAREHOUSE_TOOL_IT_REQUEST_GET,
    WAREHOUSE_TOOL_IT_REQUESTS_SEARCH,
)
from backend.ai_chat.tools.registry import ai_tool_registry

logger = logging.getLogger(__name__)

MAX_ROWS = 30


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def run_coroutine(coro) -> Any:
    """Run a coroutine from synchronous tool code, also when this thread already runs a loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()


def _warehouse_service():
    from backend.services.warehouse_1c_service import warehouse_1c_service

    return warehouse_1c_service


def _warehouse_error(exc: Exception) -> str:
    name = type(exc).__name__
    if name == "Warehouse1CCatalogUnavailableError":
        return f"Справочник 1С недоступен: {exc}"
    if name == "Warehouse1CValidationError":
        return f"Некорректный запрос к складу 1С: {exc}"
    return f"Склад 1С не ответил: {exc}"


def _preview_text(value: Any) -> Optional[str]:
    if isinstance(value, list):
        names = []
        for entry in value[:5]:
            if isinstance(entry, dict):
                name = _normalize_text(entry.get("name") or entry.get("nomenclature_name"))
                qty = entry.get("quantity") or entry.get("qty_requested")
                unit = _normalize_text(entry.get("unit"))
                names.append(f"{name} × {qty}{(' ' + unit) if unit else ''}" if name and qty else name)
            else:
                names.append(_normalize_text(entry))
        text = "; ".join(name for name in names if name)
        return text or None
    return _normalize_text(value) or None


def _request_summary(item: dict[str, Any]) -> dict[str, Any]:
    stage = item.get("stage") if isinstance(item.get("stage"), dict) else {}
    return {
        "request_ref": _normalize_text(item.get("request_ref")) or None,
        "number": _normalize_text(item.get("request_number")) or None,
        "date": _normalize_text(item.get("date"))[:10] or None,
        "required_date": _normalize_text(item.get("required_date"))[:10] or None,
        "stage": _normalize_text(stage.get("label") or stage.get("key")) or None,
        "progress": _normalize_text(item.get("progress_label")) or None,
        "overdue": bool(item.get("overdue")),
        "attention_required": bool(item.get("attention_required")),
        "initiator": _normalize_text(item.get("initiator_name")) or None,
        "responsible": _normalize_text(item.get("responsible_name")) or None,
        "department": _normalize_text(item.get("department_name")) or None,
        "warehouse": _normalize_text(item.get("warehouse_name")) or None,
        "items_preview": _preview_text(item.get("nomenclature_preview")),
        "positions_total": item.get("positions_total"),
        "positions_completed": item.get("positions_completed"),
    }


class BalancesSearchArgs(BaseModel):
    query: str = Field(..., min_length=2, max_length=200, description="Nomenclature name or code, e.g. 'CF259A', 'картридж HP'")
    warehouse: Optional[str] = Field(default=None, max_length=200, description="Part of the warehouse name to narrow results")
    limit: int = Field(default=20, ge=1, le=MAX_ROWS)

    @field_validator("query", "warehouse", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


class ItRequestsSearchArgs(BaseModel):
    query: Optional[str] = Field(default=None, max_length=200, description="Request number, initiator, department or item")
    view: Literal["active", "history", "all"] = "active"
    overdue_only: bool = False
    limit: int = Field(default=15, ge=1, le=MAX_ROWS)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


class ItRequestGetArgs(BaseModel):
    request_ref: str = Field(..., min_length=8, max_length=64)

    @field_validator("request_ref", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class BalancesSearchTool(AiTool):
    tool_id = WAREHOUSE_TOOL_BALANCES_SEARCH
    description = (
        "1C warehouse stock: how many units of a nomenclature item are in which warehouse. Use for "
        "'сколько CF259A на складе', 'есть ли мониторы Dell на складе', 'остатки картриджей'."
    )
    input_model = BalancesSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BalancesSearchArgs) -> AiToolResult:
        try:
            payload = run_coroutine(_warehouse_service().get_balances(text=args.query, limit=200))
        except Exception as exc:
            logger.warning("ai warehouse.balances failed: %s", type(exc).__name__)
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_warehouse_error(exc))
        rows = payload.get("items") if isinstance(payload, dict) else payload
        items = []
        for row in list(rows or []):
            if not isinstance(row, dict):
                continue
            warehouse_name = _normalize_text(row.get("warehouse_name"))
            if args.warehouse and args.warehouse.lower() not in warehouse_name.lower():
                continue
            items.append(
                {
                    "nomenclature": _normalize_text(row.get("nomenclature_name")) or None,
                    "code": _normalize_text(row.get("nomenclature_code")) or None,
                    "warehouse": warehouse_name or None,
                    "qty": row.get("qty_balance"),
                }
            )
        items.sort(key=lambda item: (-(float(item.get("qty") or 0)), item.get("warehouse") or ""))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "query": args.query,
                "total": len(items),
                "total_qty": round(sum(float(item.get("qty") or 0) for item in items), 3),
                "count": min(len(items), args.limit),
                "truncated": len(items) > args.limit,
                "items": items[: args.limit],
            },
        )


class ItRequestsSearchTool(AiTool):
    tool_id = WAREHOUSE_TOOL_IT_REQUESTS_SEARCH
    description = (
        "1C IT purchase requests (заявки на ИТ-оборудование): stage, progress, required date, overdue, initiator, "
        "warehouse and items. Use for 'какие ИТ-заявки просрочены', 'статус заявки 123-ИТ', 'заявки отдела продаж'."
    )
    input_model = ItRequestsSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ItRequestsSearchArgs) -> AiToolResult:
        try:
            payload = run_coroutine(
                _warehouse_service().get_it_requests(
                    view=args.view,
                    search=args.query or "",
                    overdue=True if args.overdue_only else None,
                    limit=args.limit,
                )
            )
        except Exception as exc:
            logger.warning("ai warehouse.it_requests failed: %s", type(exc).__name__)
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_warehouse_error(exc))
        items = [_request_summary(item) for item in list((payload or {}).get("items") or []) if isinstance(item, dict)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "view": args.view,
                "total": (payload or {}).get("total", len(items)),
                "count": len(items),
                "has_more": bool((payload or {}).get("next_cursor")),
                "items": items,
            },
        )


class ItRequestGetTool(AiTool):
    tool_id = WAREHOUSE_TOOL_IT_REQUEST_GET
    description = "Open one 1C IT purchase request by request_ref (from warehouse.it_requests.search): positions with their stage."
    input_model = ItRequestGetArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ItRequestGetArgs) -> AiToolResult:
        try:
            detail = run_coroutine(_warehouse_service().get_it_request_detail(args.request_ref))
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_warehouse_error(exc))
        if not isinstance(detail, dict):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="ИТ-заявка не найдена.")
        positions = []
        for position in list(detail.get("positions") or [])[:30]:
            if not isinstance(position, dict):
                continue
            stage = position.get("stage") if isinstance(position.get("stage"), dict) else {}
            positions.append(
                {
                    "item": _normalize_text(position.get("nomenclature_name") or position.get("name")) or None,
                    "qty": position.get("qty_requested") or position.get("qty"),
                    "stage": _normalize_text(stage.get("label") or stage.get("key")) or None,
                    "overdue": bool(position.get("overdue")),
                }
            )
        summary = _request_summary(detail)
        summary["positions"] = positions
        return AiToolResult(tool_id=self.tool_id, ok=True, data=summary)


class _NoArgs(BaseModel):
    pass


class MyItRequestsTool(AiTool):
    tool_id = SELF_TOOL_IT_REQUESTS
    description = (
        "The asking employee's own 1C IT purchase requests (no arguments): requests where they are the initiator, "
        "with stage, progress and required date. Use for 'где моя заявка на ноутбук', 'когда придёт мой монитор'."
    )
    input_model = _NoArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        from backend.ai_chat.self_identity import resolve_self_identity

        identity = resolve_self_identity(context)
        if not identity.full_name:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="В учётной записи портала не указано ФИО.")
        try:
            payload = run_coroutine(
                _warehouse_service().get_it_requests(view="all", search=identity.full_name, limit=50)
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_warehouse_error(exc))
        own_name = " ".join(identity.full_name.split()).casefold()
        items = [
            _request_summary(item)
            for item in list((payload or {}).get("items") or [])
            if isinstance(item, dict) and " ".join(_normalize_text(item.get("initiator_name")).split()).casefold() == own_name
        ]
        for item in items:
            # Other people of the purchase chain are not needed for "where is my request".
            item.pop("responsible", None)
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"count": len(items), "items": items[:15]})


for tool in [BalancesSearchTool(), ItRequestsSearchTool(), ItRequestGetTool(), MyItRequestsTool()]:
    ai_tool_registry.register(tool)
