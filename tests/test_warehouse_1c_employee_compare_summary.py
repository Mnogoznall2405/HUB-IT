from __future__ import annotations

import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.services.warehouse_1c_service import warehouse_1c_service  # noqa: E402


def _run():
    return asyncio.run(warehouse_1c_service.get_employee_compare_summary(db_id="ITINVENT"))


def _patch_inputs(monkeypatch, *, owners, counts, warehouses, balances, balance_status="ok"):
    warehouse_1c_service._employee_compare_cache.clear()
    monkeypatch.setattr(db_queries, "list_owners_compact", lambda db_id=None: owners)
    monkeypatch.setattr(db_queries, "get_owner_part_no_counts", lambda db_id=None: counts)
    monkeypatch.setattr(
        warehouse_1c_service,
        "_list_warehouse_catalog_entries",
        lambda: (warehouses, {"source": "test", "truncated": False, "as_of": None}),
    )

    async def fake_balances(*, warehouse_refs, limit=None):
        return {
            "items": balances,
            "status": balance_status,
            "truncated": False,
            "as_of": "2025-01-01T00:00:00",
            "source": "live_1c",
        }

    monkeypatch.setattr(
        warehouse_1c_service,
        "get_balances_for_warehouses",
        fake_balances,
    )


def test_compare_summary_marks_full_match(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[
            {"owner_no": 7, "part_no": "PN-1", "item_count": 2},
        ],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2},
        ],
    )

    payload = _run()
    assert payload["meta"]["status"] == "ok"
    assert payload["meta"]["owners_count"] == 1
    item = payload["items"][0]
    assert item["owner_no"] == 7
    assert item["status"] == "match"
    assert item["warehouse_ref"] == "wh-1"
    assert item["counts"]["match"] == 1
    assert item["counts"]["diff"] == 0


def test_compare_summary_diff_only_hub_only_1c(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[
            {"owner_no": 7, "part_no": "PN-1", "item_count": 3},
            {"owner_no": 7, "part_no": "PN-2", "item_count": 1},
        ],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1},
            {"warehouse_ref": "wh-1", "nomenclature_code": "99", "qty_balance": 5},
        ],
    )

    item = _run()["items"][0]
    assert item["status"] == "diff"
    assert item["counts"]["diff"] == 1
    assert item["counts"]["only_hub"] == 1
    assert item["counts"]["only_1c"] == 1


def test_compare_summary_no_warehouse_and_sentinel(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 9, "OWNER_DISPLAY_NAME": "Сидоров Пётр Ильич"}],
        counts=[
            {"owner_no": 9, "part_no": "", "item_count": 2},
            {"owner_no": 9, "part_no": "нет в 1С", "item_count": 1},
        ],
        warehouses=[],
        balances=[],
    )

    item = _run()["items"][0]
    assert item["status"] == "no_warehouse"
    assert item["counts"]["no_part"] == 2
    assert item["counts"]["hub_items"] == 3


def test_compare_summary_skips_owner_without_hub_and_warehouse(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[
            {"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"},
            {"OWNER_NO": 8, "OWNER_DISPLAY_NAME": "Неттехники Ааа Ббб"},
        ],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 1}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        balances=[{"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 1}],
    )

    payload = _run()
    assert payload["meta"]["owners_count"] == 1
    assert payload["items"][0]["owner_no"] == 7


def test_compare_summary_unknown_balance_status_fails_closed(monkeypatch):
    _patch_inputs(
        monkeypatch,
        owners=[{"OWNER_NO": 7, "OWNER_DISPLAY_NAME": "Рябов Александр Сергеевич"}],
        counts=[{"owner_no": 7, "part_no": "PN-1", "item_count": 2}],
        warehouses=[{"ref": "wh-1", "name": "Рябов А.С."}],
        # Эта строка без fail-closed guard дала бы match (2 == 2).
        balances=[
            {"warehouse_ref": "wh-1", "nomenclature_code": "pn-1", "qty_balance": 2},
        ],
        balance_status="unknown",
    )

    payload = _run()
    assert payload["meta"]["status"] == "incomplete"
    assert payload["meta"]["balances_status"] == "unknown"
    item = payload["items"][0]
    assert item["status"] == "unknown"
    assert item["part_status"] == {}
    assert item["counts"]["match"] == 0
    assert item["counts"]["diff"] == 0
    assert item["counts"]["only_hub"] == 0
    assert item["counts"]["only_1c"] == 0
    # Локальные Hub-факты сохраняются.
    assert item["counts"]["hub_items"] == 2
