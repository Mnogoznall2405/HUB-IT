"""Read-only IT purchase requests from 1C and derive their progress.

The module deliberately keeps the 1C access bounded and set-based: one query
for request headers, one for lines, and a fixed number of queries for linked
documents.  It never performs a query per request or per line.
"""
from __future__ import annotations

import base64
import binascii
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timezone
import logging
import os
import threading
import time
from typing import Any, Iterable
import uuid


REQUEST_DOCUMENT = "бит_стр_ЗаявкаНаМПЗ"
ASSIGNMENT_DOCUMENT = "бит_стр_ЗаданиеНаЗакупкуМенеджеру"
ORDER_DOCUMENT = "бит_стр_ЗаказПоставщику"
PLAN_DOCUMENT = "бит_стр_ПланПеремещения"
RECEIPT_DOCUMENT = "бит_стр_ПриходныйОрдер"
EXPENSE_DOCUMENT = "бит_стр_РасходныйОрдер"
TRANSFER_DOCUMENT = "бит_стр_ПеремещениеМеждуСкладами"
RESERVE_REGISTER = "бит_стр_РезервыПоЗаявкамНаМПЗ"

IT_REQUEST_SUFFIX = "ИТ"
IT_REQUEST_SCAN_MAX = 1_000
IT_REQUEST_EVENT_MAX = 20_000
QTY_EPSILON = 1e-6
UNKNOWN_WAREHOUSE_REF = "__unknown__"
DEFAULT_SNAPSHOT_TTL_SECONDS = 300
DEFAULT_FORCE_REFRESH_COOLDOWN_SECONDS = 30

logger = logging.getLogger(__name__)

STAGE_META: dict[str, dict[str, Any]] = {
    "draft": {"label": "Черновик", "rank": 0},
    "created": {"label": "Заявка создана", "rank": 1},
    "assigned": {"label": "Назначен закупщик", "rank": 2},
    "ordered": {"label": "Заказано поставщику", "rank": 3},
    "reserved": {"label": "Зарезервировано на складе", "rank": 3},
    "movement_planned": {"label": "Перемещение запланировано", "rank": 4},
    "received": {"label": "Поступило на склад", "rank": 5},
    "ready": {"label": "Готово к выдаче", "rank": 6},
    "fulfilled": {"label": "Доставлено на склад", "rank": 7},
    "cancelled": {"label": "Отменено", "rank": 8},
    "needs_review": {"label": "Требует проверки", "rank": 9},
}

REQUEST_JOURNEY_STEPS: tuple[dict[str, Any], ...] = (
    {"key": "created", "label": "Заявка", "event_types": ()},
    {"key": "assigned", "label": "Закупщик", "event_types": ("assigned",)},
    {"key": "ordered", "label": "Заказ / резерв", "event_types": ("ordered", "reserved")},
    {"key": "movement_planned", "label": "План", "event_types": ("movement_planned",)},
    {"key": "fulfilled", "label": "На складе", "event_types": ("received", "issued", "transferred")},
)

JOURNEY_STAGE_INDEX = {
    "draft": 0,
    "created": 0,
    "assigned": 1,
    "ordered": 2,
    "reserved": 2,
    "movement_planned": 3,
    "received": 4,
    "ready": 4,
    "fulfilled": 4,
}

EVENT_LABELS = {
    "assigned": "Назначение закупщика",
    "ordered": "Заказ поставщику",
    "movement_planned": "План перемещения",
    "reserved": "Резерв на складе",
    "received": "Поступление на склад",
    "issued": "Выдача со склада",
    "transferred": "Перемещение между складами",
}


def is_it_request_number(value: Any) -> bool:
    """Match only the exact Cyrillic suffix; Latin ``IT`` is not accepted."""
    return str(value or "").endswith(IT_REQUEST_SUFFIX)


def _field(row: Any, name: str, default: Any = None) -> Any:
    try:
        return getattr(row, name)
    except Exception:
        return default


def _text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        return str(connection.String(value) or "").strip()
    except Exception:
        return str(value or "").strip()


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _iso_datetime(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        if value.year <= 1900:
            return None
        return value.isoformat()
    if isinstance(value, date):
        if value.year <= 1900:
            return None
        return datetime.combine(value, datetime.min.time()).isoformat()
    text = str(value or "").strip()
    if not text or text.startswith("0001-") or text.startswith("01.01.0001"):
        return None
    return text


def _ref_uuid(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        method = getattr(value, "УникальныйИдентификатор")
        text = _text(connection, method()).lower()
        if len(text) == 36 and text.count("-") == 4 and text != "00000000-0000-0000-0000-000000000000":
            return text
        return ""
    except Exception:
        text = str(value or "").strip()
        if len(text) == 36 and text.count("-") == 4:
            return text
        return ""


def _date_only(value: str | None) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _stage(key: str) -> dict[str, Any]:
    meta = STAGE_META[key]
    return {"key": key, "label": str(meta["label"]), "rank": int(meta["rank"])}


def _sum_quantity(events: Iterable[dict[str, Any]], event_type: str) -> float:
    return sum(max(0.0, _number(event.get("quantity"))) for event in events if event.get("type") == event_type)


def _aggregate_timeline(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for source in events:
        key = (
            str(source.get("type") or ""),
            str(source.get("document_ref") or ""),
            str(source.get("document_number") or ""),
            str(source.get("date") or ""),
        )
        current = grouped.get(key)
        if current is None:
            current = {**source, "nomenclature_names": []}
            grouped[key] = current
        else:
            current["quantity"] = _number(current.get("quantity")) + _number(source.get("quantity"))
            current["amount"] = _number(current.get("amount")) + _number(source.get("amount"))
        name = str(source.get("nomenclature_name") or "").strip()
        if name and name not in current["nomenclature_names"]:
            current["nomenclature_names"].append(name)
    return sorted(
        grouped.values(),
        key=lambda item: (str(item.get("date") or ""), str(item.get("document_number") or "")),
    )


def _delivery_event(request: dict[str, Any], events: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for event in events:
        event_type = str(event.get("type") or "")
        if event_type in {"received", "issued"}:
            candidates.append(event)
        elif event_type == "transferred":
            request_is_specific = _specific_warehouse(
                request.get("warehouse_ref"),
                request.get("warehouse_name"),
            )
            if _same_destination(request, event) or (
                not request_is_specific
                and (event.get("destination_ref") or event.get("destination_name"))
            ):
                candidates.append(event)
    return max(
        candidates,
        key=lambda item: (str(item.get("date") or ""), str(item.get("document_number") or "")),
        default=None,
    )


def _specific_warehouse(reference: Any, name: Any) -> bool:
    normalized_name = str(name or "").strip().casefold()
    if normalized_name == "все склады":
        return False
    return bool(str(reference or "").strip() or normalized_name)


def _destination_warehouse(
    request: dict[str, Any],
    timeline: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    request_ref = str(request.get("warehouse_ref") or "").strip().lower()
    request_name = str(request.get("warehouse_name") or "").strip()
    document_destinations: dict[str, dict[str, str]] = {}
    for event in timeline:
        if str(event.get("type") or "") not in {"movement_planned", "received", "transferred"}:
            continue
        reference = str(event.get("destination_ref") or "").strip().lower()
        name = str(event.get("destination_name") or "").strip()
        if not reference and not name:
            continue
        key = reference or f"name:{name.casefold()}"
        document_destinations.setdefault(key, {"ref": reference, "name": name})

    request_is_specific = _specific_warehouse(request_ref, request_name)
    mismatch = False
    if request_is_specific:
        for destination in document_destinations.values():
            destination_ref = destination["ref"]
            destination_name = destination["name"]
            if request_ref and destination_ref:
                mismatch = mismatch or request_ref != destination_ref
            elif request_name and destination_name:
                mismatch = mismatch or request_name.casefold() != destination_name.casefold()
        return {
            "ref": request_ref,
            "name": request_name,
            "source": "request",
            "mismatch": mismatch,
        }

    if len(document_destinations) == 1:
        destination = next(iter(document_destinations.values()))
        return {
            "ref": destination["ref"],
            "name": destination["name"] or "Склад назначения",
            "source": "documents",
            "mismatch": False,
        }

    return {
        "ref": UNKNOWN_WAREHOUSE_REF,
        "name": "Склад не указан",
        "source": "unknown",
        "mismatch": len(document_destinations) > 1,
    }


def _event_documents_for_step(
    request: dict[str, Any],
    timeline: list[dict[str, Any]],
    index: int,
    event_types: tuple[str, ...],
) -> list[dict[str, Any]]:
    documents = [item for item in timeline if str(item.get("type") or "") in event_types]
    if index == len(REQUEST_JOURNEY_STEPS) - 1:
        documents = [
            item
            for item in documents
            if item.get("type") in {"received", "issued"}
            or (
                item.get("type") == "transferred"
                and (
                    _same_destination(request, item)
                    or (
                        not _specific_warehouse(request.get("warehouse_ref"), request.get("warehouse_name"))
                        and (item.get("destination_ref") or item.get("destination_name"))
                    )
                )
            )
        ]
    return documents


def _request_journey(
    request: dict[str, Any],
    timeline: list[dict[str, Any]],
    stage: dict[str, Any],
) -> list[dict[str, Any]]:
    current_index = JOURNEY_STAGE_INDEX.get(str(stage.get("key") or ""))
    if current_index is None:
        reached_indices = [0]
        for index, step in enumerate(REQUEST_JOURNEY_STEPS[1:], start=1):
            if any(event.get("type") in step["event_types"] for event in timeline):
                reached_indices.append(index)
        current_index = max(reached_indices)

    journey: list[dict[str, Any]] = []
    for index, step in enumerate(REQUEST_JOURNEY_STEPS):
        documents = (
            []
            if index == 0
            else _event_documents_for_step(request, timeline, index, step["event_types"])
        )
        event = documents[0] if documents else None
        date_value = request.get("date") if index == 0 else (event or {}).get("date")
        document_number = request.get("request_number") if index == 0 else (event or {}).get("document_number")
        if index == len(REQUEST_JOURNEY_STEPS) - 1 and not date_value:
            date_value = request.get("factual_delivery_date")
        reached = index == 0 or event is not None or (
            index == len(REQUEST_JOURNEY_STEPS) - 1
            and bool(request.get("factual_delivery_date"))
        )
        journey.append({
            "key": step["key"],
            "label": step["label"],
            "reached": reached,
            "current": index == current_index,
            "date": date_value,
            "document_number": document_number,
            "missing": bool(index < current_index and not reached),
            "documents": documents,
        })
    return journey


def _group_positions(positions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, bool], dict[str, Any]] = {}
    for position in positions:
        nomenclature_ref = str(position.get("nomenclature_ref") or "").strip().lower()
        nomenclature_name = str(position.get("nomenclature_name") or "").strip()
        characteristic_name = str(position.get("characteristic_name") or "").strip()
        unit_name = str(position.get("unit_name") or "").strip()
        cancelled = bool(position.get("cancelled"))
        key = (
            nomenclature_ref or f"name:{nomenclature_name.casefold()}",
            characteristic_name.casefold(),
            unit_name.casefold(),
            cancelled,
        )
        current = grouped.get(key)
        if current is None:
            current = {
                "nomenclature_ref": nomenclature_ref,
                "name": nomenclature_name,
                "characteristic_name": characteristic_name,
                "unit": unit_name,
                "quantity": 0.0,
                "cancelled": cancelled,
                "cancelled_quantity": 0.0,
                "cancellation_reasons": [],
                "source_line_count": 0,
                "source_line_keys": [],
            }
            grouped[key] = current
        quantity = max(0.0, _number(position.get("quantity")))
        current["quantity"] += quantity
        current["source_line_count"] += 1
        line_key = str(position.get("line_key") or "").strip()
        if line_key:
            current["source_line_keys"].append(line_key)
        if cancelled:
            current["cancelled_quantity"] += quantity
            reason = str(position.get("cancellation_reason") or "").strip()
            if reason and reason not in current["cancellation_reasons"]:
                current["cancellation_reasons"].append(reason)
    return list(grouped.values())


def _latest_event(timeline: Iterable[dict[str, Any]], event_types: set[str]) -> dict[str, Any] | None:
    return max(
        (item for item in timeline if str(item.get("type") or "") in event_types),
        key=lambda item: (str(item.get("date") or ""), str(item.get("document_number") or "")),
        default=None,
    )


def _current_state(
    request: dict[str, Any],
    timeline: list[dict[str, Any]],
    stage: dict[str, Any],
    destination: dict[str, Any],
    managers: list[str],
    suppliers: list[str],
) -> dict[str, Any]:
    key = str(stage.get("key") or "created")
    event_types = {
        "assigned": {"assigned"},
        "ordered": {"ordered"},
        "reserved": {"reserved"},
        "movement_planned": {"movement_planned"},
        "fulfilled": {"received", "issued", "transferred"},
    }.get(key, set())
    event = _delivery_event(request, timeline) if key == "fulfilled" else _latest_event(timeline, event_types)
    warehouse_name = str(destination.get("name") or "склад назначения")
    if key == "draft":
        description = "Заявка сохранена как черновик"
    elif key == "created":
        description = "Ожидает назначения закупщика"
    elif key == "assigned":
        description = f"Закупщик: {', '.join(managers)}" if managers else "Закупщик назначен"
    elif key in {"ordered", "reserved"}:
        description = (
            f"Заказ оформлен у поставщика {', '.join(suppliers)}"
            if suppliers
            else "Заказ поставщику или резерв оформлен"
        )
    elif key == "movement_planned":
        description = f"Перемещение запланировано на склад «{warehouse_name}»"
    elif key == "fulfilled":
        description = f"Доставлено на склад «{warehouse_name}»"
    elif key == "cancelled":
        description = "Все позиции заявки отменены"
    else:
        description = "Требуется проверить данные заявки"
    return {
        "key": key,
        "label": str(stage.get("label") or "Состояние не определено"),
        "description": description,
        "date": (event or {}).get("date") or (
            request.get("factual_delivery_date") if key == "fulfilled" else None
        ),
        "document_number": (event or {}).get("document_number"),
    }


def _positions_summary(count: int) -> str:
    remainder_100 = count % 100
    remainder_10 = count % 10
    if 11 <= remainder_100 <= 14:
        noun = "позиций"
    elif remainder_10 == 1:
        noun = "позиция"
    elif 2 <= remainder_10 <= 4:
        noun = "позиции"
    else:
        noun = "позиций"
    return f"{count} {noun} в заявке"


def _same_destination(request: dict[str, Any], event: dict[str, Any]) -> bool:
    request_ref = str(request.get("warehouse_ref") or "").strip().lower()
    destination_ref = str(event.get("destination_ref") or "").strip().lower()
    if request_ref and destination_ref:
        return request_ref == destination_ref
    request_name = str(request.get("warehouse_name") or "").strip().casefold()
    destination_name = str(event.get("destination_name") or "").strip().casefold()
    return bool(request_name and destination_name and request_name != "все склады" and request_name == destination_name)


def build_line_state(
    request: dict[str, Any],
    line: dict[str, Any],
    events: list[dict[str, Any]],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    """Derive one line's lifecycle without relying on a request-wide status."""
    today = today or datetime.now().date()
    requested = _number(line.get("quantity"))
    ordered = _sum_quantity(events, "ordered")
    reserved = _sum_quantity(events, "reserved")
    planned = _sum_quantity(events, "movement_planned")
    received = _sum_quantity(events, "received")
    issued = _sum_quantity(events, "issued")
    delivered_by_transfer = sum(
        max(0.0, _number(event.get("quantity")))
        for event in events
        if event.get("type") == "transferred" and _same_destination(request, event)
    )
    factual_delivery = bool(request.get("factual_delivery_date"))
    fulfilled = max(issued, delivered_by_transfer, requested if factual_delivery else 0.0)
    assigned = any(event.get("type") == "assigned" for event in events)

    quantities = {
        "requested": requested,
        "ordered": ordered,
        "reserved": reserved,
        "planned": planned,
        "received": received,
        "fulfilled": fulfilled,
    }
    contradictory = requested <= QTY_EPSILON or any(
        value > requested + QTY_EPSILON
        for key, value in quantities.items()
        if key not in {"requested"}
    )

    cancelled = bool(line.get("cancelled"))
    completed = False
    if contradictory:
        stage = _stage("needs_review")
    elif cancelled:
        stage = _stage("cancelled")
        completed = True
    elif fulfilled + QTY_EPSILON >= requested:
        stage = _stage("fulfilled")
        completed = True
    elif received + QTY_EPSILON >= requested or reserved + QTY_EPSILON >= requested:
        stage = _stage("ready")
    elif received > QTY_EPSILON:
        stage = _stage("received")
    elif planned > QTY_EPSILON:
        stage = _stage("movement_planned")
    elif ordered > QTY_EPSILON:
        stage = _stage("ordered")
    elif reserved > QTY_EPSILON:
        stage = _stage("reserved")
    elif assigned:
        stage = _stage("assigned")
    elif not request.get("posted"):
        stage = _stage("draft")
    else:
        stage = _stage("created")

    required_date = line.get("required_date") or request.get("required_date")
    due = _date_only(required_date)
    overdue = bool(not completed and due and due < today)
    managers = sorted(
        {
            str(event.get("manager_name") or "").strip()
            for event in events
            if event.get("manager_name")
        }
    )
    suppliers = sorted(
        {
            str(event.get("supplier_name") or "").strip()
            for event in events
            if event.get("supplier_name")
        }
    )
    timeline = _aggregate_timeline(events)
    return {
        **line,
        "stage": stage,
        "completed": completed,
        "overdue": overdue,
        "quantities": quantities,
        "manager_names": managers,
        "supplier_names": suppliers,
        "timeline": timeline,
    }


def build_request_view(
    request: dict[str, Any],
    lines: list[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    today: date | None = None,
) -> dict[str, Any]:
    by_line_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unkeyed: list[dict[str, Any]] = []
    for event in events:
        key = str(event.get("line_key") or "").strip()
        if key:
            by_line_key[key].append(event)
        else:
            unkeyed.append(event)

    positions: list[dict[str, Any]] = []
    for line in lines:
        key = str(line.get("line_key") or "").strip()
        line_events = list(by_line_key.get(key, []))
        nomenclature_ref = str(line.get("nomenclature_ref") or "").strip()
        for event in unkeyed:
            event_nom = str(event.get("nomenclature_ref") or "").strip()
            if not event_nom or not nomenclature_ref or event_nom == nomenclature_ref:
                line_events.append(event)
        positions.append(build_line_state(request, line, line_events, today=today))

    timeline = _aggregate_timeline(events)
    destination = _destination_warehouse(request, timeline)
    event_types = {str(event.get("type") or "") for event in timeline}
    stage_attention_required = not positions or any(
        position["stage"]["key"] == "needs_review"
        for position in positions
    )
    attention_required = stage_attention_required or bool(destination.get("mismatch"))
    all_cancelled = bool(positions) and all(bool(position.get("cancelled")) for position in positions)
    delivered = bool(request.get("factual_delivery_date")) or _delivery_event(request, timeline) is not None

    if not positions:
        overall_stage = _stage("needs_review")
        is_active = True
    elif all_cancelled:
        overall_stage = _stage("cancelled")
        is_active = False
    elif delivered:
        overall_stage = _stage("fulfilled")
        is_active = False
        for position in positions:
            if position.get("cancelled"):
                continue
            position["stage"] = _stage("fulfilled")
            position["completed"] = True
            position["overdue"] = False
            quantities = position.get("quantities") or {}
            quantities["fulfilled"] = max(
                _number(quantities.get("fulfilled")),
                _number(position.get("quantity")),
            )
    elif stage_attention_required:
        overall_stage = _stage("needs_review")
        is_active = True
    elif "movement_planned" in event_types:
        overall_stage = _stage("movement_planned")
        is_active = True
    elif "ordered" in event_types:
        overall_stage = _stage("ordered")
        is_active = True
    elif "reserved" in event_types:
        overall_stage = _stage("reserved")
        is_active = True
    elif "assigned" in event_types:
        overall_stage = _stage("assigned")
        is_active = True
    elif not request.get("posted"):
        overall_stage = _stage("draft")
        is_active = True
    else:
        overall_stage = _stage("created")
        is_active = True

    completed_count = (
        len(positions)
        if not is_active
        else sum(1 for position in positions if bool(position.get("cancelled")))
    )

    managers = sorted({name for position in positions for name in position.get("manager_names", [])})
    suppliers = sorted({name for position in positions for name in position.get("supplier_names", [])})
    ordered_cost = sum(
        max(0.0, _number(event.get("amount")))
        for event in events
        if event.get("type") == "ordered"
    )
    journey = _request_journey(request, timeline, overall_stage)
    item_groups = _group_positions(positions)
    current_state = _current_state(
        request,
        timeline,
        overall_stage,
        destination,
        managers,
        suppliers,
    )
    preview = [
        {
            "name": str(item.get("name") or ""),
            "characteristic_name": str(item.get("characteristic_name") or ""),
            "quantity": _number(item.get("quantity")),
            "unit": str(item.get("unit") or ""),
        }
        for item in item_groups[:3]
    ]
    nomenclature_items = [
        {
            "name": str(item.get("name") or ""),
            "characteristic_name": str(item.get("characteristic_name") or ""),
            "quantity": _number(item.get("quantity")),
            "unit": str(item.get("unit") or ""),
        }
        for item in item_groups
    ]
    diagnostics: list[str] = []
    if not positions:
        diagnostics.append("missing_positions")
    if any(position["stage"]["key"] == "needs_review" for position in positions):
        diagnostics.append("quantity_mismatch")
    if destination.get("mismatch"):
        diagnostics.append("warehouse_mismatch")
    if destination.get("source") == "unknown":
        diagnostics.append("warehouse_unknown")
    return {
        **request,
        "warehouse_ref": destination["ref"],
        "warehouse_name": destination["name"],
        "destination_warehouse": destination,
        "stage": overall_stage,
        "current_state": current_state,
        "is_active": is_active,
        "status_group": "active" if is_active else "history",
        "overdue": bool(is_active and any(bool(position.get("overdue")) for position in positions)),
        "attention_required": attention_required,
        "positions_total": len(positions),
        "positions_unique": len(item_groups),
        "positions_completed": completed_count,
        "progress_label": (
            "Все позиции отменены"
            if all_cancelled
            else "Доставлено на склад"
            if delivered
            else _positions_summary(len(positions))
        ),
        "nomenclature_preview": preview,
        "nomenclature_items": nomenclature_items,
        "manager_names": managers,
        "supplier_names": suppliers,
        "ordered_cost": ordered_cost,
        "diagnostics": diagnostics,
        "item_groups": item_groups,
        "positions": positions,
        "journey": journey,
        "timeline": timeline,
    }


def _make_reference_array(connection: Any, references: Iterable[Any]) -> Any:
    values = connection.NewObject("Массив")
    for reference in references:
        values.Добавить(reference)
    return values


def _execute_rows(connection: Any, text: str, parameters: dict[str, Any]) -> Any:
    query = connection.NewObject("Query")
    query.Text = text
    for name, value in parameters.items():
        query.SetParameter(name, value)
    return query.Execute().Select()


def _load_headers(
    connection: Any,
    request_reference: Any | None,
    scan_limit: int,
    *,
    group_references: list[Any] | None = None,
    require_it_suffix: bool = True,
    minimum_date: datetime | None = None,
) -> tuple[list[dict[str, Any]], list[Any]]:
    if request_reference is not None:
        where = "Заявка.Ссылка = &Заявка"
        parameters = {"Заявка": request_reference}
    elif group_references:
        where = "Заявка.НоменклатурнаяГруппа В (&НоменклатурныеГруппы)"
        parameters = {
            "НоменклатурныеГруппы": _make_reference_array(connection, group_references),
        }
    else:
        where = "Заявка.ВходящийНомер ПОДОБНО &Суффикс"
        parameters = {"Суффикс": f"%{IT_REQUEST_SUFFIX}"}
    if minimum_date is not None:
        where = f"({where}) И Заявка.Дата >= &ДатаНачала"
        parameters["ДатаНачала"] = minimum_date
    limit_clause = "" if request_reference is not None else f"ПЕРВЫЕ {scan_limit}"
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ {limit_clause}
    Заявка.Ссылка КАК СсылкаЗаявки,
    Заявка.Номер КАК НомерСистемный,
    Заявка.Дата КАК ДатаЗаявки,
    Заявка.Проведен КАК Проведена,
    Заявка.ВходящийНомер КАК ВходящийНомер,
    Заявка.ВходящаяДата КАК ВходящаяДата,
    Заявка.ДатаВыполнения КАК ДатаВыполнения,
    Заявка.ДатаСозданияДокумента КАК ДатаСоздания,
    Заявка.ТБ_ДатаФактическойПоставкиНаОбъект КАК ДатаФактическойПоставки,
    Заявка.Организация КАК Организация,
    Заявка.Подразделение КАК Подразделение,
    Заявка.Инициатор КАК Инициатор,
    Заявка.Ответственный КАК Ответственный,
    Заявка.Склад КАК Склад,
    Заявка.Поставщик КАК Поставщик,
    Заявка.НоменклатурнаяГруппа КАК НоменклатурнаяГруппа,
    Заявка.Комментарий КАК Комментарий
ИЗ Документ.{REQUEST_DOCUMENT} КАК Заявка
ГДЕ НЕ Заявка.ПометкаУдаления
    И {where}
УПОРЯДОЧИТЬ ПО Заявка.Дата УБЫВ, Заявка.Номер УБЫВ
""",
        parameters,
    )
    rows: list[dict[str, Any]] = []
    references: list[Any] = []
    while selection.Next():
        incoming_number = _text(connection, _field(selection, "ВходящийНомер"))
        if require_it_suffix and not is_it_request_number(incoming_number):
            continue
        reference = _field(selection, "СсылкаЗаявки")
        request_ref = _ref_uuid(connection, reference)
        if not request_ref:
            continue
        warehouse = _field(selection, "Склад")
        supplier = _field(selection, "Поставщик")
        nomenclature_group = _field(selection, "НоменклатурнаяГруппа")
        rows.append(
            {
                "request_ref": request_ref,
                "request_number": incoming_number or _text(connection, _field(selection, "НомерСистемный")),
                "system_number": _text(connection, _field(selection, "НомерСистемный")),
                "date": _iso_datetime(_field(selection, "ДатаЗаявки")),
                "incoming_date": _iso_datetime(_field(selection, "ВходящаяДата")),
                "required_date": _iso_datetime(_field(selection, "ДатаВыполнения")),
                "created_at": _iso_datetime(_field(selection, "ДатаСоздания")),
                "factual_delivery_date": _iso_datetime(_field(selection, "ДатаФактическойПоставки")),
                "posted": bool(_field(selection, "Проведена", False)),
                "organization_name": _text(connection, _field(selection, "Организация")),
                "department_name": _text(connection, _field(selection, "Подразделение")),
                "initiator_name": _text(connection, _field(selection, "Инициатор")),
                "responsible_name": _text(connection, _field(selection, "Ответственный")),
                "warehouse_ref": _ref_uuid(connection, warehouse),
                "warehouse_name": _text(connection, warehouse),
                "supplier_ref": _ref_uuid(connection, supplier),
                "supplier_name": _text(connection, supplier),
                "group_ref": _ref_uuid(connection, nomenclature_group),
                "group_name": _text(connection, nomenclature_group),
                "comment": _text(connection, _field(selection, "Комментарий")),
            }
        )
        references.append(reference)
    return rows, references


def _load_lines(connection: Any, references: list[Any]) -> list[dict[str, Any]]:
    if not references:
        return []
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.Ссылка КАК СсылкаЗаявки,
    Строка.НомерСтроки КАК НомерСтроки,
    Строка.КлючСтрокиЗаявкиНаМПЗ КАК КлючСтроки,
    Строка.Номенклатура КАК Номенклатура,
    Строка.ХарактеристикаНоменклатуры КАК Характеристика,
    Строка.ЕдиницаИзмерения КАК ЕдиницаИзмерения,
    Строка.Количество КАК КоличествоЗаявлено,
    Строка.ДатаВыполнения КАК ДатаВыполнения,
    Строка.Отмена КАК Отмена,
    Строка.ПричинаОтмены КАК ПричинаОтмены,
    Строка.Поставщик КАК Поставщик,
    Строка.ФизическоеЛицо КАК ФизическоеЛицо,
    Строка.Комментарий КАК Комментарий
ИЗ Документ.{REQUEST_DOCUMENT}.Товары КАК Строка
ГДЕ Строка.Ссылка В (&Заявки)
УПОРЯДОЧИТЬ ПО Строка.Ссылка.Дата УБЫВ, Строка.НомерСтроки
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        nomenclature = _field(selection, "Номенклатура")
        rows.append(
            {
                "request_ref": _ref_uuid(connection, _field(selection, "СсылкаЗаявки")),
                "line_number": int(_number(_field(selection, "НомерСтроки"))),
                "line_key": _text(connection, _field(selection, "КлючСтроки")),
                "nomenclature_ref": _ref_uuid(connection, nomenclature),
                "nomenclature_name": _text(connection, nomenclature),
                "characteristic_name": _text(connection, _field(selection, "Характеристика")),
                "unit_name": _text(connection, _field(selection, "ЕдиницаИзмерения")),
                "quantity": _number(_field(selection, "КоличествоЗаявлено")),
                "required_date": _iso_datetime(_field(selection, "ДатаВыполнения")),
                "cancelled": bool(_field(selection, "Отмена", False)),
                "cancellation_reason": _text(connection, _field(selection, "ПричинаОтмены")),
                "supplier_name": _text(connection, _field(selection, "Поставщик")),
                "physical_person_name": _text(connection, _field(selection, "ФизическоеЛицо")),
                "comment": _text(connection, _field(selection, "Комментарий")),
            }
        )
    return rows


def _base_event(connection: Any, selection: Any, event_type: str) -> dict[str, Any]:
    return {
        "type": event_type,
        "label": EVENT_LABELS[event_type],
        "request_ref": _ref_uuid(connection, _field(selection, "СсылкаЗаявки")),
        "line_key": _text(connection, _field(selection, "КлючСтроки")),
        "nomenclature_ref": _ref_uuid(connection, _field(selection, "Номенклатура")),
        "nomenclature_name": _text(connection, _field(selection, "Номенклатура")),
        "quantity": _number(_field(selection, "КоличествоДокумента")),
        "document_ref": _ref_uuid(connection, _field(selection, "СсылкаДокумента")),
        "document_number": _text(connection, _field(selection, "НомерДокумента")),
        "date": _iso_datetime(_field(selection, "ДатаДокумента")),
    }


def _load_assignments(connection: Any, references: list[Any]) -> list[dict[str, Any]]:
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.Ссылка.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Строка.Номенклатура КАК Номенклатура,
    Строка.Количество КАК КоличествоДокумента,
    Строка.МенеджерПоЗакупкам КАК Менеджер,
    Строка.Ссылка КАК СсылкаДокумента,
    Строка.Ссылка.Номер КАК НомерДокумента,
    Строка.Ссылка.Дата КАК ДатаДокумента
ИЗ Документ.{ASSIGNMENT_DOCUMENT}.Товары КАК Строка
ГДЕ Строка.Ссылка.ЗаявкаНаМПЗ В (&Заявки)
    И Строка.Ссылка.Проведен
    И НЕ Строка.Ссылка.ПометкаУдаления
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        event = _base_event(connection, selection, "assigned")
        event["manager_name"] = _text(connection, _field(selection, "Менеджер"))
        rows.append(event)
    return rows


DOCUMENT_EVENT_SPECS = (
    {
        "type": "ordered",
        "document": ORDER_DOCUMENT,
        "extras": {
            "Поставщик": "Строка.Ссылка.Контрагент",
            "ЦенаДокумента": "Строка.Цена",
            "СуммаДокумента": "Строка.Сумма",
        },
    },
    {
        "type": "movement_planned",
        "document": PLAN_DOCUMENT,
        "extras": {
            "СкладОтправитель": "Строка.Ссылка.Отправитель",
            "СкладПолучатель": "Строка.Ссылка.Получатель",
        },
    },
    {
        "type": "received",
        "document": RECEIPT_DOCUMENT,
        "extras": {
            "Поставщик": "Строка.Ссылка.Контрагент",
            "СкладПолучатель": "Строка.Ссылка.Склад",
            "ЦенаДокумента": "Строка.Цена",
            "СуммаДокумента": "Строка.Сумма",
        },
    },
    {
        "type": "issued",
        "document": EXPENSE_DOCUMENT,
        "extras": {
            "СкладОтправитель": "Строка.Ссылка.Склад",
            "ЦенаДокумента": "Строка.Цена",
            "СуммаДокумента": "Строка.Сумма",
        },
    },
    {
        "type": "transferred",
        "document": TRANSFER_DOCUMENT,
        "extras": {
            "СкладОтправитель": "Строка.Ссылка.СкладОтправитель",
            "СкладПолучатель": "Строка.Ссылка.СкладПолучатель",
        },
    },
)


def _load_document_events(
    connection: Any,
    references: list[Any],
    timings: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in DOCUMENT_EVENT_SPECS:
        started = time.perf_counter()
        extras = spec["extras"]
        extra_select = "".join(f",\n    {expression} КАК {alias}" for alias, expression in extras.items())
        selection = _execute_rows(
            connection,
            f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Строка.КлючСтрокиЗаявкиНаМПЗ КАК КлючСтроки,
    Строка.Номенклатура КАК Номенклатура,
    Строка.Количество КАК КоличествоДокумента,
    Строка.Ссылка КАК СсылкаДокумента,
    Строка.Ссылка.Номер КАК НомерДокумента,
    Строка.Ссылка.Дата КАК ДатаДокумента{extra_select}
ИЗ Документ.{spec['document']}.Товары КАК Строка
ГДЕ Строка.ЗаявкаНаМПЗ В (&Заявки)
    И Строка.Ссылка.Проведен
    И НЕ Строка.Ссылка.ПометкаУдаления
""",
            {"Заявки": _make_reference_array(connection, references)},
        )
        while selection.Next():
            event = _base_event(connection, selection, str(spec["type"]))
            supplier = _field(selection, "Поставщик")
            sender = _field(selection, "СкладОтправитель")
            destination = _field(selection, "СкладПолучатель")
            event.update(
                {
                    "supplier_name": _text(connection, supplier),
                    "source_ref": _ref_uuid(connection, sender),
                    "source_name": _text(connection, sender),
                    "destination_ref": _ref_uuid(connection, destination),
                    "destination_name": _text(connection, destination),
                    "price": _number(_field(selection, "ЦенаДокумента")),
                    "amount": _number(_field(selection, "СуммаДокумента")),
                }
            )
            rows.append(event)
        if timings is not None:
            timings[f"documents_{spec['type']}_ms"] = round(
                (time.perf_counter() - started) * 1000,
                1,
            )
    return rows


def _load_reserves(connection: Any, references: list[Any]) -> list[dict[str, Any]]:
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Остатки.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Остатки.КлючСтрокиЗаявкиНаМПЗ КАК КлючСтроки,
    Остатки.Номенклатура КАК Номенклатура,
    Остатки.КоличествоОборот КАК КоличествоДокумента,
    Остатки.ДокументРезервирования КАК СсылкаДокумента
ИЗ РегистрНакопления.{RESERVE_REGISTER}.Обороты(, , , ЗаявкаНаМПЗ В (&Заявки)) КАК Остатки
ГДЕ Остатки.КоличествоОборот > 0
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        event = _base_event(connection, selection, "reserved")
        event["document_number"] = _text(connection, _field(selection, "СсылкаДокумента"))
        rows.append(event)
    return rows


def _load_views(
    connection: Any,
    request_reference: Any | None,
    scan_limit: int,
    timings: dict[str, Any] | None = None,
    *,
    group_references: list[Any] | None = None,
    require_it_suffix: bool = True,
    minimum_date: datetime | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    started = time.perf_counter()
    stage_started = started
    headers, references = _load_headers(
        connection,
        request_reference,
        scan_limit,
        group_references=group_references,
        require_it_suffix=require_it_suffix,
        minimum_date=minimum_date,
    )
    if timings is not None:
        timings["headers_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
        timings["headers"] = len(headers)
    truncated = request_reference is None and len(headers) >= scan_limit
    if not references:
        if timings is not None:
            timings["total_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return [], truncated
    stage_started = time.perf_counter()
    lines = _load_lines(connection, references)
    if timings is not None:
        timings["lines_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
        timings["lines"] = len(lines)
    stage_started = time.perf_counter()
    events = _load_assignments(connection, references)
    if timings is not None:
        timings["assignments_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
    events.extend(_load_document_events(connection, references, timings))
    stage_started = time.perf_counter()
    events.extend(_load_reserves(connection, references))
    if timings is not None:
        timings["reserves_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
        timings["events"] = len(events)
    lines_by_request: dict[str, list[dict[str, Any]]] = defaultdict(list)
    events_by_request: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        lines_by_request[str(line.get("request_ref") or "")].append(line)
    for event in events:
        events_by_request[str(event.get("request_ref") or "")].append(event)
    stage_started = time.perf_counter()
    views = [
        build_request_view(
            header,
            lines_by_request.get(str(header.get("request_ref") or ""), []),
            events_by_request.get(str(header.get("request_ref") or ""), []),
        )
        for header in headers
    ]
    if timings is not None:
        timings["build_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
        timings["total_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return views, truncated


def _configured_seconds(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(int(os.getenv(name, str(default))), maximum))
    except (TypeError, ValueError):
        return default


def _summary_from_view(view: dict[str, Any]) -> dict[str, Any]:
    summary = deepcopy(view)
    summary.pop("positions", None)
    summary.pop("timeline", None)
    summary.pop("item_groups", None)
    for step in summary.get("journey", []):
        step.pop("documents", None)
    values = [
        summary.get("request_number"),
        summary.get("system_number"),
        summary.get("department_name"),
        summary.get("responsible_name"),
        summary.get("initiator_name"),
        summary.get("warehouse_name"),
        *summary.get("manager_names", []),
        *summary.get("supplier_names", []),
        *(item.get("name") for item in summary.get("nomenclature_items", [])),
        *(item.get("characteristic_name") for item in summary.get("nomenclature_items", [])),
    ]
    summary["_search_blob"] = " ".join(str(value or "") for value in values).casefold()
    return summary


def encode_snapshot_cursor(snapshot_id: str, offset: int) -> str:
    payload = f"it-request-snapshot:{snapshot_id}:{max(0, int(offset))}".encode("ascii")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_snapshot_cursor(value: str | None) -> tuple[str | None, int]:
    text = str(value or "").strip()
    if not text:
        return None, 0
    try:
        padded = text + "=" * (-len(text) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("ascii")
        if decoded.startswith("it-request-offset:"):
            return None, max(0, int(decoded.rsplit(":", 1)[1]))
        prefix, snapshot_id, raw_offset = decoded.split(":", 2)
        if prefix != "it-request-snapshot":
            raise ValueError("unexpected cursor")
        uuid.UUID(snapshot_id)
        return snapshot_id, max(0, int(raw_offset))
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise ValueError("Некорректный cursor ИТ-заявок") from exc


class ItRequestsSnapshotStore:
    """Process-local immutable snapshot with single-flight refresh and stale fallback."""

    def __init__(
        self,
        *,
        ttl_seconds: int | None = None,
        force_refresh_cooldown_seconds: int | None = None,
        clock: Any = time.monotonic,
    ) -> None:
        self.ttl_seconds = ttl_seconds or _configured_seconds(
            "WAREHOUSE_1C_IT_REQUESTS_CACHE_TTL_SECONDS",
            DEFAULT_SNAPSHOT_TTL_SECONDS,
            30,
            3_600,
        )
        self.force_refresh_cooldown_seconds = force_refresh_cooldown_seconds or _configured_seconds(
            "WAREHOUSE_1C_IT_REQUESTS_REFRESH_COOLDOWN_SECONDS",
            DEFAULT_FORCE_REFRESH_COOLDOWN_SECONDS,
            5,
            300,
        )
        self._clock = clock
        self._condition = threading.Condition()
        self._snapshot: dict[str, Any] | None = None
        self._refreshing = False
        self._last_refresh_attempt: float | None = None
        self._last_error = ""
        self._detail_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._hits = 0
        self._misses = 0
        self._stale_served = 0
        self._coalesced = 0

    def _metadata(
        self,
        snapshot: dict[str, Any],
        *,
        stale: bool,
        refresh_suppressed: bool = False,
    ) -> dict[str, Any]:
        age_seconds = max(0, int(self._clock() - float(snapshot["created_monotonic"])))
        return {
            "snapshot_id": snapshot["id"],
            "age_seconds": age_seconds,
            "ttl_seconds": self.ttl_seconds,
            "stale": stale,
            "refreshing": self._refreshing,
            "refresh_suppressed": refresh_suppressed,
            "refresh_error": self._last_error or None,
            "last_success_at": snapshot["as_of"],
            "hits": self._hits,
            "misses": self._misses,
            "stale_served": self._stale_served,
            "coalesced": self._coalesced,
            "load_metrics": deepcopy(snapshot.get("load_metrics") or {}),
        }

    def get(self, connection: Any, *, force_refresh: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
        now = self._clock()
        with self._condition:
            snapshot = self._snapshot
            if snapshot is not None:
                is_fresh = now - float(snapshot["created_monotonic"]) < self.ttl_seconds
                force_suppressed = bool(
                    force_refresh
                    and self._last_refresh_attempt is not None
                    and now - self._last_refresh_attempt < self.force_refresh_cooldown_seconds
                )
                if (is_fresh and not force_refresh) or force_suppressed:
                    self._hits += 1
                    return snapshot, self._metadata(
                        snapshot,
                        stale=not is_fresh,
                        refresh_suppressed=force_suppressed,
                    )
                if self._refreshing:
                    self._coalesced += 1
                    self._stale_served += 1
                    return snapshot, self._metadata(snapshot, stale=True)
            elif self._refreshing:
                self._coalesced += 1
                while self._refreshing and self._snapshot is None:
                    self._condition.wait()
                if self._snapshot is not None:
                    return self._snapshot, self._metadata(self._snapshot, stale=False)

            self._refreshing = True
            self._last_refresh_attempt = now
            self._misses += 1

        load_started = time.perf_counter()
        timings: dict[str, Any] = {}
        try:
            views, truncated = _load_views(connection, None, IT_REQUEST_SCAN_MAX + 1, timings)
            if len(views) > IT_REQUEST_SCAN_MAX:
                views = views[:IT_REQUEST_SCAN_MAX]
            as_of = datetime.now(timezone.utc).isoformat()
            new_snapshot = {
                "id": str(uuid.uuid4()),
                "as_of": as_of,
                "created_monotonic": self._clock(),
                "truncated": truncated,
                "summaries": tuple(_summary_from_view(item) for item in views),
                "details": {str(item.get("request_ref") or ""): deepcopy(item) for item in views},
                "load_metrics": {
                    **timings,
                    "load_ms": round((time.perf_counter() - load_started) * 1000, 1),
                    "requests": len(views),
                },
            }
        except Exception as exc:
            with self._condition:
                self._refreshing = False
                self._last_error = str(exc) or type(exc).__name__
                snapshot = self._snapshot
                self._condition.notify_all()
                if snapshot is not None:
                    self._stale_served += 1
                    logger.warning("IT request snapshot refresh failed; serving stale data: %s", type(exc).__name__)
                    return snapshot, self._metadata(snapshot, stale=True)
            raise

        with self._condition:
            self._snapshot = new_snapshot
            self._refreshing = False
            self._last_error = ""
            self._condition.notify_all()
        logger.info(
            "IT request snapshot refreshed: requests=%s load_ms=%s truncated=%s",
            len(new_snapshot["summaries"]),
            new_snapshot["load_metrics"]["load_ms"],
            truncated,
        )
        return new_snapshot, self._metadata(new_snapshot, stale=False)

    def get_detail(self, request_ref: str) -> dict[str, Any] | None:
        with self._condition:
            if self._snapshot is not None:
                detail = self._snapshot["details"].get(request_ref)
                if detail is not None:
                    return {
                        **deepcopy(detail),
                        "as_of": self._snapshot["as_of"],
                        "snapshot_id": self._snapshot["id"],
                        "cache": self._metadata(self._snapshot, stale=False),
                    }
            cached = self._detail_cache.get(request_ref)
            if cached and self._clock() - cached[0] < self.ttl_seconds:
                return deepcopy(cached[1])
        return None

    def remember_detail(self, request_ref: str, detail: dict[str, Any]) -> None:
        with self._condition:
            self._detail_cache[request_ref] = (self._clock(), deepcopy(detail))

    def clear(self) -> None:
        with self._condition:
            self._snapshot = None
            self._detail_cache.clear()
            self._last_error = ""
            self._last_refresh_attempt = None
            self._hits = 0
            self._misses = 0
            self._stale_served = 0
            self._coalesced = 0


it_requests_snapshot_store = ItRequestsSnapshotStore()


def _warehouse_facets(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    facets: dict[str, dict[str, Any]] = {}
    for item in items:
        reference = str(item.get("warehouse_ref") or UNKNOWN_WAREHOUSE_REF).strip().lower()
        facet = facets.setdefault(reference, {
            "ref": reference,
            "name": str(item.get("warehouse_name") or "Склад не указан"),
            "count": 0,
            "active_count": 0,
            "history_count": 0,
            "overdue_count": 0,
            "nearest_required_date": None,
        })
        facet["count"] += 1
        facet["active_count" if item.get("is_active") else "history_count"] += 1
        if item.get("overdue"):
            facet["overdue_count"] += 1
        required_date = str(item.get("required_date") or "")[:10] or None
        if required_date and (
            facet["nearest_required_date"] is None
            or required_date < facet["nearest_required_date"]
        ):
            facet["nearest_required_date"] = required_date
    return list(facets.values())


def _sort_requests_by_warehouse(items: list[dict[str, Any]], view: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        reference = str(item.get("warehouse_ref") or UNKNOWN_WAREHOUSE_REF).strip().lower()
        grouped[reference].append(item)

    def sort_group(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows = sorted(
            rows,
            key=lambda item: (
                str(item.get("factual_delivery_date") or item.get("date") or ""),
                str(item.get("request_ref") or ""),
            ),
            reverse=True,
        )
        if view != "history":
            rows = sorted(
                rows,
                key=lambda item: (
                    not bool(item.get("overdue")),
                    str(item.get("required_date") or "9999-12-31"),
                    not bool(item.get("is_active")),
                ),
            )
        return rows

    sorted_groups: list[tuple[tuple[Any, ...], list[dict[str, Any]]]] = []
    for reference, rows in grouped.items():
        sorted_rows = sort_group(rows)
        name = str(sorted_rows[0].get("warehouse_name") or "Склад не указан")
        active_rows = [item for item in rows if item.get("is_active")]
        overdue_count = sum(1 for item in active_rows if item.get("overdue"))
        nearest_required = min(
            (str(item.get("required_date") or "9999-12-31") for item in active_rows),
            default="9999-12-31",
        )
        if view == "history":
            newest_delivery = max(
                (str(item.get("factual_delivery_date") or item.get("date") or "") for item in rows),
                default="",
            )
            newest_delivery_number = int(
                "".join(character for character in newest_delivery if character.isdigit())[:14] or "0"
            )
            group_key: tuple[Any, ...] = (-newest_delivery_number, name.casefold(), reference)
        else:
            group_key = (-overdue_count, nearest_required, name.casefold(), reference)
        sorted_groups.append((group_key, sorted_rows))
    sorted_groups.sort(key=lambda item: item[0])
    return [request for _, rows in sorted_groups for request in rows]


def query_it_requests(
    connection: Any,
    *,
    view: str,
    search: str,
    stage: str,
    overdue: bool | None,
    limit: int,
    cursor: str | None = None,
    warehouse_ref: str = "",
    refresh: bool = False,
    offset: int | None = None,
    snapshot_store: ItRequestsSnapshotStore | None = None,
) -> dict[str, Any]:
    store = snapshot_store or it_requests_snapshot_store
    snapshot, cache = store.get(connection, force_refresh=refresh)
    filter_started = time.perf_counter()
    tokens = str(search or "").strip().casefold().split()
    candidates: list[dict[str, Any]] = []
    for item in snapshot["summaries"]:
        if stage and item.get("stage", {}).get("key") != stage:
            continue
        if overdue is not None and bool(item.get("overdue")) != overdue:
            continue
        if tokens and not all(token in item.get("_search_blob", "") for token in tokens):
            continue
        candidates.append(item)

    filtered = [
        item
        for item in candidates
        if not (view == "active" and not item.get("is_active"))
        and not (view == "history" and item.get("is_active"))
    ]
    filtered = _sort_requests_by_warehouse(filtered, view)
    facets = _warehouse_facets(filtered)
    normalized_warehouse_ref = str(warehouse_ref or "").strip().lower()
    if normalized_warehouse_ref:
        filtered = [
            item
            for item in filtered
            if str(item.get("warehouse_ref") or UNKNOWN_WAREHOUSE_REF).strip().lower()
            == normalized_warehouse_ref
        ]
    filter_ms = round((time.perf_counter() - filter_started) * 1000, 2)

    cursor_snapshot_id, cursor_offset = decode_snapshot_cursor(cursor)
    page_offset = max(0, int(offset)) if offset is not None and not cursor else cursor_offset
    snapshot_changed = bool(cursor_snapshot_id and cursor_snapshot_id != snapshot["id"])
    if snapshot_changed:
        page_offset = 0
    page = filtered[page_offset : page_offset + limit]
    has_more = page_offset + len(page) < len(filtered)
    serialization_started = time.perf_counter()
    public_items: list[dict[str, Any]] = []
    for source in page:
        item = deepcopy(source)
        item.pop("_search_blob", None)
        public_items.append(item)

    groups: dict[str, dict[str, Any]] = {}
    for item in public_items:
        ref = str(item.get("warehouse_ref") or UNKNOWN_WAREHOUSE_REF)
        group = groups.setdefault(ref, {
            "warehouse_ref": ref,
            "warehouse_name": str(item.get("warehouse_name") or "Склад не указан"),
            "request_refs": [],
        })
        group["request_refs"].append(item.get("request_ref"))
    serialization_ms = round((time.perf_counter() - serialization_started) * 1000, 2)
    return {
        "items": public_items,
        "groups": list(groups.values()),
        "warehouse_groups": facets,
        "warehouse_facets": facets,
        "next_cursor": encode_snapshot_cursor(snapshot["id"], page_offset + len(page)) if has_more else None,
        "has_more": has_more,
        "total": len(filtered),
        "as_of": snapshot["as_of"],
        "snapshot_id": snapshot["id"],
        "snapshot_changed": snapshot_changed,
        "truncated": snapshot["truncated"],
        "source": "stale_snapshot" if cache["stale"] else "snapshot",
        "cache": cache,
        "age_seconds": cache["age_seconds"],
        "stale": cache["stale"],
        "refreshing": cache["refreshing"],
        "last_success_at": cache["last_success_at"],
        "query_metrics": {
            "filter_ms": filter_ms,
            "serialization_ms": serialization_ms,
            "cache_hit": not refresh and cache["hits"] > 0,
        },
    }


def get_cached_it_request_detail(request_ref: str) -> dict[str, Any] | None:
    return it_requests_snapshot_store.get_detail(request_ref)


def remember_it_request_detail(request_ref: str, detail: dict[str, Any]) -> None:
    it_requests_snapshot_store.remember_detail(request_ref, detail)


def query_it_request_detail(connection: Any, request_reference: Any) -> dict[str, Any] | None:
    timings: dict[str, Any] = {}
    views, _ = _load_views(connection, request_reference, 1, timings)
    if not views:
        return None
    as_of = datetime.now(timezone.utc).isoformat()
    return {
        **views[0],
        "as_of": as_of,
        "source": "live_1c",
        "load_metrics": timings,
    }
