from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.warehouse_1c_service import (  # noqa: E402
    Warehouse1CQueryError,
    Warehouse1CService,
    warehouse_1c_service,
)
from backend.api.v1 import warehouse_1c as warehouse_1c_api  # noqa: E402
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
