"""Real chat HTTP/worker and the existing portal comparison service on isolated data.

Only model, SQL Server reads and 1C transport are replaced. No copied comparison
algorithm: quantities/highlight statuses are calculated by Warehouse1CService.
"""
import json
import asyncio
import queue
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from test_e2e_ai_draft_reliability import agent, call, PERMISSIONS
from test_ai_chat_runtime import _make_user
from backend.api import deps
from backend.ai_chat.tools import context as tool_context, itinvent, warehouse
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.appdb.db import app_session
from backend.appdb.models import AppAiBot, AppAiBotRun, AppUser
from sqlalchemy import select
from backend.services.warehouse_1c_service import Warehouse1CService

TOOLS = ["itinvent.employee.search", "itinvent.employee.list_equipment", "warehouse.balances.search"]
FIO = "Иванов Иван Иванович"


@pytest.fixture
def compare(agent, monkeypatch):
    permissions = [*PERMISSIONS, "database.read", "warehouse_1c.read"]
    with app_session(agent.url) as db:
        db.get(AppAiBot, "agent").enabled_tools_json = json.dumps(TOOLS)
        db.get(AppUser, 99).custom_permissions_json = json.dumps(permissions)
    agent.client.app.dependency_overrides[deps.get_current_user] = lambda: _make_user(permissions=permissions)
    monkeypatch.setattr(tool_context, "get_available_database_options", lambda: [{"id": "ITINVENT", "name": "ITinvent"}])
    monkeypatch.setattr(tool_context, "get_available_database_ids", lambda: {"ITINVENT", "FOREIGN"})
    # A local service instance keeps both its catalog/snapshot cache and lock per test.
    svc = Warehouse1CService(data_manager=SimpleNamespace(load_json=lambda _name, **kwargs: kwargs["default_content"]))
    monkeypatch.setattr(warehouse, "_warehouse_service", lambda: svc)
    calls = []
    rows = [
        {"OWNER_NO": 7, "INV_NO": "INV-1", "PART_NO": "PN-1", "MODEL_NAME": "Монитор", "SERIAL_NO": "SN-1"},
        {"OWNER_NO": 7, "INV_NO": "INV-2", "PART_NO": "PN-2", "MODEL_NAME": "Ноутбук", "SERIAL_NO": "SN-2"},
    ]
    owners = [{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": FIO},
              {"OWNER_NO": 8, "OWNER_DISPLAY_NAME": "Другой Пётр Петрович"}]
    count_rows = [{"owner_no": 7, "part_no": "PN-1", "item_count": 1},
                  {"owner_no": 7, "part_no": "PN-2", "item_count": 1}]
    catalog = [{"ref": "warehouse-7", "name": FIO}]
    balance = {"status": "ok", "truncated": False, "source": "live_1c",
               "as_of": datetime.now(timezone.utc).isoformat(), "items": [
                   {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1, "series_ref": "s1"},
                   {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1, "series_ref": "s2"},
                   {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-3", "qty_balance": 3},
               ]}

    def equipment(owner_no, db_id):
        assert owner_no == 7 and db_id == "ITINVENT"
        calls.append("equipment")
        return rows

    def employees(query, *, page, limit, db_id):
        assert db_id == "ITINVENT"
        return {"employees": [owners[0]], "total": 1}

    def read_counts(db_id):
        assert db_id == "ITINVENT"
        calls.append("counts")
        return count_rows

    def read_owners(db_id):
        assert db_id == "ITINVENT"
        return owners

    async def balances(**kwargs):
        calls.append("1c")
        assert kwargs["warehouse_refs"] == ["warehouse-7"]
        return balance

    monkeypatch.setattr(itinvent.queries, "get_equipment_by_owner", equipment)
    monkeypatch.setattr(itinvent.queries, "search_employees", employees)
    monkeypatch.setattr(itinvent.queries, "list_owners_compact", read_owners)
    monkeypatch.setattr(itinvent.queries, "get_owner_part_no_counts", read_counts)
    monkeypatch.setattr(svc, "_list_warehouse_catalog_entries", lambda: (catalog, {"truncated": False}))
    monkeypatch.setattr(svc, "get_balances_for_warehouses", balances)
    return SimpleNamespace(agent=agent, svc=svc, rows=rows, count_rows=count_rows, owners=owners, catalog=catalog,
                           balance=balance, calls=calls, permissions=permissions)


def request_comparison(compare, **args):
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True, **args)]},
        {"answer_markdown": "Результат сверки"},
    ])
    result = compare.agent.request(f"Сравни технику {FIO} в ITinvent и подключённом Складе 1С")
    return result


def comparison_payload(compare):
    # Worker model prompts include actual serialized results; extract the JSON array.
    text = compare.agent.prompts[-1]["user_prompt"]
    decoder = json.JSONDecoder()
    for pos, char in enumerate(text):
        if char == "[":
            try:
                value, _ = decoder.raw_decode(text[pos:])
            except ValueError:
                continue
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and item.get("tool_id") == "itinvent.employee.list_equipment":
                        return item
    # A completed comparison can be presented without another model request.
    with app_session(compare.agent.url) as db:
        run = db.execute(select(AppAiBotRun).order_by(AppAiBotRun.created_at.desc())).scalars().first()
        for trace in json.loads(run.result_json).get("tool_traces", []):
            if trace.get("comparison_snapshot"):
                return {"tool_id": trace["tool_id"], "ok": trace["status"] == "ok", "data": trace["comparison_snapshot"]}
    raise AssertionError("Worker did not preserve the actual comparison data")


def test_partial_answer_names_1c_item_counts_devices_and_keeps_unverified_separate(compare):
    compare.rows[:] = [
        {"INV_NO": "100665", "PART_NO": "PC", "MODEL_NAME": "Lenovo M720q"},
        {"INV_NO": "101647", "PART_NO": "MON", "MODEL_NAME": "Philips 273V7"},
        {"INV_NO": "101648", "PART_NO": "MON", "MODEL_NAME": "Philips 273V7"},
        {"INV_NO": "101667", "PART_NO": "DELL", "MODEL_NAME": "DELL E2420HS"},
        {"INV_NO": "101643", "PART_NO": None, "MODEL_NAME": "euroset 802"},
        {"INV_NO": "101845", "PART_NO": None, "MODEL_NAME": "АРС BE850G2-RS"},
    ]
    compare.count_rows[:] = [
        {"owner_no": 7, "part_no": "PC", "item_count": 1},
        {"owner_no": 7, "part_no": "MON", "item_count": 2},
        {"owner_no": 7, "part_no": "DELL", "item_count": 1},
        {"owner_no": 7, "part_no": "", "item_count": 2},
    ]
    compare.balance["items"] = [
        {"warehouse_ref": "warehouse-7", "nomenclature_code": code, "qty_balance": qty,
         "nomenclature_name": name}
        for code, qty, name in [("PC", 1, "Lenovo M720q"), ("MON", 2, "Philips 273V7"),
                                ("DELL", 1, "DELL E2420HS"),
                                ("ЦБ-0153060", 1, "Отвертка электрическая Xiaomi Electric Precision Screwdriver")]
    ]
    result = request_comparison(compare)
    answer = result["answer_markdown"]
    assert "4 из 6" in answer and "частичн" in answer.casefold()
    assert "Xiaomi Electric Precision Screwdriver" in answer
    assert "101643" in answer and "101845" in answer and "не проверены" in answer.casefold()
    assert "код" in answer.casefold()
    assert "серийные номера не сравнивались" in answer.casefold()
    assert not any(term in answer for term in ("PART_NO", "complete", "matches_all", "OWNER_NO", "warehouse_ref"))
    assert "100665" not in answer and "101647" not in answer
    assert len(compare.agent.prompts) == 1, "Completed comparison must not spend a follow-up LLM call"
    snapshot = result["tool_traces"][0]["comparison_snapshot"]
    assert snapshot["comparison_1c"]["part_quantities"]["mon"]["hub_count"] == 2
    assert snapshot["comparison_1c"]["part_names"]["цб-0153060"].startswith("Отвертка")
    assert "serial_no" not in answer


def test_unknown_comparison_answer_does_not_report_zero_or_matches(compare):
    compare.balance["truncated"] = True
    result = request_comparison(compare)
    answer = result["answer_markdown"].casefold()
    assert "подтвердить не удалось" in answer
    assert "совпало" not in answer and "расхождения не найдены" not in answer
    assert len(compare.agent.prompts) == 1
    assert result["tool_traces"][0]["comparison_snapshot"]["comparison_1c"]["counts"]["match"] is None


def test_matching_inventory_is_only_listed_when_user_asks_for_it(compare):
    compare.balance["items"] = [
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1},
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-2", "qty_balance": 1},
    ]
    first = request_comparison(compare)["answer_markdown"]
    assert "совпадают" in first and "INV-1" not in first
    compare.agent.steps.clear()
    compare.agent.steps.append({"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True)]})
    result = compare.agent.request("Сравни технику сотрудника с 1С и покажи полный список устройств")
    assert "INV-1" in result["answer_markdown"] and "INV-2" in result["answer_markdown"]


def test_finished_answer_is_not_regenerated_when_cumulative_budget_is_exhausted(compare, monkeypatch):
    from backend.ai_chat import service as ai_module
    replies = [{"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7)]},
               {"answer_markdown": "Найдено два устройства."}]
    calls = []
    def complete(**kwargs):
        calls.append(kwargs)
        assert replies, "The final answer was already available"
        return replies.pop(0), {"prompt_tokens": 16000, "completion_tokens": 10}
    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    result = compare.agent.request("Покажи технику сотрудника")
    assert result["answer_markdown"] == "Найдено два устройства."
    assert len(calls) == 2


@pytest.mark.parametrize("catalog_failure", [False, True])
def test_missing_balance_name_uses_existing_catalog_without_losing_quantities(compare, monkeypatch, catalog_failure):
    lookups = []
    def lookup(codes):
        lookups.append(codes)
        if catalog_failure:
            raise RuntimeError("private catalog connection details")
        return {"pn-3": {"name": "Электрическая отвертка Xiaomi", "code": "PN-3"}}
    monkeypatch.setattr(compare.svc, "lookup_nomenclature_codes", lookup)
    result = request_comparison(compare)
    answer = result["answer_markdown"]
    assert len(lookups) == 1 and "pn-3" in lookups[0]
    assert "3" in answer and "private catalog" not in json.dumps(result)
    if not catalog_failure:
        assert "Электрическая отвертка Xiaomi" in answer
    else:
        assert "Позиция 1С" in answer and "PN-3" in answer
    assert result["tool_traces"][0]["comparison_snapshot"]["comparison_1c"]["counts"]["only_1c"] == 1


def test_not_in_1c_marker_does_not_become_a_full_match(compare):
    compare.balance["items"] = [
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1},
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-2", "qty_balance": 1},
    ]
    compare.rows.append({"INV_NO": "EXCLUDED", "PART_NO": "нет в 1С", "MODEL_NAME": "ИБП"})
    compare.count_rows.append({"owner_no": 7, "part_no": "нет в 1С", "item_count": 1})
    result = request_comparison(compare)
    assert "2 из 3" in result["answer_markdown"] and "EXCLUDED" in result["answer_markdown"]
    assert "частичн" in result["answer_markdown"]
    assert result["tool_traces"][0]["comparison_snapshot"]["comparison_1c"]["matches_all"] is None


def test_truncated_positions_prioritize_differences_and_keep_device_total(compare):
    # Two matching codes and one discrepancy; no unlinked device.
    compare.balance["items"] = [
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1},
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-2", "qty_balance": 1},
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-3", "qty_balance": 3,
         "nomenclature_name": "Отвертка"},
    ]
    result = request_comparison(compare, limit=1)
    assert "Отвертка" in result["answer_markdown"] and "2 из 2" in result["answer_markdown"]
    assert "часть позиций" in result["answer_markdown"]
    snapshot = result["tool_traces"][0]["comparison_snapshot"]
    assert snapshot["truncated"] and snapshot["comparison_1c"]["truncated"]
    assert snapshot["comparison_1c"]["matches_all"] is None


def test_comparison_audit_keeps_source_quantities_and_omits_network_and_email(compare):
    compare.rows[0].update({"IP_ADDRESS": "private-ip", "EMPLOYEE_EMAIL": "private-email", "DESCRIPTION": "private-notes"})
    result = request_comparison(compare)
    persisted = comparison_payload(compare)["data"]
    evidence = json.dumps(persisted)
    assert all(value not in evidence for value in ("private-ip", "private-email", "private-notes"))
    assert persisted["comparison_1c"]["meta"]["as_of"] == compare.balance["as_of"]
    assert persisted["comparison_1c"]["part_quantities"]["pn-1"]["qty_1c"] == 2
    assert persisted["items"][0]["inv_no"] == "INV-1"
    history = compare.agent.client.get("/api/v1/chat/conversations/agent-conv/messages")
    assert history.status_code == 200
    assert result["answer_markdown"] in [item["body"] for item in history.json()["items"]]


def test_names_from_1c_cannot_inject_html_or_break_discrepancy_table(compare):
    compare.balance["items"][-1]["nomenclature_name"] = '<img src=x onerror=alert(1)> | Инструкция\nстрока'
    result = request_comparison(compare)
    answer = result["answer_markdown"]
    assert "<img" not in answer and "&lt;img" in answer
    assert "\\| Инструкция строка" in answer


def test_budget_exhaustion_still_finishes_a_blank_model_answer(compare, monkeypatch):
    from backend.ai_chat import service as ai_module
    replies = [{"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7)]},
               {"answer_markdown": ""}, {"answer_markdown": "Два устройства найдены."}]
    calls = []
    def complete(**kwargs):
        calls.append(kwargs)
        return replies.pop(0), {"prompt_tokens": 16000, "completion_tokens": 10}
    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    result = compare.agent.request("Покажи технику сотрудника")
    assert result.get("answer_markdown") and len(calls) == 3


def test_mixed_comparison_request_keeps_llm_followup(compare):
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True)]},
        {"answer_markdown": "Для отправки письма нужно уточнить получателя."},
    ])
    result = compare.agent.request("Сравни технику сотрудника с 1С, а затем отправь письмо о расхождениях")
    assert len(compare.agent.prompts) == 2
    assert "уточнить получателя" in result["answer_markdown"]


def test_followup_comparison_does_not_require_repeating_1c_in_the_text(compare):
    request_comparison(compare)
    compare.agent.steps.clear()
    before = len(compare.agent.prompts)
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True)]},
        {"answer_markdown": "complete=true; все совпадает"},
    ])
    result = compare.agent.request("Повтори сверку")
    assert len(compare.agent.prompts) - before == 1
    assert "complete" not in result["answer_markdown"] and "все совпадает" not in result["answer_markdown"]
    assert "Разное количество" in result["answer_markdown"]


def test_search_then_comparison_reuses_portal_highlighting_and_selected_database(compare):
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.search", query=FIO)]},
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True)]},
        {"answer_markdown": "Есть расхождения по количеству"},
    ])
    result = compare.agent.request(f"Сравни технику {FIO} в ITinvent и 1С")
    data = comparison_payload(compare)["data"]
    actual = data["comparison_1c"]
    assert actual["complete"] and actual["matches_all"] is False
    assert actual["counts"]["diff"] == 1 and actual["counts"]["only_hub"] == 1 and actual["counts"]["only_1c"] == 1
    assert actual["part_quantities"]["pn-1"] == {"hub_count": 1, "qty_1c": 2}
    assert actual["part_status"]["pn-2"] == "only_hub"
    assert actual["part_status"]["pn-3"] == "only_1c"
    assert actual["part_quantities"]["pn-3"] == {"hub_count": 0, "qty_1c": 3}
    assert data["items"][0]["serial_no"] == "SN-1"
    assert [r["tool_id"] for r in result["tool_traces"]] == TOOLS[:2]
    assert compare.calls.count("1c") == 1
    assert actual["meta"]["source"] == "live_1c"
    assert actual["meta"]["as_of"] == compare.balance["as_of"]


@pytest.mark.parametrize("problem", ["truncated", "stale", "error_status", "equipment_changed"])
def test_incomplete_comparison_never_becomes_zero_or_equality(compare, problem):
    if problem == "truncated":
        compare.balance["truncated"] = True
    elif problem == "stale":
        compare.balance["as_of"] = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    elif problem == "error_status":
        compare.balance["status"] = "error"
    else:
        compare.rows.append({"PART_NO": "PN-1", "INV_NO": "NEW"})
    request_comparison(compare)
    actual = comparison_payload(compare)["data"]["comparison_1c"]
    assert not actual["complete"] and actual["matches_all"] is None
    assert actual["part_status"] == {} and actual["part_quantities"] == {}
    assert all(actual["counts"][key] is None for key in ("match", "diff", "only_hub", "only_1c"))


@pytest.mark.parametrize("blocked", ["permission", "bot_setting"])
def test_comparison_respects_warehouse_access_without_breaking_itinvent_list(compare, blocked):
    with app_session(compare.agent.url) as db:
        if blocked == "permission":
            compare.permissions.remove("warehouse_1c.read")
            db.get(AppUser, 99).custom_permissions_json = json.dumps(compare.permissions)
        else:
            db.get(AppAiBot, "agent").enabled_tools_json = json.dumps(TOOLS[:2])
    request_comparison(compare)
    data = comparison_payload(compare)["data"]
    assert data["total"] == 2 and data["items"]
    assert data["comparison_1c"]["status"] == "forbidden"
    assert data["comparison_1c"]["matches_all"] is None
    assert "1c" not in compare.calls and "counts" not in compare.calls


def test_ambiguous_warehouse_is_not_automatically_selected(compare):
    # One person may own a few warehouses (their balances are summed), but a candidate list that
    # reaches the match limit may be truncated and must never be picked automatically.
    from backend.services.warehouse_1c_service import EMPLOYEE_WAREHOUSE_MATCH_LIMIT

    compare.catalog.extend(
        {"ref": f"warehouse-duplicate-{n}", "name": FIO} for n in range(EMPLOYEE_WAREHOUSE_MATCH_LIMIT)
    )
    request_comparison(compare)
    actual = comparison_payload(compare)["data"]["comparison_1c"]
    assert actual["status"] == "ambiguous" and actual["matches_all"] is None
    assert not actual["complete"] and "1c" not in compare.calls


def test_ordinary_equipment_request_does_not_trigger_comparison(compare):
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7)]},
        {"answer_markdown": "Найдено две единицы"},
    ])
    compare.agent.request("Покажи технику сотрудника")
    data = comparison_payload(compare)["data"]
    assert data["total"] == 2 and "comparison_1c" not in data
    assert "1c" not in compare.calls and "counts" not in compare.calls


def test_comparison_refuses_other_database_before_source_reads(compare):
    result = request_comparison(compare, database_id="FOREIGN")
    assert result["tool_traces"][0]["status"] == "error"
    assert compare.calls == []


@pytest.mark.parametrize("unlinked", [False, True])
def test_full_match_is_confirmed_only_when_every_item_has_a_usable_code(compare, unlinked):
    compare.balance["items"] = [
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-1", "qty_balance": 1},
        {"warehouse_ref": "warehouse-7", "nomenclature_code": "PN-2", "qty_balance": 1},
    ]
    if unlinked:
        compare.rows.append({"INV_NO": "UNLINKED", "PART_NO": ""})
        compare.count_rows.append({"owner_no": 7, "part_no": "", "item_count": 1})
    request_comparison(compare)
    actual = comparison_payload(compare)["data"]["comparison_1c"]
    assert actual["complete"] and actual["counts"]["match"] == 2
    assert actual["matches_all"] is (None if unlinked else True)
    assert actual["counts"]["no_part"] == int(unlinked)


def test_1c_timeout_preserves_itinvent_data_and_does_not_expose_error_details(compare, monkeypatch):
    async def timeout(**kwargs):
        raise TimeoutError("private transport details")
    monkeypatch.setattr(compare.svc, "get_balances_for_warehouses", timeout)
    request_comparison(compare)
    payload = comparison_payload(compare)
    assert payload["ok"] and payload["data"]["total"] == 2
    actual = payload["data"]["comparison_1c"]
    assert actual["status"] == "error" and actual["matches_all"] is None
    assert "private transport details" not in json.dumps(payload)


def test_invalid_quantity_in_1c_only_row_does_not_become_a_confirmed_difference(compare):
    compare.balance["items"][-1]["qty_balance"] = float("nan")
    request_comparison(compare)
    actual = comparison_payload(compare)["data"]["comparison_1c"]
    assert not actual["complete"] and actual["matches_all"] is None
    assert actual["counts"]["only_1c"] is None and actual["part_quantities"] == {}


@pytest.mark.parametrize("quantity", ["не число", -1, None, True, float("nan"), float("inf"), "Infinity", "1e309"])
def test_invalid_source_quantity_cannot_be_hidden_by_series_aggregation(compare, quantity):
    compare.balance["items"][0]["qty_balance"] = quantity
    result = request_comparison(compare)
    comp = comparison_payload(compare)["data"]["comparison_1c"]
    assert not comp["complete"] and comp["matches_all"] is None
    assert comp["part_quantities"] == {} and comp["part_status"] == {}
    assert comp["reason_code"] == "invalid_quantity"
    assert all(comp["counts"][key] is None for key in ("match", "diff", "only_hub", "only_1c"))
    assert "некорректное количество" in result["answer_markdown"].casefold()
    assert "совпало" not in result["answer_markdown"].casefold()


def test_overflow_when_aggregating_valid_series_does_not_confirm_comparison(compare):
    for row in compare.balance["items"][:2]:
        row["qty_balance"] = 1e308
    result = request_comparison(compare)
    comp = comparison_payload(compare)["data"]["comparison_1c"]
    assert not comp["complete"] and comp["part_quantities"] == {}
    assert comp["reason_code"] == "invalid_quantity"
    assert "inf" not in result["answer_markdown"].casefold()


@pytest.mark.parametrize("part_no", ["", "нет в 1С"])
def test_all_unlinked_equipment_explains_known_reason_with_fresh_empty_1c(compare, part_no):
    for row in compare.rows:
        row["PART_NO"] = part_no
    compare.count_rows[:] = [{"owner_no": 7, "part_no": part_no, "item_count": 2}]
    compare.balance["items"] = []
    result = request_comparison(compare)
    comp = comparison_payload(compare)["data"]["comparison_1c"]
    assert comp["complete"] and comp["matches_all"] is None and not comp["coverage_complete"]
    answer = result["answer_markdown"].casefold()
    assert "код" in answer and "inv-1" in answer and "inv-2" in answer
    assert "устарели" not in answer and "все позиции совпадают" not in answer


def test_empty_itinvent_reports_1c_units_and_positions_without_zero_of_zero(compare):
    compare.rows.clear()
    compare.count_rows.clear()
    result = request_comparison(compare)
    answer = result["answer_markdown"]
    assert "В ITinvent устройств: 0" in answer
    assert "В 1С: 5 ед. на 2 позициях" in answer
    assert "0 из 0" not in answer and "Не сопоставлено" in answer
    assert comparison_payload(compare)["data"]["comparison_1c"]["matches_all"] is False


@pytest.mark.parametrize("failure", ["queue_full", "queue_timeout", "unavailable", "worker_lost", "timeout", "circuit_open", "worker_startup_failed"])
def test_comparison_keeps_safe_bridge_reason_and_recovers_on_next_request(compare, monkeypatch, caplog, failure):
    from backend.services.warehouse_1c_process_bridge import (
        Warehouse1CProcessBridgeBusy, Warehouse1CProcessBridgeUnavailable,
        Warehouse1CProcessBridgeTimeout, _Warehouse1CProcessBridgeWorkerLost,
    )
    from backend.services.warehouse_1c_service import Warehouse1CService

    error_type = {
        "queue_full": Warehouse1CProcessBridgeBusy,
        "queue_timeout": Warehouse1CProcessBridgeBusy,
        "unavailable": Warehouse1CProcessBridgeUnavailable,
        "worker_lost": _Warehouse1CProcessBridgeWorkerLost,
        "timeout": Warehouse1CProcessBridgeTimeout,
        "circuit_open": Warehouse1CProcessBridgeUnavailable,
        "worker_startup_failed": Warehouse1CProcessBridgeUnavailable,
    }[failure]
    error = error_type("private bridge connection details")
    error.reason_code = failure
    calls = []

    def invoke(operation, payload, *, timeout):
        calls.append(operation)
        assert operation == "balances_by_warehouses"
        if len(calls) == 1:
            raise error
        return compare.balance

    compare.svc._process_bridge_enabled = True
    compare.svc._process_bridge = SimpleNamespace(call=invoke)
    # balances_by_warehouses is a heavy operation: it goes through the heavy bridge when configured.
    compare.svc._heavy_process_bridge = SimpleNamespace(call=invoke)
    monkeypatch.setattr(compare.svc, "get_balances_for_warehouses",
                        Warehouse1CService.get_balances_for_warehouses.__get__(compare.svc))
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.search", query=FIO)]},
        {"tool_calls": [call("itinvent.employee.list_equipment", owner_no=7, compare_1c=True)]},
    ])
    first = compare.agent.request(f"Сравни технику {FIO} в ITinvent и 1С")
    trace = first["tool_traces"][-1]
    comp = trace["comparison_snapshot"]["comparison_1c"]
    assert trace["status"] == "ok" and trace["comparison_status"] == "error"
    assert trace["comparison_error_code"] == failure and comp["reason_code"] == failure
    assert comp["matches_all"] is None and trace["comparison_snapshot"]["total"] == 2
    assert FIO in first["answer_markdown"] and "подтвердить не удалось" in first["answer_markdown"]
    assert "private bridge" not in json.dumps(first) and "private bridge" not in caplog.text
    assert any(f"reason_code={failure}" in record.message and "run_id=" in record.message
               for record in caplog.records)
    compare.agent.steps.clear()
    # After a bridge failure the service backs off for a minute; simulate the window elapsing.
    compare.svc._employee_compare_failures.clear()
    second = request_comparison(compare)
    assert second["tool_traces"][0]["comparison_snapshot"]["comparison_1c"]["complete"]
    assert len(calls) == 2


@pytest.mark.parametrize("found", [False, True])
def test_unresolved_employee_answer_uses_business_fields_and_stays_short(compare, monkeypatch, found):
    employees = [
        {"owner_no": 7, "name": FIO, "department": "Отдел А"},
        {"owner_no": 8, "name": FIO, "department": "Отдел Б"},
    ] if found else []
    monkeypatch.setattr(itinvent.queries, "search_employees", lambda *args, **kwargs: {
        "employees": employees, "total": len(employees)})
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.search", query=FIO)]},
        {"answer_markdown": "## Итог\nOwner No 7, owner_no=8\n## Детали\nУточните сотрудника."},
    ])
    result = compare.agent.request(f"Сравни технику {FIO} в ITinvent и 1С")
    answer = result["answer_markdown"]
    assert "owner" not in answer.casefold() and len(answer) < 550
    assert "##" not in answer and FIO in answer
    assert "1c" not in compare.calls and "counts" not in compare.calls
    if found:
        assert "Отдел А" in answer and "Отдел Б" in answer and "отдел" in answer.casefold()
    else:
        assert "не найден" in answer.casefold() and "ФИО" in answer


def test_employee_clarification_does_not_replace_mixed_task_answer(compare, monkeypatch):
    monkeypatch.setattr(itinvent.queries, "search_employees", lambda *args, **kwargs: {"employees": [], "total": 0})
    compare.agent.steps.extend([
        {"tool_calls": [call("itinvent.employee.search", query=FIO)]},
        {"answer_markdown": "Уточните сотрудника и получателя письма."},
    ])
    result = compare.agent.request(f"Сравни технику {FIO} и затем отправь письмо")
    assert result["answer_markdown"] == "Уточните сотрудника и получателя письма."


def test_parallel_worker_threads_share_snapshot_without_cross_loop_lock_hang(compare, monkeypatch):
    """Critical race boundary: workers use separate event loops in different threads."""
    first_in_1c, second_read, release = threading.Event(), threading.Event(), threading.Event()
    output = queue.Queue()
    original = compare.svc.get_balances_for_warehouses
    equipment = itinvent.queries.get_equipment_by_owner
    reads = 0
    def concurrent_equipment(*args, **kwargs):
        nonlocal reads
        reads += 1
        if reads == 2:
            second_read.set()
        return equipment(*args, **kwargs)
    async def delayed_balance(**kwargs):
        first_in_1c.set()
        assert await asyncio.to_thread(release.wait, 4)
        return await original(**kwargs)
    monkeypatch.setattr(itinvent.queries, "get_equipment_by_owner", concurrent_equipment)
    monkeypatch.setattr(compare.svc, "get_balances_for_warehouses", delayed_balance)
    def invoke(run_id):
        ctx = tool_context.AiToolExecutionContext(bot_id="agent", bot_title="Assistant", conversation_id=run_id,
            run_id=run_id, user_id=99, user_payload={"id": 99, "role": "viewer", "use_custom_permissions": True,
                "custom_permissions": compare.permissions}, effective_database_id="ITINVENT",
            enabled_tools=TOOLS, tool_settings={"multi_db_mode": "single", "allowed_databases": []})
        try:
            result, audit = ai_tool_registry.execute(tool_id="itinvent.employee.list_equipment",
                raw_args={"owner_no": 7, "compare_1c": True}, context=ctx)
            output.put((result, audit))
        except Exception as exc:
            output.put(exc)
    threads = [threading.Thread(target=invoke, args=(f"parallel-{i}",), daemon=True) for i in range(2)]
    try:
        threads[0].start()
        assert first_in_1c.wait(4)
        threads[1].start()
        assert second_read.wait(4)
    finally:
        release.set()
    results = [output.get(timeout=6) for _ in threads]
    for item in results:
        assert not isinstance(item, Exception), item
        result, audit = item
        assert audit["status"] == "ok" and result.data["comparison_1c"]["complete"]
        assert result.data["comparison_1c"]["part_quantities"]["pn-1"]["qty_1c"] == 2
    for thread in threads:
        thread.join(timeout=1)
        assert not thread.is_alive()
    assert compare.calls.count("1c") == 1
