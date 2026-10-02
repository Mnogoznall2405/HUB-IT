"""Stage 3 ai_chat tools: unsigned acts, 1C warehouse, MFU low toner, morning IT digest."""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)
os.environ.setdefault("APP_ENV", "development")

service_module = importlib.import_module("backend.ai_chat.service")
context_module = importlib.import_module("backend.ai_chat.tools.context")
it_reports = importlib.import_module("backend.ai_chat.tools.it_reports")
warehouse = importlib.import_module("backend.ai_chat.tools.warehouse")
mfu = importlib.import_module("backend.ai_chat.tools.mfu")
mfu_monitor_module = importlib.import_module("backend.services.mfu_monitor_service")
reminder_module = importlib.import_module("backend.services.transfer_act_reminder_service")
user_service_module = importlib.import_module("backend.services.user_service")
permissions_module = importlib.import_module("backend.ai_chat.tool_permissions")
it_digest = importlib.import_module("backend.ai_chat.it_digest")
registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry


def _ctx(user_id: int = 7, role: str = "viewer"):
    return context_module.AiToolExecutionContext(
        bot_id="bot",
        bot_title="Ассистент",
        conversation_id="conv-1",
        run_id="run-1",
        user_id=user_id,
        user_payload={"id": user_id, "role": role, "username": "ivanov_ii", "full_name": "Иванов Иван Иванович"},
        effective_database_id="ITINVENT",
        enabled_tools=[],
        tool_settings={"multi_db_mode": "single", "allowed_databases": []},
    )


# ---------- unsigned transfer acts ----------


def test_list_open_reminders_reads_pending_groups(tmp_path, monkeypatch):
    store = SimpleNamespace(db_path=str(tmp_path / "store.sqlite3"), data_dir=str(tmp_path))
    monkeypatch.setattr(reminder_module, "get_local_store", lambda: store)
    monkeypatch.setattr(reminder_module, "is_app_database_configured", lambda: False)
    service = reminder_module.TransferActReminderService()
    now = datetime.now(timezone.utc).isoformat()
    with service._connect() as conn:
        for rid, status, assignee, db_id in (
            ("r1", "open", 7, "ITINVENT"),
            ("r2", "open", 8, "ITINVENT"),
            ("r3", "completed", 7, "ITINVENT"),
            ("r4", "open", 7, "MSK"),
        ):
            conn.execute(
                f"INSERT INTO {service._REMINDERS_TABLE} (reminder_id, task_id, db_id, assignee_user_id, "
                "controller_user_id, created_by_user_id, new_employee_name, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?)",
                (rid, f"t-{rid}", db_id, assignee, f"Сотрудник {rid}", status, now, now),
            )
        conn.execute(
            f"INSERT INTO {service._GROUPS_TABLE} (id, reminder_id, old_employee_name, inv_nos_json, equipment_count) "
            "VALUES ('g1', 'r1', 'Петров', '[\"100\", \"101\"]', 2)"
        )
        conn.execute(
            f"INSERT INTO {service._GROUPS_TABLE} (id, reminder_id, old_employee_name, inv_nos_json, equipment_count, completed_at) "
            "VALUES ('g2', 'r1', 'Сидоров', '[\"102\"]', 1, ?)",
            (now,),
        )
        conn.commit()

    items = service.list_open_reminders(db_id="ITINVENT")
    assert [item["reminder_id"] for item in items] == ["r1", "r2"]
    assert [group["old_employee_name"] for group in items[0]["pending_groups"]] == ["Петров"]
    assert [item["reminder_id"] for item in service.list_open_reminders(db_id="ITINVENT", assignee_user_id=7)] == ["r1"]


def test_acts_pending_tool_filters_and_names(monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    fresh = datetime.now(timezone.utc).isoformat()
    calls = {}

    def fake_list(**kw):
        calls.update(kw)
        return [
            {"new_employee_name": "Кузнецов", "assignee_user_id": 5, "created_at": old,
             "pending_groups": [{"old_employee_name": "Петров", "inv_nos": ["100", "101"], "equipment_count": 2}]},
            {"new_employee_name": "Смирнов", "assignee_user_id": 5, "created_at": fresh,
             "pending_groups": [{"old_employee_name": "Орлов", "inv_nos": ["200"], "equipment_count": 1}]},
            {"new_employee_name": "Закрыт", "assignee_user_id": 5, "created_at": old, "pending_groups": []},
        ]

    monkeypatch.setattr(reminder_module.transfer_act_reminder_service, "list_open_reminders", fake_list)
    monkeypatch.setattr(user_service_module.user_service, "get_by_id", lambda uid: {"full_name": "Админ ИТ"})
    tool = it_reports.ActsPendingTool()

    result = tool.execute(context=_ctx(), args=it_reports.ActsPendingArgs(older_than_days=3))
    assert result.ok is True
    assert calls["db_id"] == "ITINVENT" and calls["assignee_user_id"] is None
    assert [row["new_employee"] for row in result.data["items"]] == ["Кузнецов"]
    row = result.data["items"][0]
    assert row["responsible"] == "Админ ИТ" and row["days_open"] >= 9
    assert row["inv_nos"] == ["100", "101"] and row["previous_owners"] == ["Петров"]

    tool.execute(context=_ctx(user_id=42), args=it_reports.ActsPendingArgs(mine_only=True))
    assert calls["assignee_user_id"] == 42


# ---------- 1C warehouse ----------


class _FakeWarehouse:
    def __init__(self):
        self.calls = []

    async def get_balances(self, **kw):
        self.calls.append(("balances", kw))
        return {
            "items": [
                {"nomenclature_name": "Картридж CF259A", "nomenclature_code": "001", "warehouse_name": "Склад ИТ", "qty_balance": 3},
                {"nomenclature_name": "Картридж CF259A", "nomenclature_code": "001", "warehouse_name": "Склад Тюмень", "qty_balance": 7},
            ]
        }

    async def get_it_requests(self, **kw):
        self.calls.append(("requests", kw))
        return {
            "items": [
                {"request_ref": "ref-1", "request_number": "12-ИТ", "initiator_name": "Иванов  Иван Иванович",
                 "responsible_name": "Снабженец", "overdue": True, "stage": {"label": "Закупка"},
                 "nomenclature_preview": [{"name": "Ноутбук", "quantity": 1, "unit": "шт"}]},
                {"request_ref": "ref-2", "request_number": "13-ИТ", "initiator_name": "Иванова Анна",
                 "stage": {"key": "done"}},
            ],
            "total": 2,
            "next_cursor": "c2",
        }

    async def get_it_request_detail(self, request_ref):
        return {"request_ref": request_ref, "request_number": "12-ИТ",
                "positions": [{"nomenclature_name": "Ноутбук", "qty_requested": 1, "stage": {"label": "Закупка"}}]}


def test_warehouse_balances_filter_and_sort(monkeypatch):
    fake = _FakeWarehouse()
    monkeypatch.setattr(warehouse, "_warehouse_service", lambda: fake)
    result = warehouse.BalancesSearchTool().execute(context=_ctx(), args=warehouse.BalancesSearchArgs(query="CF259A"))
    assert result.ok is True
    assert [row["warehouse"] for row in result.data["items"]] == ["Склад Тюмень", "Склад ИТ"]
    assert result.data["total_qty"] == 10
    narrowed = warehouse.BalancesSearchTool().execute(
        context=_ctx(), args=warehouse.BalancesSearchArgs(query="CF259A", warehouse="ит")
    )
    assert narrowed.data["total"] == 1


def test_warehouse_it_requests_and_detail(monkeypatch):
    fake = _FakeWarehouse()
    monkeypatch.setattr(warehouse, "_warehouse_service", lambda: fake)
    result = warehouse.ItRequestsSearchTool().execute(
        context=_ctx(), args=warehouse.ItRequestsSearchArgs(overdue_only=True)
    )
    assert fake.calls[-1][1]["overdue"] is True
    assert result.data["has_more"] is True
    assert result.data["items"][0]["items_preview"] == "Ноутбук × 1 шт"
    detail = warehouse.ItRequestGetTool().execute(context=_ctx(), args=warehouse.ItRequestGetArgs(request_ref="ref-1abcdef"))
    assert detail.data["positions"][0] == {"item": "Ноутбук", "qty": 1, "stage": "Закупка", "overdue": False}


def test_my_it_requests_exact_initiator(monkeypatch):
    fake = _FakeWarehouse()
    monkeypatch.setattr(warehouse, "_warehouse_service", lambda: fake)
    self_identity = importlib.import_module("backend.ai_chat.self_identity")
    monkeypatch.setattr(
        self_identity, "resolve_self_identity", lambda context: SimpleNamespace(full_name="Иванов Иван Иванович")
    )
    result = warehouse.MyItRequestsTool().execute(context=_ctx(), args=warehouse._NoArgs())
    assert [item["number"] for item in result.data["items"]] == ["12-ИТ"]
    assert "responsible" not in result.data["items"][0]


def test_warehouse_error_is_reported(monkeypatch):
    class Broken:
        async def get_balances(self, **kw):
            raise RuntimeError("COM timeout")

    monkeypatch.setattr(warehouse, "_warehouse_service", lambda: Broken())
    result = warehouse.BalancesSearchTool().execute(context=_ctx(), args=warehouse.BalancesSearchArgs(query="CF259A"))
    assert result.ok is False and "Склад 1С не ответил" in result.error


def test_run_coroutine_inside_running_loop():
    async def value():
        return 5

    async def outer():
        return warehouse.run_coroutine(value())

    assert asyncio.run(outer()) == 5


# ---------- MFU low toner ----------


def test_mfu_low_toner_uses_persisted_snmp(monkeypatch):
    rows = [
        # Same column aliases as QUERY_GET_EQUIPMENT_GROUPED_ALL.
        {"ID": 1, "INV_NO": "500", "type_name": "МФУ", "model_name": "HP M428", "branch_name": "Тюмень", "location": "214"},
        {"ID": 2, "INV_NO": "501", "type_name": "МФУ", "model_name": "Kyocera 2040"},
        {"ID": 3, "INV_NO": "502", "type_name": "Монитор", "model_name": "Dell"},
    ]
    states = {
        "ITINVENT|1": {"ip_address": "10.0.0.5", "updated_at": "2026-10-02T06:00:00+00:00",
                       "runtime": {"snmp": {"supplies": [{"name": "Black", "percent": 8}, {"name": "Drum", "percent": 60}]}}},
        "ITINVENT|2": {"ip_address": "10.0.0.6", "runtime": {"supplies": [{"name": "Black", "percent": 40}]}},
    }
    monkeypatch.setattr(mfu, "get_all_equipment_flat", lambda db_id, limit: rows)
    monkeypatch.setattr(mfu_monitor_module.mfu_runtime_monitor, "read_persisted_runtime_states", lambda: states)
    result = mfu.MfuLowTonerTool().execute(context=_ctx(role="admin"), args=mfu.MfuLowTonerArgs())
    assert result.ok is True, result.error
    assert [item["inv_no"] for item in result.data["items"]] == ["500"]
    assert result.data["items"][0]["low_supplies"] == [{"name": "Black", "percent": 8}]
    assert result.data["items"][0]["location"] == "214"


# ---------- wiring ----------


def test_stage3_permissions_and_groups():
    assert permissions_module.tool_required_permissions("warehouse.balances.search") == ["warehouse_1c.read"]
    assert permissions_module.tool_required_permissions("warehouse.it_requests.search") == ["warehouse_1c.it_requests.read"]
    assert permissions_module.tool_required_permissions("me.it_requests") == ["chat.ai.use"]
    assert permissions_module.tool_required_permissions("itinvent.acts.pending") == ["database.read"]
    assert permissions_module.tool_required_permissions("mfu.devices.low_toner") == ["mfu.read"]
    assert context_module.get_tool_group("warehouse.balances.search") == "warehouse"
    assert context_module.get_tool_group("me.it_requests") == "self"
    assert "warehouse" in context_module.AI_TOOL_GROUPS_ALL
    assert "warehouse" in service_module._JEV_GROUP_QUESTIONS
    assert service_module._AI_TOOL_GROUP_ROUTING_GUIDES["warehouse"] == service_module.AI_WAREHOUSE_TOOL_ROUTING_GUIDE
    for tool_id in (
        "itinvent.acts.pending",
        "mfu.devices.low_toner",
        "warehouse.balances.search",
        "warehouse.it_requests.search",
        "warehouse.it_requests.get",
        "me.it_requests",
    ):
        assert registry.get(tool_id) is not None, tool_id


# ---------- morning IT digest ----------


def _fake_execute(results):
    def execute(*, tool_id, raw_args, context):
        return SimpleNamespace(ok=True, data=results[tool_id], error=None), {}

    return execute


def test_digest_sections_follow_recipient_permissions(monkeypatch):
    results = {
        "ad.users.expiring_soon": {"total_found": 1, "users": [{"display_name": "Петров", "days_to_expire": 2}]},
        "mfu.devices.low_toner": {"total": 0, "items": []},
        "itinvent.acts.pending": {"total": 7, "items": [
            {"new_employee": f"Сотрудник {i}", "equipment_count": 1, "days_open": 5} for i in range(7)
        ]},
    }
    allowed = {"ad.users.expiring_soon", "mfu.devices.low_toner", "itinvent.acts.pending"}
    monkeypatch.setattr(permissions_module, "user_can_use_tool", lambda tool_id, payload: tool_id in allowed)
    monkeypatch.setattr(registry, "execute", _fake_execute(results))
    text = it_digest.build_digest_markdown(user_payload={"id": 7, "role": "viewer"}, now=datetime(2026, 10, 2, 8, 5))
    assert text.startswith("## Утренняя сводка IT — 02.10.2026")
    assert "**Пароли AD истекают в ближайшие 3 дня: 1**" in text and "Петров — 2 дн." in text
    assert "**Акты передачи не подписаны больше 3 дней: 7**" in text and "…и ещё 2" in text
    assert "Без замечаний: заканчивается тонер." in text
    assert "почтовые" not in text and "ИТ-заявки" not in text

    monkeypatch.setattr(permissions_module, "user_can_use_tool", lambda tool_id, payload: False)
    assert it_digest.build_digest_markdown(user_payload={"id": 8}) is None


@pytest.fixture
def digest_env(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'digest.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(cfg.config.app_db, "database_url", url, raising=False)
    monkeypatch.setattr(appdb.config.app_db, "database_url", url, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()
    appdb.initialize_app_schema(url)
    monkeypatch.setenv("AI_IT_DIGEST_ENABLED", "1")
    monkeypatch.setenv("AI_IT_DIGEST_USER_IDS", "7, 8, x")
    monkeypatch.setenv("AI_IT_DIGEST_HOUR", "8")
    monkeypatch.setenv("AI_IT_DIGEST_WEEKDAYS_ONLY", "1")
    monkeypatch.delenv("AI_IT_DIGEST_DRY_RUN", raising=False)
    users = {7: {"id": 7, "is_active": True}, 8: {"id": 8, "is_active": False}}
    monkeypatch.setattr(user_service_module.user_service, "get_by_id", lambda uid: users.get(int(uid)))
    monkeypatch.setattr(it_digest, "build_digest_markdown", lambda **kw: f"digest for {kw['user_payload']['id']}")
    yield appdb
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()


def test_digest_runs_once_per_day(digest_env):
    sent = []
    service = it_digest.ItDigestService()
    service._now = lambda: datetime(2026, 10, 2, 7, 59)  # Friday, before the hour
    assert service.run_if_due(post=lambda *a: sent.append(a))["status"] == "not_due"

    service._now = lambda: datetime(2026, 10, 2, 8, 1)
    first = service.run_if_due(post=lambda *a: sent.append(a))
    assert first == {"status": "ok", "day": "2026-10-02", "sent": 1, "failed": 0}
    assert sent == [("", 7, "digest for 7")]
    # A second worker process (fresh service) must not post again the same day.
    other = it_digest.ItDigestService()
    other._now = service._now
    assert other.run_if_due(post=lambda *a: sent.append(a))["status"] == "already_done"
    assert len(sent) == 1

    service._now = lambda: datetime(2026, 10, 3, 9, 0)  # Saturday
    assert service.run_if_due(post=lambda *a: sent.append(a))["status"] == "not_due"
    service._now = lambda: datetime(2026, 10, 5, 9, 0)  # Monday
    assert service.run_if_due(post=lambda *a: sent.append(a))["status"] == "ok"
    assert len(sent) == 2

    raw, state = service._load()
    assert json.loads(raw)["last_date"] == "2026-10-05" and state["sent"] == 1


def test_digest_disabled_and_dry_run(digest_env, monkeypatch):
    sent = []
    service = it_digest.ItDigestService()
    service._now = lambda: datetime(2026, 10, 2, 9, 0)
    monkeypatch.setenv("AI_IT_DIGEST_ENABLED", "0")
    assert service.run_if_due(post=lambda *a: sent.append(a))["status"] == "not_due"
    monkeypatch.setenv("AI_IT_DIGEST_ENABLED", "1")
    monkeypatch.setenv("AI_IT_DIGEST_DRY_RUN", "1")
    assert service.run_if_due(post=lambda *a: sent.append(a))["status"] == "dry_run"
    assert sent == []


def test_digest_delivery_failure_is_counted(digest_env):
    def broken(*args):
        raise LookupError("no dialog")

    service = it_digest.ItDigestService()
    service._now = lambda: datetime(2026, 10, 2, 9, 0)
    assert service.run_if_due(post=broken) == {"status": "partial", "day": "2026-10-02", "sent": 0, "failed": 1}
