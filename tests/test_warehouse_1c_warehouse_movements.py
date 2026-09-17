"""Warehouse-level movement history grouped by registrar document."""
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
    Warehouse1CValidationError,
    warehouse_1c_service,
)


def _movement(
    *,
    registrar_ref,
    period,
    nomenclature_name,
    qty_in=0.0,
    qty_out=0.0,
    registrar_number="",
    document_type="transfer",
    from_name="",
    to_name="",
):
    return {
        "registrar_ref": registrar_ref,
        "registrar_name": f"{document_type} {registrar_number}".strip(),
        "registrar_number": registrar_number,
        "registrar_date": period,
        "period": period,
        "registrar_document_type": document_type,
        "is_transfer": document_type == "transfer",
        "can_open_detail": True,
        "nomenclature_ref": f"nom-{nomenclature_name}",
        "nomenclature_code": "10",
        "nomenclature_name": nomenclature_name,
        "series_name": "",
        "qty_in": qty_in,
        "qty_out": qty_out,
        "transfer_from_warehouse_ref": "",
        "transfer_from_warehouse_name": from_name,
        "transfer_to_warehouse_ref": "",
        "transfer_to_warehouse_name": to_name,
    }


def test_warehouse_movements_group_rows_by_document_newest_first(monkeypatch):
    async def fake_run(func, *args, **kwargs):
        assert func.__name__ == "_get_warehouse_movements_sync"
        return [
            _movement(
                registrar_ref="doc-2",
                period="2025-03-12T10:00:00",
                nomenclature_name="Кабель",
                qty_out=2,
                registrar_number="002",
                from_name="Иванова",
                to_name="Центральный",
            ),
            _movement(
                registrar_ref="doc-2",
                period="2025-03-12T10:00:00",
                nomenclature_name="Мышь",
                qty_out=1,
                registrar_number="002",
                from_name="Иванова",
                to_name="Центральный",
            ),
            _movement(
                registrar_ref="doc-1",
                period="2025-03-10T09:00:00",
                nomenclature_name="Ноутбук",
                qty_in=1,
                registrar_number="001",
                from_name="Центральный",
                to_name="Иванова",
            ),
        ]

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)
    payload = asyncio.run(warehouse_1c_service.get_warehouse_movements("wh-1"))

    assert payload["status"] == "ok"
    assert payload["has_more"] is False
    docs = payload["items"]
    assert [doc["registrar_ref"] for doc in docs] == ["doc-2", "doc-1"]

    newest = docs[0]
    assert newest["registrar_number"] == "002"
    assert newest["positions"] == 2
    assert newest["direction"] == "out"
    assert newest["qty_out"] == 3
    assert newest["transfer_from_warehouse_name"] == "Иванова"
    assert newest["transfer_to_warehouse_name"] == "Центральный"
    assert [item["nomenclature_name"] for item in newest["items"]] == ["Кабель", "Мышь"]

    assert docs[1]["direction"] == "in"
    assert docs[1]["qty_in"] == 1


def test_warehouse_movements_paginate_documents_with_cursor(monkeypatch):
    rows = [
        _movement(
            registrar_ref=f"doc-{index}",
            period=f"2025-03-{10 + index:02d}T00:00:00",
            nomenclature_name=f"N{index}",
            qty_in=1,
            document_type="receipt",
        )
        for index in range(5)
    ]

    async def fake_run(func, *args, **kwargs):
        return rows

    monkeypatch.setattr(warehouse_1c_service, "_run_pooled", fake_run)

    first = asyncio.run(warehouse_1c_service.get_warehouse_movements("wh-1", limit=2))
    assert first["returned"] == 2
    assert first["has_more"] is True
    assert first["status"] == "incomplete"
    assert first["next_cursor"]

    second = asyncio.run(
        warehouse_1c_service.get_warehouse_movements("wh-1", limit=2, cursor=first["next_cursor"])
    )
    assert [doc["registrar_ref"] for doc in second["items"]] == ["doc-2", "doc-3"]
    assert second["items"][0]["document_type"] == "receipt"
    assert second["items"][0]["direction"] == "in"


def test_warehouse_movements_reject_empty_warehouse_ref():
    with pytest.raises(Warehouse1CValidationError):
        asyncio.run(warehouse_1c_service.get_warehouse_movements(""))


def test_warehouse_movements_reject_reversed_dates():
    with pytest.raises(Warehouse1CValidationError):
        asyncio.run(
            warehouse_1c_service.get_warehouse_movements(
                "wh-1",
                date_from="2025-03-10",
                date_to="2025-03-01",
            )
        )
