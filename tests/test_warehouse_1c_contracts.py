from __future__ import annotations

import asyncio
import sys
import types
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
