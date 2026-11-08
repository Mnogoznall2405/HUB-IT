"""Серверная выгрузка оборудования в Excel: строки читаются постранично на сервере и не проходят через контекст модели."""

from __future__ import annotations

import conftest  # noqa: F401

import importlib
import json
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _context(context_module, **overrides):
    return context_module.AiToolExecutionContext(
        bot_id="bot-1", bot_title="Bot", conversation_id="conv-1", run_id="run-1", user_id=1,
        user_payload={"role": "admin"}, effective_database_id="ITINVENT",
        enabled_tools=["itinvent.equipment.export"], tool_settings={}, **overrides,
    )


def test_export_reads_all_pages_on_server_and_keeps_rows_out_of_model_prompt(monkeypatch):
    it_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    context_module = importlib.import_module("backend.ai_chat.tools.context")
    service_module = importlib.import_module("backend.ai_chat.service")

    total = 600
    pages: list[int] = []

    def fake_search(search_term, page=1, limit=50, db_id=None):
        pages.append(int(page))
        start = (int(page) - 1) * int(limit)
        rows = [
            {"inv_no": f"INV-{n}", "serial_no": f"SN-{n}", "type_name": "Телефонный аппарат",
             "model_name": "KX-TS2350", "vendor_name": "Panasonic", "status_name": "Работает",
             "branch_name": "Первомайская 21", "location_name": "Каб. 5", "employee_name": f"Иванов {n}"}
            for n in range(start, min(start + int(limit), total))
        ]
        return {"equipment": rows, "total": total}

    monkeypatch.setattr(it_module.queries, "search_equipment_universal", fake_search)
    tool = it_module.EquipmentExportTool()
    args = tool.validate_args({"query": "Panasonic", "columns": ["model", "inv_no", "serial_no", "owner", "status"]})

    payload = tool.execute(context=_context(context_module), args=args).to_payload()

    assert payload["ok"] is True
    assert pages == [1, 2, 3]
    assert payload["data"]["rows_exported"] == total
    sheet = payload["data"]["files"][0]["sheets"][0]
    assert sheet["rows"][0] == ["Модель", "Инв. номер", "Серийный номер", "Сотрудник", "Статус"]
    assert len(sheet["rows"]) == total + 1
    assert sheet["rows"][-1][1] == f"INV-{total - 1}"

    # Файл уходит в чат целиком, а модель получает только имя и размер.
    extracted = service_module._extract_generated_file_specs_from_tool_results([payload])
    assert len(extracted) == 1 and len(extracted[0]["sheets"][0]["rows"]) == total + 1
    prompt_text = service_module._format_tool_results_for_prompt([payload])
    assert "INV-599" not in prompt_text and "Иванов" not in prompt_text
    assert json.loads(prompt_text)[0]["data"]["files"][0]["attached_to_chat"] is True


def test_export_refuses_when_nothing_found_or_files_disabled(monkeypatch):
    it_module = importlib.import_module("backend.ai_chat.tools.itinvent")
    context_module = importlib.import_module("backend.ai_chat.tools.context")
    monkeypatch.setattr(it_module.queries, "search_equipment_universal", lambda *a, **k: {"equipment": [], "total": 0})
    tool = it_module.EquipmentExportTool()
    args = tool.validate_args({"query": "несуществующая модель"})

    empty = tool.execute(context=_context(context_module), args=args).to_payload()
    disabled = tool.execute(context=_context(context_module, allow_generated_artifacts=False), args=args).to_payload()

    assert empty["ok"] is False and "not created" in empty["error"]
    assert disabled["ok"] is False and "disabled" in disabled["error"]
