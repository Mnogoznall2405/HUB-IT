"""Read-only MPZ request lifecycle for one HUB construction object.

The object is represented by one or more stable 1C nomenclature-group GUIDs.
All request headers, lines and linked documents are loaded in a fixed set of
queries; filters and cursor pagination run against a five-minute snapshot.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from datetime import date, datetime, time as datetime_time, timedelta, timezone
import logging
import threading
import time
from typing import Any, Callable, Iterable
import uuid

from backend.services.warehouse_1c_it_requests import (
    ASSIGNMENT_DOCUMENT,
    DOCUMENT_EVENT_SPECS,
    EVENT_LABELS,
    IT_REQUEST_EVENT_MAX,
    REQUEST_DOCUMENT,
    RESERVE_REGISTER,
    STAGE_META,
    _aggregate_timeline,
    _current_state,
    _date_only,
    _delivery_event,
    _destination_warehouse,
    _execute_rows,
    _field,
    _group_positions,
    _iso_datetime,
    _load_headers,
    _load_views,
    _make_reference_array,
    _number,
    _positions_summary,
    _ref_uuid,
    _request_journey,
    _summary_from_view,
    _sort_requests_by_warehouse,
    _stage,
    _text,
    _warehouse_facets,
    decode_snapshot_cursor,
    encode_snapshot_cursor,
)


CONSTRUCTION_OBJECT_REQUEST_SCAN_MAX = 500
CONSTRUCTION_OBJECT_REQUEST_CACHE_TTL_SECONDS = 300
CONSTRUCTION_OBJECT_REQUEST_REFRESH_COOLDOWN_SECONDS = 30
CONSTRUCTION_OBJECT_REQUEST_CACHE_MAX_OBJECTS = 64
CONSTRUCTION_OBJECT_REQUEST_WINDOW_DAYS = 365
NOMENCLATURE_GROUP_CATALOG = "НоменклатурныеГруппы"

logger = logging.getLogger(__name__)


def normalize_group_refs(values: Iterable[Any]) -> tuple[str, ...]:
    normalized: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        try:
            normalized.add(str(uuid.UUID(text)).lower())
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Некорректный GUID номенклатурной группы 1С") from exc
    if not normalized:
        raise ValueError("У объекта нет привязанных номенклатурных групп 1С")
    return tuple(sorted(normalized))


def _rebuild_group_references(connection: Any, group_refs: tuple[str, ...]) -> list[Any]:
    try:
        manager = getattr(connection.Справочники, NOMENCLATURE_GROUP_CATALOG)
        references = []
        for group_ref in group_refs:
            identifier = connection.NewObject("УникальныйИдентификатор", group_ref)
            references.append(manager.ПолучитьСсылку(identifier))
        return references
    except Exception as exc:
        raise ValueError("Не удалось восстановить ссылки номенклатурных групп 1С") from exc


def _stage_event(connection: Any, selection: Any, event_type: str) -> dict[str, Any]:
    return {
        "type": event_type,
        "label": EVENT_LABELS[event_type],
        "request_ref": _ref_uuid(connection, _field(selection, "СсылкаЗаявки")),
        "line_key": "",
        "nomenclature_ref": "",
        "nomenclature_name": "",
        "quantity": _number(_field(selection, "КоличествоДокумента")),
        "document_ref": _ref_uuid(connection, _field(selection, "СсылкаДокумента")),
        "document_number": _text(connection, _field(selection, "НомерДокумента")),
        "date": _iso_datetime(_field(selection, "ДатаДокумента")),
    }


def _load_summary_lines(
    connection: Any,
    references: list[Any],
    *,
    nomenclature_lookup: Callable[[list[str]], dict[str, dict[str, str]]] | None = None,
) -> list[dict[str, Any]]:
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.Ссылка КАК СсылкаЗаявки,
    Строка.Номенклатура КАК Номенклатура,
    Строка.ХарактеристикаНоменклатуры КАК Характеристика,
    Строка.ЕдиницаИзмерения КАК ЕдиницаИзмерения,
    Строка.Отмена КАК Отмена,
    Строка.ПричинаОтмены КАК ПричинаОтмены,
    МИНИМУМ(Строка.ДатаВыполнения) КАК ДатаВыполнения,
    СУММА(Строка.Количество) КАК КоличествоЗаявлено
ИЗ Документ.{REQUEST_DOCUMENT}.Товары КАК Строка
ГДЕ Строка.Ссылка В (&Заявки)
СГРУППИРОВАТЬ ПО
    Строка.Ссылка,
    Строка.Номенклатура,
    Строка.ХарактеристикаНоменклатуры,
    Строка.ЕдиницаИзмерения,
    Строка.Отмена,
    Строка.ПричинаОтмены
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    nomenclature_values: dict[str, Any] = {}
    while selection.Next():
        nomenclature = _field(selection, "Номенклатура")
        nomenclature_ref = _ref_uuid(connection, nomenclature)
        if nomenclature_ref and nomenclature_lookup is not None:
            nomenclature_values.setdefault(nomenclature_ref, nomenclature)
        rows.append(
            {
                "request_ref": _ref_uuid(connection, _field(selection, "СсылкаЗаявки")),
                "line_key": "",
                "nomenclature_ref": nomenclature_ref,
                "nomenclature_name": (
                    "" if nomenclature_lookup is not None else _text(connection, nomenclature)
                ),
                "characteristic_name": _text(connection, _field(selection, "Характеристика")),
                "unit_name": _text(connection, _field(selection, "ЕдиницаИзмерения")),
                "quantity": _number(_field(selection, "КоличествоЗаявлено")),
                "required_date": _iso_datetime(_field(selection, "ДатаВыполнения")),
                "cancelled": bool(_field(selection, "Отмена", False)),
                "cancellation_reason": _text(connection, _field(selection, "ПричинаОтмены")),
            }
        )
    if nomenclature_lookup is not None and nomenclature_values:
        resolved = nomenclature_lookup(list(nomenclature_values))
        names = {
            str(ref or "").strip().lower(): str(item.get("name") or "").strip()
            for ref, item in dict(resolved or {}).items()
            if isinstance(item, dict)
        }
        fallback_names: dict[str, str] = {}
        for ref, value in nomenclature_values.items():
            if not names.get(ref.lower()):
                fallback_names[ref] = _text(connection, value)
        for row in rows:
            ref = str(row.get("nomenclature_ref") or "")
            row["nomenclature_name"] = names.get(ref.lower()) or fallback_names.get(ref, "")
    return rows


def _load_stage_assignments(connection: Any, references: list[Any]) -> list[dict[str, Any]]:
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.Ссылка.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Строка.МенеджерПоЗакупкам КАК Менеджер,
    Строка.Ссылка КАК СсылкаДокумента,
    Строка.Ссылка.Номер КАК НомерДокумента,
    Строка.Ссылка.Дата КАК ДатаДокумента,
    СУММА(Строка.Количество) КАК КоличествоДокумента
ИЗ Документ.{ASSIGNMENT_DOCUMENT}.Товары КАК Строка
ГДЕ Строка.Ссылка.ЗаявкаНаМПЗ В (&Заявки)
    И Строка.Ссылка.Проведен
    И НЕ Строка.Ссылка.ПометкаУдаления
СГРУППИРОВАТЬ ПО
    Строка.Ссылка.ЗаявкаНаМПЗ,
    Строка.МенеджерПоЗакупкам,
    Строка.Ссылка,
    Строка.Ссылка.Номер,
    Строка.Ссылка.Дата
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        event = _stage_event(connection, selection, "assigned")
        event["manager_name"] = _text(connection, _field(selection, "Менеджер"))
        rows.append(event)
    return rows


def _load_stage_document_events(
    connection: Any,
    references: list[Any],
    timings: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for spec in DOCUMENT_EVENT_SPECS:
        started = time.perf_counter()
        extras = spec["extras"]
        selected_extras = {
            alias: expression
            for alias, expression in extras.items()
            if alias in {"Поставщик", "СкладОтправитель", "СкладПолучатель"}
        }
        extra_select = "".join(
            f",\n    {expression} КАК {alias}"
            for alias, expression in selected_extras.items()
        )
        amount_select = (
            ",\n    СУММА(Строка.Сумма) КАК СуммаДокумента"
            if "СуммаДокумента" in extras
            else ""
        )
        group_extras = "".join(
            f",\n    {expression}"
            for expression in selected_extras.values()
        )
        selection = _execute_rows(
            connection,
            f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Строка.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Строка.Ссылка КАК СсылкаДокумента,
    Строка.Ссылка.Номер КАК НомерДокумента,
    Строка.Ссылка.Дата КАК ДатаДокумента,
    СУММА(Строка.Количество) КАК КоличествоДокумента{amount_select}{extra_select}
ИЗ Документ.{spec['document']}.Товары КАК Строка
ГДЕ Строка.ЗаявкаНаМПЗ В (&Заявки)
    И Строка.Ссылка.Проведен
    И НЕ Строка.Ссылка.ПометкаУдаления
СГРУППИРОВАТЬ ПО
    Строка.ЗаявкаНаМПЗ,
    Строка.Ссылка,
    Строка.Ссылка.Номер,
    Строка.Ссылка.Дата{group_extras}
""",
            {"Заявки": _make_reference_array(connection, references)},
        )
        while selection.Next():
            event = _stage_event(connection, selection, str(spec["type"]))
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
                    "amount": _number(_field(selection, "СуммаДокумента")),
                }
            )
            rows.append(event)
        timings[f"documents_{spec['type']}_ms"] = round(
            (time.perf_counter() - started) * 1000,
            1,
        )
    return rows


def _load_stage_reserves(connection: Any, references: list[Any]) -> list[dict[str, Any]]:
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {IT_REQUEST_EVENT_MAX}
    Остатки.ЗаявкаНаМПЗ КАК СсылкаЗаявки,
    Остатки.ДокументРезервирования КАК СсылкаДокумента,
    СУММА(Остатки.КоличествоОборот) КАК КоличествоДокумента
ИЗ РегистрНакопления.{RESERVE_REGISTER}.Обороты(, , , ЗаявкаНаМПЗ В (&Заявки)) КАК Остатки
ГДЕ Остатки.КоличествоОборот > 0
СГРУППИРОВАТЬ ПО
    Остатки.ЗаявкаНаМПЗ,
    Остатки.ДокументРезервирования
""",
        {"Заявки": _make_reference_array(connection, references)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        event = _stage_event(connection, selection, "reserved")
        event["document_number"] = _text(connection, _field(selection, "СсылкаДокумента"))
        rows.append(event)
    return rows


def _build_request_summary(
    request: dict[str, Any],
    lines: list[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    today: date,
) -> dict[str, Any]:
    timeline = _aggregate_timeline(events)
    destination = _destination_warehouse(request, timeline)
    event_types = {str(event.get("type") or "") for event in timeline}
    all_cancelled = bool(lines) and all(bool(line.get("cancelled")) for line in lines)
    delivered = bool(request.get("factual_delivery_date")) or _delivery_event(request, timeline) is not None
    attention_required = not lines or bool(destination.get("mismatch"))

    if not lines:
        overall_stage = _stage("needs_review")
        is_active = True
    elif all_cancelled:
        overall_stage = _stage("cancelled")
        is_active = False
    elif delivered:
        overall_stage = _stage("fulfilled")
        is_active = False
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

    overdue = False
    if is_active:
        for line in lines:
            if line.get("cancelled"):
                continue
            due = _date_only(line.get("required_date") or request.get("required_date"))
            if due and due < today:
                overdue = True
                break
    managers = sorted(
        {str(event.get("manager_name") or "").strip() for event in events if event.get("manager_name")}
    )
    suppliers = sorted(
        {str(event.get("supplier_name") or "").strip() for event in events if event.get("supplier_name")}
    )
    item_groups = _group_positions(lines)
    nomenclature_items = [
        {
            "name": str(item.get("name") or ""),
            "characteristic_name": str(item.get("characteristic_name") or ""),
            "quantity": _number(item.get("quantity")),
            "unit": str(item.get("unit") or ""),
        }
        for item in item_groups
    ]
    journey = _request_journey(request, timeline, overall_stage)
    current_state = _current_state(
        request,
        timeline,
        overall_stage,
        destination,
        managers,
        suppliers,
    )
    diagnostics: list[str] = []
    if not lines:
        diagnostics.append("missing_positions")
    if destination.get("mismatch"):
        diagnostics.append("warehouse_mismatch")
    if destination.get("source") == "unknown":
        diagnostics.append("warehouse_unknown")
    view = {
        **request,
        "warehouse_ref": destination["ref"],
        "warehouse_name": destination["name"],
        "destination_warehouse": destination,
        "stage": overall_stage,
        "current_state": current_state,
        "is_active": is_active,
        "status_group": "active" if is_active else "history",
        "overdue": overdue,
        "attention_required": attention_required,
        "positions_total": len(lines),
        "positions_unique": len(item_groups),
        "positions_completed": len(lines) if not is_active else sum(bool(line.get("cancelled")) for line in lines),
        "progress_label": (
            "Все позиции отменены"
            if all_cancelled
            else "Доставлено на склад"
            if delivered
            else _positions_summary(len(lines))
        ),
        "nomenclature_preview": nomenclature_items[:3],
        "nomenclature_items": nomenclature_items,
        "manager_names": managers,
        "supplier_names": suppliers,
        "ordered_cost": sum(
            max(0.0, _number(event.get("amount")))
            for event in events
            if event.get("type") == "ordered"
        ),
        "diagnostics": diagnostics,
        "journey": journey,
    }
    return _summary_from_view(view)


def _load_construction_request_summaries(
    connection: Any,
    group_references: list[Any],
    scan_limit: int,
    timings: dict[str, Any],
    *,
    now: datetime | None = None,
    nomenclature_lookup: Callable[[list[str]], dict[str, dict[str, str]]] | None = None,
) -> tuple[list[dict[str, Any]], bool, str]:
    current = now or datetime.now()
    window_from = current.date() - timedelta(days=CONSTRUCTION_OBJECT_REQUEST_WINDOW_DAYS)
    started = time.perf_counter()
    stage_started = started
    headers, references = _load_headers(
        connection,
        None,
        scan_limit,
        group_references=group_references,
        require_it_suffix=False,
        minimum_date=datetime.combine(window_from, datetime_time.min),
    )
    timings["headers_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
    timings["headers"] = len(headers)
    truncated = len(headers) >= scan_limit
    if not references:
        timings["total_ms"] = round((time.perf_counter() - started) * 1000, 1)
        return [], truncated, window_from.isoformat()

    stage_started = time.perf_counter()
    lines = _load_summary_lines(
        connection,
        references,
        nomenclature_lookup=nomenclature_lookup,
    )
    timings["lines_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
    timings["lines"] = len(lines)
    stage_started = time.perf_counter()
    events = _load_stage_assignments(connection, references)
    timings["assignments_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
    events.extend(_load_stage_document_events(connection, references, timings))
    stage_started = time.perf_counter()
    events.extend(_load_stage_reserves(connection, references))
    timings["reserves_ms"] = round((time.perf_counter() - stage_started) * 1000, 1)
    timings["events"] = len(events)

    lines_by_request: dict[str, list[dict[str, Any]]] = defaultdict(list)
    events_by_request: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        lines_by_request[str(line.get("request_ref") or "")].append(line)
    for event in events:
        events_by_request[str(event.get("request_ref") or "")].append(event)
    summaries = [
        _build_request_summary(
            header,
            lines_by_request.get(str(header.get("request_ref") or ""), []),
            events_by_request.get(str(header.get("request_ref") or ""), []),
            today=current.date(),
        )
        for header in headers
    ]
    timings["total_ms"] = round((time.perf_counter() - started) * 1000, 1)
    return summaries, truncated, window_from.isoformat()


class ConstructionObjectRequestsSnapshotStore:
    """Small keyed cache with stale fallback and one refresh per object."""

    def __init__(
        self,
        *,
        ttl_seconds: int = CONSTRUCTION_OBJECT_REQUEST_CACHE_TTL_SECONDS,
        force_refresh_cooldown_seconds: int = CONSTRUCTION_OBJECT_REQUEST_REFRESH_COOLDOWN_SECONDS,
        max_objects: int = CONSTRUCTION_OBJECT_REQUEST_CACHE_MAX_OBJECTS,
        clock: Any = time.monotonic,
    ) -> None:
        self.ttl_seconds = max(1, int(ttl_seconds))
        self.force_refresh_cooldown_seconds = max(0, int(force_refresh_cooldown_seconds))
        self.max_objects = max(1, int(max_objects))
        self._clock = clock
        self._condition = threading.Condition()
        self._snapshots: dict[tuple[str, ...], dict[str, Any]] = {}
        self._refreshing: set[tuple[str, ...]] = set()
        self._last_refresh_attempt: dict[tuple[str, ...], float] = {}
        self._last_errors: dict[tuple[str, ...], str] = {}

    def _metadata(
        self,
        key: tuple[str, ...],
        snapshot: dict[str, Any],
        *,
        state: str,
        refresh_suppressed: bool = False,
        coalesced: bool = False,
    ) -> dict[str, Any]:
        age_seconds = max(0, int(self._clock() - float(snapshot["created_monotonic"])))
        return {
            "state": state,
            "age_seconds": age_seconds,
            "ttl_seconds": self.ttl_seconds,
            "stale": state == "stale",
            "refreshing": key in self._refreshing,
            "refresh_suppressed": refresh_suppressed,
            "coalesced": coalesced,
            "refresh_error": self._last_errors.get(key) or None,
            "last_success_at": snapshot["as_of"],
            "load_metrics": deepcopy(snapshot.get("load_metrics") or {}),
        }

    def _evict_if_needed(self, keep: tuple[str, ...]) -> None:
        if len(self._snapshots) <= self.max_objects:
            return
        candidates = [
            (key, float(value.get("created_monotonic") or 0))
            for key, value in self._snapshots.items()
            if key != keep and key not in self._refreshing
        ]
        if candidates:
            oldest, _ = min(candidates, key=lambda item: item[1])
            self._snapshots.pop(oldest, None)
            self._last_refresh_attempt.pop(oldest, None)
            self._last_errors.pop(oldest, None)

    def get(
        self,
        connection: Any,
        group_refs: Iterable[Any],
        *,
        force_refresh: bool = False,
        nomenclature_lookup: Callable[[list[str]], dict[str, dict[str, str]]] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        key = normalize_group_refs(group_refs)
        now = self._clock()
        with self._condition:
            snapshot = self._snapshots.get(key)
            age = now - float(snapshot["created_monotonic"]) if snapshot is not None else 0.0
            refresh_suppressed = bool(
                force_refresh
                and snapshot is not None
                and now - self._last_refresh_attempt.get(key, float("-inf"))
                < self.force_refresh_cooldown_seconds
            )
            if snapshot is not None and (
                (not force_refresh and age < self.ttl_seconds) or refresh_suppressed
            ):
                return snapshot, self._metadata(
                    key,
                    snapshot,
                    state="cached",
                    refresh_suppressed=refresh_suppressed,
                )
            if key in self._refreshing:
                if snapshot is not None:
                    return snapshot, self._metadata(
                        key,
                        snapshot,
                        state="stale",
                        coalesced=True,
                    )
                while key in self._refreshing and key not in self._snapshots:
                    self._condition.wait()
                snapshot = self._snapshots.get(key)
                if snapshot is not None:
                    return snapshot, self._metadata(
                        key,
                        snapshot,
                        state="cached",
                        coalesced=True,
                    )
            self._refreshing.add(key)
            self._last_refresh_attempt[key] = now

        load_started = time.perf_counter()
        timings: dict[str, Any] = {}
        try:
            references = _rebuild_group_references(connection, key)
            summaries, truncated, window_from = _load_construction_request_summaries(
                connection,
                references,
                CONSTRUCTION_OBJECT_REQUEST_SCAN_MAX + 1,
                timings,
                nomenclature_lookup=nomenclature_lookup,
            )
            if len(summaries) > CONSTRUCTION_OBJECT_REQUEST_SCAN_MAX:
                summaries = summaries[:CONSTRUCTION_OBJECT_REQUEST_SCAN_MAX]
                truncated = True
            as_of = datetime.now(timezone.utc).isoformat()
            source_groups: dict[str, str] = {}
            for summary in summaries:
                group_ref = str(summary.get("group_ref") or "").strip().lower()
                if group_ref:
                    source_groups[group_ref] = str(summary.get("group_name") or "").strip()
            new_snapshot = {
                "id": str(uuid.uuid4()),
                "as_of": as_of,
                "window_from": window_from,
                "created_monotonic": self._clock(),
                "truncated": bool(truncated),
                "summaries": tuple(summaries),
                "details": {},
                "source_groups": tuple(
                    {"group_ref": group_ref, "group_name": source_groups.get(group_ref, "")}
                    for group_ref in key
                ),
                "load_metrics": {
                    **timings,
                    "load_ms": round((time.perf_counter() - load_started) * 1000, 1),
                    "requests": len(summaries),
                    "query_count": 9,
                },
            }
        except Exception as exc:
            with self._condition:
                self._refreshing.discard(key)
                self._last_errors[key] = str(exc) or type(exc).__name__
                stale = self._snapshots.get(key)
                self._condition.notify_all()
                if stale is not None:
                    logger.warning(
                        "Construction request snapshot refresh failed; serving stale data: %s",
                        type(exc).__name__,
                    )
                    return stale, self._metadata(key, stale, state="stale")
            raise

        with self._condition:
            self._snapshots[key] = new_snapshot
            self._refreshing.discard(key)
            self._last_errors[key] = ""
            self._evict_if_needed(key)
            self._condition.notify_all()
        return new_snapshot, self._metadata(key, new_snapshot, state="fresh")

    def get_detail(self, group_refs: Iterable[Any], request_ref: str) -> dict[str, Any] | None:
        key = normalize_group_refs(group_refs)
        with self._condition:
            snapshot = self._snapshots.get(key)
            if snapshot is None:
                return None
            detail = snapshot["details"].get(str(request_ref or "").strip().lower())
            if detail is None:
                return None
            return {
                **deepcopy(detail),
                "as_of": snapshot["as_of"],
                "snapshot_id": snapshot["id"],
                "source": "snapshot",
                "cache": self._metadata(key, snapshot, state="cached"),
            }

    def remember_detail(
        self,
        group_refs: Iterable[Any],
        request_ref: str,
        detail: dict[str, Any],
    ) -> None:
        key = normalize_group_refs(group_refs)
        with self._condition:
            snapshot = self._snapshots.get(key)
            if snapshot is not None:
                snapshot["details"][str(request_ref or "").strip().lower()] = deepcopy(detail)


construction_object_requests_store = ConstructionObjectRequestsSnapshotStore()


def _request_overview(items: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    active_items = [item for item in items if item.get("is_active")]
    buyers: Counter[str] = Counter()
    responsibles: Counter[str] = Counter()
    departments: Counter[str] = Counter()
    warehouses: Counter[str] = Counter()
    stages: Counter[str] = Counter()
    for item in active_items:
        for name in set(item.get("manager_names") or []):
            normalized = str(name or "").strip()
            if normalized:
                buyers[normalized] += 1
        responsible = str(item.get("responsible_name") or "").strip()
        if responsible:
            responsibles[responsible] += 1
        department = str(item.get("department_name") or "").strip()
        if department:
            departments[department] += 1
        warehouse = str(item.get("warehouse_name") or "").strip()
        if warehouse:
            warehouses[warehouse] += 1
        stage_key = str(item.get("stage", {}).get("key") or "").strip()
        if stage_key:
            stages[stage_key] += 1

    def ranked(counter: Counter[str]) -> list[dict[str, Any]]:
        return [
            {"name": name, "active_requests": count}
            for name, count in sorted(counter.items(), key=lambda entry: (-entry[1], entry[0].casefold()))
        ]

    return {
        "buyers": ranked(buyers),
        "request_responsibles": ranked(responsibles),
        "departments": ranked(departments),
        "warehouses": ranked(warehouses),
        "stages": [
            {"key": key, "label": str(STAGE_META[key]["label"]), "count": stages[key]}
            for key in STAGE_META
            if stages.get(key)
        ],
    }


def query_construction_object_requests(
    connection: Any,
    *,
    group_refs: Iterable[Any],
    view: str = "active",
    search: str = "",
    stage: str = "",
    overdue: bool | None = None,
    warehouse_ref: str = "",
    limit: int = 25,
    cursor: str | None = None,
    refresh: bool = False,
    snapshot_store: ConstructionObjectRequestsSnapshotStore | None = None,
    nomenclature_lookup: Callable[[list[str]], dict[str, dict[str, str]]] | None = None,
) -> dict[str, Any]:
    store = snapshot_store or construction_object_requests_store
    snapshot, cache = store.get(
        connection,
        group_refs,
        force_refresh=refresh,
        nomenclature_lookup=nomenclature_lookup,
    )
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
        if view == "active" and not item.get("is_active"):
            continue
        if view == "history" and item.get("is_active"):
            continue
        candidates.append(item)

    sorted_items = _sort_requests_by_warehouse(candidates, view)
    facets = _warehouse_facets(sorted_items)
    normalized_warehouse_ref = str(warehouse_ref or "").strip().lower()
    if normalized_warehouse_ref:
        sorted_items = [
            item
            for item in sorted_items
            if str(item.get("warehouse_ref") or "__unknown__").strip().lower()
            == normalized_warehouse_ref
        ]
    filter_ms = round((time.perf_counter() - filter_started) * 1000, 2)

    cursor_snapshot_id, offset = decode_snapshot_cursor(cursor)
    snapshot_changed = bool(cursor_snapshot_id and cursor_snapshot_id != snapshot["id"])
    if snapshot_changed:
        offset = 0
    page = sorted_items[offset : offset + limit]
    has_more = offset + len(page) < len(sorted_items)
    public_items: list[dict[str, Any]] = []
    for source in page:
        item = deepcopy(source)
        item.pop("_search_blob", None)
        public_items.append(item)

    all_items = list(snapshot["summaries"])
    return {
        "items": public_items,
        "next_cursor": encode_snapshot_cursor(snapshot["id"], offset + len(page)) if has_more else None,
        "has_more": has_more,
        "total": len(sorted_items),
        "snapshot_id": snapshot["id"],
        "snapshot_changed": snapshot_changed,
        "as_of": snapshot["as_of"],
        "window_from": snapshot["window_from"],
        "truncated": snapshot["truncated"],
        "source_groups": list(snapshot["source_groups"]),
        "warehouse_facets": facets,
        "overview": _request_overview(all_items),
        "summary": {
            "total": len(all_items),
            "active": sum(1 for item in all_items if item.get("is_active")),
            "history": sum(1 for item in all_items if not item.get("is_active")),
            "overdue": sum(1 for item in all_items if item.get("overdue")),
        },
        "cache": cache,
        "query_metrics": {
            "filter_ms": filter_ms,
            "query_count": int(cache.get("load_metrics", {}).get("query_count") or 0),
        },
    }


def get_cached_construction_request_detail(
    group_refs: Iterable[Any],
    request_ref: str,
) -> dict[str, Any] | None:
    return construction_object_requests_store.get_detail(group_refs, request_ref)


def query_construction_object_request_detail(
    connection: Any,
    request_reference: Any,
    *,
    group_refs: Iterable[Any],
) -> dict[str, Any] | None:
    normalized_groups = set(normalize_group_refs(group_refs))
    timings: dict[str, Any] = {}
    views, _ = _load_views(
        connection,
        request_reference,
        1,
        timings,
        require_it_suffix=False,
    )
    if not views:
        return None
    detail = views[0]
    if str(detail.get("group_ref") or "").strip().lower() not in normalized_groups:
        return None
    result = {
        **detail,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "live_1c",
        "load_metrics": {**timings, "query_count": 9},
    }
    construction_object_requests_store.remember_detail(
        normalized_groups,
        str(detail.get("request_ref") or ""),
        result,
    )
    return result


__all__ = [
    "ConstructionObjectRequestsSnapshotStore",
    "get_cached_construction_request_detail",
    "normalize_group_refs",
    "query_construction_object_request_detail",
    "query_construction_object_requests",
    "STAGE_META",
]
