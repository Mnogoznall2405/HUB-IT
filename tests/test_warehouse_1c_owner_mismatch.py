from __future__ import annotations

import asyncio
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.services import warehouse_1c_reconcile as reconcile  # noqa: E402
from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service  # noqa: E402


def _balance(series_ref: str) -> dict:
    return {
        "nomenclature_ref": "nom-1",
        "nomenclature_code": "PN-1",
        "nomenclature_name": "Monitor",
        "warehouse_ref": "warehouse-1",
        "warehouse_name": "Main",
        "series_ref": series_ref,
        "qty_balance": 1,
        "cost_balance": 10,
    }


def test_owner_mismatch_aggregates_series_and_uses_one_hub_batch(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "list_reconcile_queue",
        lambda **kwargs: {"items": [], "total": 0},
    )

    async def fake_employee_warehouse(**kwargs):
        return {
            "status": "matched",
            "warehouse": {"ref": "warehouse-1", "name": "Main"},
            "balances": [_balance("s1"), _balance("s2")],
            "balances_meta": {"status": "ok", "truncated": False},
            "candidates": [],
        }

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_employee_warehouse", fake_employee_warehouse)
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )
    monkeypatch.setattr(
        one_c_reconcile_registry_service,
        "get_active_owner_links",
        lambda **kwargs: {"warehouse-1": [7]},
    )
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_and_part_nos",
        lambda owner_nos, part_nos, db_id=None: {(7, "pn-1"): 1},
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "get_balances_with_hub",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("N+1 balance calls are forbidden")),
    )

    payload = asyncio.run(
        reconcile.list_owner_mismatches(employee_name="Main", db_id="ITINVENT")
    )

    assert len(payload["items"]) == 1
    row = payload["items"][0]
    assert row["qty_1c_total"] == 2
    assert row["exact_linked_count"] == 1
    assert row["source_row_count"] == 2
    assert row["owner_link_method"] == "explicit"


def test_owner_mismatch_never_emits_final_delta_for_truncated_1c_balances(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "list_reconcile_queue",
        lambda **kwargs: {"items": [], "total": 0},
    )

    async def fake_employee_warehouse(**kwargs):
        return {
            "status": "matched",
            "warehouse": {"ref": "warehouse-1", "name": "Main"},
            "balances": [_balance("s1")],
            "balances_meta": {"status": "ok", "truncated": True, "has_more": True},
            "candidates": [],
        }

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_employee_warehouse", fake_employee_warehouse)
    monkeypatch.setattr(
        db_queries,
        "count_equipment_by_owners_and_part_nos",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("incomplete 1C data must not be compared")),
    )

    payload = asyncio.run(
        reconcile.list_owner_mismatches(employee_name="Main", db_id="ITINVENT")
    )

    assert payload["status"] == "incomplete"
    assert payload["items"] == []
    assert payload["mismatched"] == []
    assert payload["only_in_1c"] == []
    assert payload["balances_meta"]["comparison_status"] == "incomplete"
