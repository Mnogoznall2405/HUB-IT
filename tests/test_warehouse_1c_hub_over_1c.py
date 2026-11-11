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
from backend.services.warehouse_1c_service import Warehouse1CQueryError  # noqa: E402


def _configure_single_db(monkeypatch):
    monkeypatch.setattr(
        "backend.api.v1.database.get_all_db_configs",
        lambda: [{"id": "ITINVENT", "name": "ITINVENT"}],
    )


def test_hub_over_1c_error_is_incomplete_not_zero(monkeypatch):
    _configure_single_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "get_hub_items_by_usable_part_no_page",
        lambda **kwargs: {
            "items": [{"part_no": "PN-1", "hub_count": 2}],
            "total": 1,
            "has_more": False,
        },
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_codes",
        lambda codes: {"pn-1": {"ref": "ref-1", "code": "PN-1", "name": "Monitor"}},
    )

    async def fail_balances(**kwargs):
        raise Warehouse1CQueryError("timeout")

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_balances", fail_balances)

    payload = asyncio.run(reconcile.list_hub_over_1c(limit=10, db_id="ITINVENT"))

    assert payload["items"] == []
    assert payload["returned"] == 0
    assert payload["total"] == 1
    assert payload["comparison_total"] is None
    assert payload["status"] == "incomplete"
    assert payload["incomplete_items"][0]["status"] == "error"
    assert "qty_1c" not in payload["incomplete_items"][0]


def test_hub_over_1c_uses_cursor_when_more_candidate_groups_remain(monkeypatch):
    _configure_single_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "get_hub_items_by_usable_part_no_page",
        lambda **kwargs: (
            {
                "items": [{"part_no": "PN-1", "hub_count": 3}],
                "total": 2,
                "has_more": True,
            }
            if kwargs.get("after_hub_count") is None
            else {
                "items": [{"part_no": "PN-2", "hub_count": 2}],
                "total": 2,
                "has_more": False,
            }
        ),
    )
    monkeypatch.setattr(
        db_queries,
        "list_hub_items_by_part_no",
        lambda *args, **kwargs: [],
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_codes",
        lambda codes: {
            "pn-1": {"ref": "ref-1", "code": "PN-1", "name": "One"},
            "pn-2": {"ref": "ref-2", "code": "PN-2", "name": "Two"},
        },
    )

    async def zero_balances(**kwargs):
        return {"items": [], "status": "ok", "truncated": False}

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_balances", zero_balances)
    first = asyncio.run(reconcile.list_hub_over_1c(limit=1, db_id="ITINVENT"))

    assert first["returned"] == 1
    assert first["has_more"] is True
    assert first["total"] == 2
    assert first["source_total"] == 2
    assert first["comparison_total"] is None
    second = asyncio.run(
        reconcile.list_hub_over_1c(limit=1, cursor=first["next_cursor"], db_id="ITINVENT")
    )
    assert second["returned"] == 1
    assert second["has_more"] is False
    assert second["total"] == 2
    # The final keyset page has no knowledge of the first page's mismatch
    # count, so it must not present its one row as the global total.
    assert second["comparison_total"] is None


def test_hub_over_1c_never_hides_a_source_group_cap_as_complete(monkeypatch):
    _configure_single_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "get_hub_items_by_usable_part_no_page",
        lambda **kwargs: {
            "items": [{"part_no": "PN-1", "hub_count": 3}],
            "total": 5001,
            "has_more": True,
        },
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_codes",
        lambda codes: {"pn-1": {"ref": "ref-1", "code": "PN-1", "name": "One"}},
    )
    monkeypatch.setattr(db_queries, "list_hub_items_by_part_no", lambda *args, **kwargs: [])

    async def zero_balances(**kwargs):
        return {"items": [], "status": "ok", "truncated": False}

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_balances", zero_balances)
    payload = asyncio.run(reconcile.list_hub_over_1c(limit=1, db_id="ITINVENT"))

    assert payload["total"] == 5001
    assert payload["source_total"] == 5001
    assert payload["comparison_total"] is None
    assert payload["status"] == "incomplete"
    assert payload["truncated"] is True


def test_hub_over_1c_reports_candidate_and_comparison_totals_separately(monkeypatch):
    _configure_single_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "get_hub_items_by_usable_part_no_page",
        lambda **kwargs: {
            "items": [
                {"part_no": "PN-OVER", "hub_count": 2},
                {"part_no": "PN-EQUAL", "hub_count": 1},
            ],
            "total": 2,
            "has_more": False,
        },
    )
    monkeypatch.setattr(
        db_queries,
        "list_hub_items_by_part_no",
        lambda *args, **kwargs: [],
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_codes",
        lambda codes: {
            "pn-over": {"ref": "ref-over", "code": "PN-OVER", "name": "Over"},
            "pn-equal": {"ref": "ref-equal", "code": "PN-EQUAL", "name": "Equal"},
        },
    )

    async def balances(**kwargs):
        if kwargs["nomenclature_ref"] == "ref-over":
            return {"items": [], "status": "ok", "truncated": False}
        return {"items": [{"qty_balance": 1}], "status": "ok", "truncated": False}

    monkeypatch.setattr(reconcile.warehouse_1c_service, "get_balances", balances)

    payload = asyncio.run(reconcile.list_hub_over_1c(limit=10, db_id="ITINVENT"))

    assert len(payload["items"]) == 1
    assert payload["returned"] == 1
    assert payload["total"] == 2
    assert payload["source_total"] == 2
    assert payload["comparison_total"] == 1
    assert payload["status"] == "ok"


def test_hub_over_1c_missing_source_total_is_incomplete_not_zero(monkeypatch):
    _configure_single_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "get_hub_items_by_usable_part_no_page",
        lambda **kwargs: {"items": [], "has_more": False},
    )
    monkeypatch.setattr(
        reconcile.warehouse_1c_service,
        "lookup_nomenclature_codes",
        lambda codes: {},
    )

    payload = asyncio.run(reconcile.list_hub_over_1c(limit=10, db_id="ITINVENT"))

    assert payload["items"] == []
    assert payload["returned"] == 0
    assert payload["total"] is None
    assert payload["comparison_total"] is None
    assert payload["status"] == "incomplete"
