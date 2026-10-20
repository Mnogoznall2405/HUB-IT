from __future__ import annotations

import asyncio
import sys
import types
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_service import (  # noqa: E402
    Warehouse1CQueryError,
    Warehouse1CService,
    _guess_content_type,
    warehouse_1c_service,
)
from backend.api.v1 import warehouse_1c as warehouse_1c_api  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.models.warehouse_1c import Warehouse1CBalanceBatchRequest  # noqa: E402
from tests.test_warehouse_1c_process_bridge import DISPATCHER_PATH, _wait_until


@pytest.fixture(autouse=True)
def _use_pooled_test_transport(monkeypatch):
    monkeypatch.setattr(warehouse_1c_service, "_process_bridge_enabled", False)


def _balance(*, qty: float, series: str) -> dict:
    return {
        "nomenclature_ref": "nom-1",
        "nomenclature_code": "PN-1",
        "nomenclature_name": "Monitor",
        "warehouse_ref": "warehouse-1",
        "warehouse_name": "Main",
        "series_ref": series,
        "qty_balance": qty,
        "cost_balance": qty * 10,
    }


@pytest.fixture
def isolated_bridge_client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps

    monkeypatch.setenv("WAREHOUSE_1C_BRIDGE_DISPATCHER", DISPATCHER_PATH)
    monkeypatch.setenv("WAREHOUSE_1C_BRIDGE_QUEUE_LIMIT", "0")
    service = Warehouse1CService(
        data_manager=types.SimpleNamespace(load_json=lambda _name, default_content=None: default_content),
        enable_process_bridge=True,
    )
    monkeypatch.setattr(warehouse_1c_api, "warehouse_1c_service", service)
    app = FastAPI()
    app.include_router(warehouse_1c_api.router, prefix="/warehouse-1c")
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(
        id=42, username="warehouse-read-test", role="admin", is_active=True
    )
    try:
        service._run_process_bridge_sync("warmup", {}, timeout=10)
        with TestClient(app) as client:
            yield client, service
    finally:
        service.shutdown()


def test_http_invalid_filters_do_not_disable_subsequent_warehouse_read(isolated_bridge_client):
    client, service = isolated_bridge_client
    # Both parent-side validation and remote typed validation must remain HTTP 400.
    for params in ({}, {"q": "invalid-filter"}, {"q": "invalid-filter"}, {"q": "invalid-filter"}):
        response = client.get("/warehouse-1c/balances", params=params)
        assert response.status_code == 400
    response = client.get("/warehouse-1c/balances", params={"warehouse_ref": "wh-1"})
    assert response.status_code == 200
    assert service._process_bridge.get_status()["failed"] == 0
    assert service._process_bridge.get_status()["circuit_breaker"] == "closed"


def test_http_overload_is_503_and_does_not_interrupt_the_active_read(isolated_bridge_client):
    client, service = isolated_bridge_client
    responses = []

    def read_balances():
        responses.append(client.get("/warehouse-1c/balances", params={"q": "slow-read"}))

    thread = threading.Thread(target=read_balances)
    thread.start()
    try:
        assert _wait_until(lambda: service._process_bridge.get_status()["pending"] == 1)
        overloaded = client.get("/warehouse-1c/balances", params={"warehouse_ref": "wh-1"})
        assert overloaded.status_code == 503
        assert "items" not in overloaded.json()
        thread.join(timeout=10)
        assert not thread.is_alive()
        assert responses[0].status_code == 200
        assert service._process_bridge.get_status()["restarts"] == 0
    finally:
        thread.join(timeout=10)


def test_http_readiness_is_false_when_the_interactive_worker_is_stopped(isolated_bridge_client, monkeypatch):
    client, service = isolated_bridge_client
    monkeypatch.setattr(service, "get_catalog_status", lambda: {"status": "ok"})
    service._process_bridge.shutdown()
    response = client.get("/warehouse-1c/status")
    assert response.status_code == 200
    assert response.json()["bridge"]["ready"] is False
    assert response.json()["ready"] is False


@pytest.mark.parametrize("export_fails", [False, True])
def test_catalog_leader_lease_has_no_open_transaction_during_export(monkeypatch, export_fails):
    from backend.appdb import db as app_db

    class LeaseConnection:
        locked = False
        in_transaction = False
        autocommit = False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            assert not self.locked

        def execution_options(self, *, isolation_level):
            self.autocommit = isolation_level == "AUTOCOMMIT"
            return self

        def execute(self, statement, params):
            self.in_transaction = not self.autocommit
            self.locked = "pg_try_advisory_lock" in str(statement)
            return types.SimpleNamespace(scalar=lambda: True)

    connection = LeaseConnection()
    monkeypatch.setattr(app_db, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(app_db, "get_app_engine", lambda: types.SimpleNamespace(
        dialect=types.SimpleNamespace(name="postgresql"), connect=lambda: connection
    ))

    def export():
        assert connection.locked, "export must retain the leader lease"
        assert not connection.in_transaction, "waiting on 1C must not keep a PostgreSQL transaction open"
        if export_fails:
            raise RuntimeError("catalog export failed")
        return {"status": "ok"}

    monkeypatch.setattr(warehouse_1c_service, "sync_catalog_from_1c", export)
    if export_fails:
        with pytest.raises(RuntimeError, match="catalog export failed"):
            warehouse_1c_service.sync_catalog_from_1c_as_leader()
    else:
        warehouse_1c_service.sync_catalog_from_1c_as_leader()
    assert not connection.locked


def test_connect_decodes_ascii_unicode_escapes_in_username(monkeypatch):
    captured = {}

    class FakeConnector:
        def Connect(self, connection_string):
            captured["connection_string"] = connection_string
            return object()

    client_module = types.ModuleType("win32com.client")
    client_module.Dispatch = lambda _name: FakeConnector()
    win32com_module = types.ModuleType("win32com")
    win32com_module.client = client_module
    monkeypatch.setitem(sys.modules, "win32com", win32com_module)
    monkeypatch.setitem(sys.modules, "win32com.client", client_module)
    monkeypatch.setenv("BUH20_1C_SERVER", "server")
    monkeypatch.setenv("BUH20_1C_REF", "buh20")
    monkeypatch.setenv(
        "BUH20_1C_USER",
        r"\u041a\u043e\u0437\u043b\u043e\u0432\u0441\u043a\u0438\u0439\u041c\u0415",
    )
    monkeypatch.setenv("BUH20_1C_PASSWORD", "password")

    service = Warehouse1CService(enable_process_bridge=False)
    try:
        service._connect()
    finally:
        service.shutdown()

    assert 'Usr="КозловскийМЕ";' in captured["connection_string"]


def test_batch_balances_sum_series_in_one_bridge_call(monkeypatch):
    calls = []

    async def fake_run(func, *args, **kwargs):
        calls.append((func.__name__, args))
        return [_balance(qty=1, series="s1"), _balance(qty=1, series="s2")]

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)

    payload = asyncio.run(
        warehouse_1c_service.get_balances_batch(
            nomenclature_refs=["nom-1", "nom-1"],
            limit_per_nomenclature=20,
        )
    )

    assert calls == [("_get_balances_batch_sync", (["nom-1"], "", 21))]
    assert payload["status"] == "ok"
    assert payload["returned"] == 1
    assert payload["items"][0]["qty_1c_total"] == 2
    assert payload["items"][0]["source_row_count"] == 2


def test_batch_error_is_not_returned_as_zero_balance(monkeypatch):
    async def fake_run(*args, **kwargs):
        raise Warehouse1CQueryError("1C unavailable")

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)

    with pytest.raises(Warehouse1CQueryError):
        asyncio.run(warehouse_1c_service.get_balances_batch(nomenclature_refs=["nom-1"]))


def test_movements_keep_zero_ending_rows_and_default_to_all_history(monkeypatch):
    captured = {}

    async def fake_run(func, *args, **kwargs):
        captured["args"] = args
        return [
            {
                "registrar_ref": "doc-1",
                "qty_end": 0,
                "qty_in": 1,
                "qty_out": 1,
            }
        ]

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)
    payload = asyncio.run(
        warehouse_1c_service.get_movements(
            nomenclature_ref="nom-1",
            include_meta=True,
        )
    )

    assert payload["items"][0]["qty_end"] == 0
    assert payload["status"] == "ok"
    start = captured["args"][3]
    end = captured["args"][4]
    assert start is None
    assert end is None


def test_movements_exclude_period_boundaries_without_a_registrar_or_turnover(monkeypatch):
    async def fake_run(func, *args, **kwargs):
        return [
            {
                "registrar_ref": "",
                "qty_start": 1,
                "qty_in": 0,
                "qty_out": 0,
                "qty_end": 1,
                "cost_in": 0,
                "cost_out": 0,
                "cost_accounting_in": 0,
                "cost_accounting_out": 0,
            },
            {
                "registrar_ref": "transfer-1",
                "qty_start": 0,
                "qty_in": 1,
                "qty_out": 0,
                "qty_end": 1,
                "transfer_from_warehouse_name": "Петров Алексей Васильевич",
                "transfer_to_warehouse_name": "Козловский Максим Евгеньевич",
            },
        ]

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)

    payload = asyncio.run(
        warehouse_1c_service.get_movements(
            nomenclature_ref="nom-1",
            include_meta=True,
        )
    )

    assert [row["registrar_ref"] for row in payload["items"]] == ["transfer-1"]
    assert payload["total"] == 1


def test_batch_route_reaches_the_batch_service(monkeypatch):
    captured = {}

    async def fake_batch(**kwargs):
        captured.update(kwargs)
        return {"status": "ok", "items": []}

    monkeypatch.setattr(warehouse_1c_api.warehouse_1c_service, "get_balances_batch", fake_batch)

    payload = asyncio.run(
        warehouse_1c_api.get_balances_batch(
            Warehouse1CBalanceBatchRequest(nomenclature_refs=["nom-1"]),
            _=None,
        )
    )

    assert payload == {"status": "ok", "items": []}
    assert captured["nomenclature_refs"] == ["nom-1"]


@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("scan.webp", "image/webp"),
        ("act.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ("rows.csv", "text/csv; charset=utf-8"),
    ],
)
def test_attached_file_content_type_supports_previewable_extensions(filename, content_type):
    assert _guess_content_type(filename) == content_type


def test_movement_file_preview_route_uses_authenticated_user_scope(monkeypatch):
    captured = {}

    def fake_preview_state(**kwargs):
        captured.update(kwargs)
        return {"status": "ready", "preview_kind": "office_pdf"}

    monkeypatch.setattr(
        warehouse_1c_api.warehouse_1c_service,
        "get_movement_file_preview_state",
        fake_preview_state,
    )
    current_user = User(id=42, username="preview-user")

    payload = asyncio.run(
        warehouse_1c_api.get_movement_file_preview(
            file_ref="file-1",
            registrar_ref="registrar-1",
            current_user=current_user,
        )
    )

    assert payload["status"] == "ready"
    assert captured == {
        "user_id": 42,
        "registrar_ref": "registrar-1",
        "file_ref": "file-1",
    }


def test_enabled_process_bridge_routes_typed_balance_read_without_local_com():
    calls = []

    class FakeBridge:
        def call(self, operation, payload, *, timeout):
            calls.append((operation, payload, timeout))
            return {
                "items": [],
                "returned": 0,
                "total": 0,
                "has_more": False,
                "truncated": False,
                "status": "ok",
                "source": "live_1c",
            }

        def get_status(self):
            return {"circuit_breaker": "closed", "ready": True}

        def shutdown(self):
            return None

    service = Warehouse1CService(enable_process_bridge=False)
    service._process_bridge_enabled = True
    service._process_bridge = FakeBridge()
    try:
        payload = asyncio.run(
            service.get_balances(nomenclature_ref="nom-1", include_meta=True)
        )
    finally:
        service.shutdown()

    assert payload["status"] == "ok"
    assert calls[0][0] == "balances"
    assert calls[0][1]["nomenclature_ref"] == "nom-1"


def test_dismissed_warehouses_route_is_independent_of_hub_database(monkeypatch):
    captured = {}

    async def fake_dismissed(**kwargs):
        captured.update(kwargs)
        return {"status": "ok", "items": []}

    monkeypatch.setattr(
        warehouse_1c_api.warehouse_1c_service,
        "get_dismissed_employee_warehouses",
        fake_dismissed,
    )
    current_user = User(id=42, username="warehouse-user", role="admin")

    payload = asyncio.run(
        warehouse_1c_api.get_dismissed_employee_warehouses(
            limit=750,
            _=current_user,
        )
    )

    assert payload == {"status": "ok", "items": []}
    assert captured == {"limit": 750}


def test_dismissed_warehouses_only_return_zup_matched_warehouses_with_positive_balances(monkeypatch):
    service = Warehouse1CService(enable_process_bridge=False)
    updated_at = datetime.now(timezone.utc).isoformat()
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.load_cache",
        lambda: {
            "updated_at": updated_at,
            "dismissed_updated_at": updated_at,
            "last_error": "",
            "items": [{"full_name": "Петров Петр Петрович"}],
            "dismissed_items": [
                {
                    "employee_code": "E-10",
                    "full_name": "Иванов Иван Иванович",
                    "department": "ИТ",
                    "department_location": "Тюмень",
                    "position": "Инженер",
                    "dismissal_date": "2026-08-31",
                }
            ],
        },
    )
    monkeypatch.setattr(
        service,
        "_list_warehouse_catalog_entries",
        lambda: (
            [
                {"ref": "wh-dismissed", "name": "Склад Иванов И.И."},
                {"ref": "wh-empty", "name": "Иванов Иван Иванович Резерв"},
                {"ref": "wh-active", "name": "Петров П.П."},
            ],
            {"source": "app_snapshot", "truncated": False},
        ),
    )

    async def fake_balances(*, warehouse_refs, limit=None):
        assert warehouse_refs == ["wh-dismissed", "wh-empty"]
        return {
            "items": [
                {
                    "warehouse_ref": "wh-dismissed",
                    "warehouse_name": "Склад Иванов И.И.",
                    "nomenclature_ref": "nom-1",
                    "nomenclature_code": "PN-1",
                    "nomenclature_name": "Монитор",
                    "qty_balance": 2,
                    "cost_balance": 100,
                    "cost_accounting_balance": 90,
                }
            ],
            "returned": 1,
            "total": 1,
            "has_more": False,
            "truncated": False,
            "as_of": "2026-09-10T08:05:00+00:00",
            "source": "live_1c",
            "status": "ok",
        }

    monkeypatch.setattr(service, "get_balances_for_warehouses", fake_balances)
    try:
        payload = asyncio.run(
            service.get_dismissed_employee_warehouses(limit=1000)
        )
    finally:
        service.shutdown()

    assert payload["status"] == "ok"
    assert payload["total"] == 1
    assert [item["warehouse"]["ref"] for item in payload["items"]] == ["wh-dismissed"]
    assert payload["items"][0]["employee_name"] == "Иванов Иван Иванович"
    assert payload["items"][0]["city"] == "Тюмень"
    assert payload["items"][0]["employee_code"] == "E-10"
    assert payload["items"][0]["dismissal_date"] == "2026-08-31"
    assert payload["items"][0]["totals"] == {
        "qty": 2.0,
        "cost": 100.0,
        "cost_accounting": 90.0,
        "positions": 1,
    }
    assert payload["items"][0]["balances"][0]["nomenclature_name"] == "Монитор"


def test_dismissed_warehouses_report_ambiguous_matches_without_pagination(monkeypatch):
    service = Warehouse1CService(enable_process_bridge=False)
    updated_at = datetime.now(timezone.utc).isoformat()
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.load_cache",
        lambda: {
            "updated_at": updated_at,
            "dismissed_updated_at": updated_at,
            "last_error": "",
            "dismissed_items": [
                {
                    "employee_code": "E-21",
                    "full_name": "Иванов Иван Иванович",
                    "department": "ИТ",
                    "department_location": "Тюмень",
                    "position": "Инженер",
                    "dismissal_date": "2026-08-01",
                },
                {
                    "employee_code": "E-22",
                    "full_name": "Иванов Илья Игоревич",
                    "department": "ИТ",
                    "department_location": "Москва",
                    "position": "Инженер",
                    "dismissal_date": "2026-08-02",
                },
            ],
        },
    )
    monkeypatch.setattr(
        service,
        "_list_warehouse_catalog_entries",
        lambda: ([{"ref": "wh-ambiguous", "name": "Склад Иванов И.И."}], {"truncated": False}),
    )

    async def fake_balances(*, warehouse_refs, limit=None):
        assert warehouse_refs == ["wh-ambiguous"]
        return {
            "items": [
                {
                    "warehouse_ref": "wh-ambiguous",
                    "warehouse_name": "Склад Иванов И.И.",
                    "nomenclature_ref": "nom-1",
                    "nomenclature_code": "PN-1",
                    "nomenclature_name": "Монитор",
                    "qty_balance": 1,
                    "cost_balance": 50,
                    "cost_accounting_balance": 45,
                }
            ],
            "returned": 1,
            "total": 1,
            "has_more": False,
            "truncated": False,
            "as_of": "2026-09-10T08:05:00+00:00",
            "source": "live_1c",
            "status": "ok",
        }

    monkeypatch.setattr(service, "get_balances_for_warehouses", fake_balances)
    try:
        payload = asyncio.run(service.get_dismissed_employee_warehouses(limit=1000))
    finally:
        service.shutdown()

    assert payload["status"] == "incomplete"
    assert payload["incomplete_reason"] == "ambiguous_warehouse_match"
    assert payload["ambiguous_warehouses"] == 1
    assert payload["has_more"] is False
    assert payload["truncated"] is False
    assert payload["returned"] == 1
    assert payload["items"][0]["warehouse"]["ref"] == "wh-ambiguous"
    assert payload["items"][0]["ambiguous"] is True
    assert payload["items"][0]["employment_status"] == "ambiguous"
    assert payload["items"][0]["employee_name"] is None
    assert payload["items"][0]["employee_code"] is None
    assert payload["items"][0]["city"] is None
    assert len(payload["items"][0]["employee_candidates"]) == 2
    candidate_names = {c["employee_name"] for c in payload["items"][0]["employee_candidates"]}
    assert candidate_names == {"Иванов Иван Иванович", "Иванов Илья Игоревич"}
    assert payload["items"][0]["totals"]["qty"] == 1.0


def test_dismissed_warehouses_do_not_report_zero_when_zup_cache_is_unknown(monkeypatch):
    service = Warehouse1CService(enable_process_bridge=False)
    monkeypatch.setattr(
        "backend.services.address_book_service.address_book_service.load_cache",
        lambda: {"updated_at": "", "dismissed_updated_at": "", "dismissed_items": []},
    )
    try:
        payload = asyncio.run(
            service.get_dismissed_employee_warehouses(limit=1000)
        )
    finally:
        service.shutdown()

    assert payload["items"] == []
    assert payload["status"] == "unknown"
    assert payload["truncated"] is True
    assert payload["total"] is None


def test_dismissed_warehouse_balances_use_process_bridge():
    calls = []

    class FakeBridge:
        def call(self, operation, payload, *, timeout):
            calls.append((operation, payload, timeout))
            return {
                "items": [],
                "returned": 0,
                "total": 0,
                "has_more": False,
                "truncated": False,
                "status": "ok",
                "source": "live_1c",
            }

        def shutdown(self):
            return None

    service = Warehouse1CService(enable_process_bridge=False)
    service._process_bridge_enabled = True
    service._process_bridge = FakeBridge()
    try:
        payload = asyncio.run(
            service.get_balances_for_warehouses(
                warehouse_refs=["wh-1", "wh-1", "wh-2"],
                limit=1000,
            )
        )
    finally:
        service.shutdown()

    assert payload["status"] == "ok"
    assert calls[0][0] == "balances_by_warehouses"
    assert calls[0][1] == {"warehouse_refs": ["wh-1", "wh-2"], "limit": 1000}
