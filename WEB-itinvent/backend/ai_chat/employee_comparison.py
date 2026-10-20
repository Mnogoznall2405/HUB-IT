"""Present the existing portal comparison, without asking the LLM to reinterpret it."""
from __future__ import annotations

import copy
import html
import re
from datetime import datetime
from typing import Any


EMPLOYEE_TOOL = "itinvent.employee.list_equipment"
_READ_TOOLS = {EMPLOYEE_TOOL, "itinvent.employee.search", "ai.request_tool_group"}
_MIXED_REQUEST = r"отправ|письм|создай|создать|выгруз|экспорт|заявк|а также|а потом|затем"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _cell(value: Any) -> str:
    text = html.escape(re.sub(r"\s+", " ", _text(value)))
    return re.sub(r"([\\|`*_\[\]])", r"\\\1", text) or "—"


def _code(value: Any) -> str:
    return re.sub(r"\s+", " ", _text(value)).casefold()


def _qty(value: Any) -> str:
    return f"{value:g}".replace(".", ",") if isinstance(value, (int, float)) else "—"


def comparison_snapshot(data: dict[str, Any]) -> dict[str, Any]:
    """Bounded evidence for this run; no email, network fields or raw transport data."""
    comparison = data.get("comparison_1c") or {}
    fields = ("employee_name", "warehouse_name", "status", "complete", "matches_all", "coverage_complete",
              "counts", "part_status", "part_quantities", "part_names", "unverified_items", "truncated", "reason", "reason_code")
    result = {key: copy.deepcopy(comparison[key]) for key in fields if key in comparison}
    meta = comparison.get("meta") or {}
    result["meta"] = {key: meta[key] for key in (
        "status", "balances_status", "balances_truncated", "catalog_truncated", "as_of", "source", "reason_code"
    ) if key in meta}
    items = [
        {key: row.get(key) for key in ("inv_no", "serial_no", "part_no", "model_name", "type_name")}
        for row in (data.get("items") or [])[:250] if isinstance(row, dict)
    ]
    return {"schema_version": 1, "total": data.get("total"), "returned_count": len(items),
            "truncated": bool(data.get("truncated")), "items": items, "comparison_1c": result}


def render_employee_lookup(results: list[dict[str, Any]], *, request_text: str) -> str | None:
    """Present an unresolved employee lookup after orchestration has finished."""
    request = _text(request_text).casefold()
    if re.search(_MIXED_REQUEST, request) or not re.search(r"техник|оборудован|устройств|свер|расхожд", request):
        return None
    if any(row.get("tool_id") not in _READ_TOOLS or not row.get("ok") for row in results):
        return None
    if any(row.get("tool_id") == EMPLOYEE_TOOL for row in results):
        return None
    searches = [row for row in results if row.get("tool_id") == "itinvent.employee.search"]
    if not searches:
        return None
    data = searches[-1].get("data") or {}
    items = data.get("items") or []
    total = int(data.get("total") or 0)
    if total == 1 and not data.get("truncated"):
        return None
    query = _cell((searches[0].get("data") or {}).get("query"))
    if not items and not total:
        # Preserve all attempts; no new search policy or early termination.
        if any((row.get("data") or {}).get("items") for row in searches):
            return None
        lines = [f"Сотрудник «{query}» не найден в ITinvent. Уточните полное ФИО или отдел."]
    elif total > 1:
        lines = [f"По запросу «{query}» найдено сотрудников: {total}. Уточните отдел или филиал.", "",
                 "| ФИО | Отдел | Филиал |", "|---|---|---|"]
        lines.extend(f"| {_cell(row.get('full_name'))} | {_cell(row.get('department'))} | {_cell(row.get('branch'))} |"
                     for row in items[:6])
        if len(items[:6]) < total:
            lines.append(f"Показано сотрудников: {len(items[:6])} из {total}.")
    else:
        return None
    lines.extend(["", f"Источник: ITinvent / {_cell(searches[-1].get('database_id'))}."])
    return "\n".join(lines)


def render_employee_comparison(results: list[dict[str, Any]], *, request_text: str) -> str | None:
    """Only a single employee comparison; leave files and mixed tasks to orchestration."""
    request = _text(request_text).casefold()
    if re.search(_MIXED_REQUEST, request):
        return None
    if any(row.get("tool_id") not in _READ_TOOLS or not row.get("ok") for row in results):
        return None
    candidates = [row for row in results if row.get("tool_id") == EMPLOYEE_TOOL]
    if len(candidates) != 1:
        return None
    data = candidates[0].get("data") or {}
    comp = data.get("comparison_1c")
    if not isinstance(comp, dict):
        return None
    counts = comp.get("counts") or {}
    items = data.get("items") or []
    total = int(data.get("total") or 0)
    quantities = comp.get("part_quantities") or {}
    statuses = comp.get("part_status") or {}
    names = comp.get("part_names") or {}
    full_list = bool(re.search(r"полный\s+(?:список|перечень)|всю\s+техник|все\s+устройств|каждое\s+устройств", request))
    employee_name = comp.get("employee_name")
    if not employee_name:
        for result in reversed(results):
            if result.get("tool_id") != "itinvent.employee.search" or result.get("database_id") != candidates[0].get("database_id"):
                continue
            employee_name = next((row.get("full_name") for row in (result.get("data") or {}).get("items") or []
                                  if row.get("owner_no") == data.get("owner_no")), None)
            if employee_name:
                break
    title = f"Сверка по сотруднику «{_cell(employee_name)}»" if employee_name else "Сверка техники сотрудника"
    lines = []
    if not comp.get("complete"):
        reasons = {
            "forbidden": "Нет доступа к подключённому складу 1С.",
            "ambiguous": "Найдено несколько складов 1С с подходящим именем. Нужно уточнить склад.",
            "no_warehouse": "Подходящий склад сотрудника в 1С не найден.",
            "error": "Не удалось получить данные сверки из 1С. Повторите запрос позже.",
        }
        reason = reasons.get(comp.get("status"), "Данные сверки неполные, устарели или изменились. Нужен повторный запрос.")
        safe_reasons = {
            "invalid_quantity": "1С вернула некорректное количество. Результат сверки не подтверждён; нужна проверка данных источника.",
            "queue_full": "Очередь запросов к 1С заполнена. Повторите запрос позже.",
            "queue_timeout": "Запрос не дождался свободного места в очереди 1С. Повторите запрос позже.",
            "comparison_busy": "Сверка занята другим запросом. Повторите запрос позже.",
            "timeout": "1С не ответила вовремя. Повторите запрос позже.",
            "worker_lost": "Процесс подключения к 1С завершился во время чтения. Повторите запрос позже.",
            "worker_startup_failed": "Не удалось запустить подключение к 1С. Нужна проверка интеграции.",
            "circuit_open": "Подключение к 1С временно приостановлено после ошибок. Повторите запрос позже.",
            "bridge_stopped": "Подключение к 1С остановлено. Нужна проверка интеграции.",
            "bridge_not_ready": "Подключение к 1С ещё не готово. Повторите запрос позже.",
            "configuration_error": "Подключение к 1С не настроено. Нужна проверка интеграции.",
        }
        reason = safe_reasons.get(comp.get("reason_code"), reason)
        lines.append(f"{title}: **подтвердить не удалось**. В ITinvent устройств: {total}. {reason}")
    else:
        matched = int(counts.get("matched_items") or 0)
        unverified = int(counts.get("no_part") or 0) + int(counts.get("not_in_1c") or 0)
        if not total:
            positions = int(counts.get("one_c_positions") or 0)
            stock = (f"В 1С: {_qty(counts.get('one_c_units'))} ед. на {positions} позициях."
                     if positions else "На складе 1С остатков нет.")
            lines.append(f"{title}. В ITinvent устройств: 0. {stock}")
        elif comp.get("matches_all") is True and not unverified and not comp.get("truncated"):
            lines.append(f"{title}: **все позиции совпадают по количеству**. Устройств в ITinvent: {total}.")
        else:
            finding = "сверка частичная" if unverified or comp.get("truncated") else "найдены расхождения"
            lines.append(f"{title}: **{finding}**. Совпало по количеству: **{matched} из {total} устройств**.")
        equipment_by_code: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            equipment_by_code.setdefault(_code(item.get("part_no")), []).append(item)
        differences = []
        for code, row in quantities.items():
            status = statuses.get(code)
            if status not in {"diff", "only_hub", "only_1c"}:
                continue
            linked = equipment_by_code.get(code) or []
            name = names.get(code) or next((_text(item.get("model_name") or item.get("name")) for item in linked
                                           if item.get("model_name") or item.get("name")), None)
            label = _cell(name or "Позиция 1С") + f" ({_cell(code.upper())})"
            hub_qty = _qty(row.get("hub_count"))
            one_c_qty = _qty(row.get("qty_1c"))
            explanation = "Разное количество"
            if status == "only_1c":
                hub_qty = "Не сопоставлено"
                explanation = "В ITinvent не найдена карточка с этим кодом"
            elif status == "only_hub":
                one_c_qty = "0"
                explanation = "На складе 1С нет остатка с этим кодом"
            differences.append((label, hub_qty, one_c_qty, explanation))
        if differences:
            lines.extend(["", "| Устройство / позиция | ITinvent, шт. | 1С, шт. | Что обнаружено |",
                          "|---|---:|---:|---|"])
            lines.extend("| " + " | ".join(row) + " |" for row in sorted(differences))
        if unverified:
            unknown = comp.get("unverified_items") or []
            labels = [f"{_cell(row.get('model_name') or row.get('type_name') or 'Устройство')} (инв. {_cell(row.get('inv_no'))})"
                      for row in unknown]
            lines.extend(["", "**Не проверены:** " + ("; ".join(labels) if labels else f"устройств: {unverified}") + "."])
            lines.append("В карточках отсутствует код для связи с 1С или стоит отметка «нет в 1С». Это не подтверждённые расхождения.")
            if len(unknown) < unverified:
                lines.append(f"Показано непроверенных устройств: {len(unknown)} из {unverified}.")
        if comp.get("truncated"):
            lines.extend(["", "Показана только часть позиций сверки; полный результат подтвердить нельзя."])
        lines.extend(["", "Сопоставление по номенклатуре и количеству; серийные номера не сравнивались."])
    if full_list:
        lines.extend(["", "| Инв. номер | Тип | Модель |", "|---|---|---|"])
        lines.extend(f"| {_cell(row.get('inv_no'))} | {_cell(row.get('type_name'))} | {_cell(row.get('model_name'))} |" for row in items)
        if data.get("truncated"):
            lines.append(f"Показано устройств: {len(items)} из {total}.")
    source = f"Источник: ITinvent / {_cell(candidates[0].get('database_id'))}; подключённый Склад 1С"
    as_of = (comp.get("meta") or {}).get("as_of")
    if as_of:
        try:
            source += "; данные на " + datetime.fromisoformat(str(as_of).replace("Z", "+00:00")).astimezone().strftime("%d.%m.%Y %H:%M")
        except ValueError:
            pass
    lines.extend(["", source + "."])
    return "\n".join(lines)
