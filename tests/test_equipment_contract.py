"""Contract tests for the grouped equipment list, universal search and the
lazy current-act batch endpoint (robustness plan, stage 1/7).

Pinned contracts:
- GET /equipment/all-grouped -> {grouped, total, page, limit, pages} where
  rows are whitelisted to EquipmentListRow (heavy fields stripped), ordering
  is stable via the i.ID tie-breaker, and limit is capped (422 above max).
- search_equipment_universal -> honest page/pages/total (OFFSET/FETCH + COUNT).
- POST /equipment/current-acts -> {items: [{item_id, available, doc_*}]},
  available=None when the lookup itself failed.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


class FakeDB:
    def __init__(self, responses=None, exc: Exception | None = None):
        self.calls = []
        self._responses = list(responses or [])
        self._exc = exc

    def execute_query(self, query, params=None):
        self.calls.append((query, params))
        if self._exc is not None:
            raise self._exc
        return self._responses.pop(0) if self._responses else []


def _admin_user():
    from backend.models.auth import User

    return User(
        id=91,
        username="contract-admin",
        role="admin",
        is_active=True,
        permissions=["database.read"],
        use_custom_permissions=True,
        custom_permissions=["database.read"],
    )


def _equipment_app(monkeypatch):
    from fastapi import FastAPI
    from backend.api import deps
    from backend.api.v1 import equipment as equipment_api

    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin_user
    return app, equipment_api


def test_all_grouped_contract_shape_and_row_whitelist(monkeypatch):
    """Response pins {grouped,total,page,limit,pages}; rows are slim DTO rows."""
    from fastapi.testclient import TestClient
    from backend.database import equipment_db

    heavy_row = {
        "ID": 11,
        "INV_NO": 2001,
        "SERIAL_NO": "SN-1",
        "HW_SERIAL_NO": None,
        "part_no": "PN-1",
        "type_no": 3,
        "type_name": "Ноутбук",
        "model_no": 8,
        "model_name": "Latitude",
        "empl_no": 501,
        "employee_name": "Сидоров",
        "employee_dept": "ИТ",
        "branch_no": 1,
        "branch_name": "HQ",
        "loc_no": 9,
        "location": "Каб 101",
        "status_no": 2,
        "status": "В работе",
        "qty": 1,
        "ip_address": "10.0.0.1",
        "mac_address": "AA:BB",
        "network_name": "PC-1",
        "domain_name": "CORP",
        # Heavy/forbidden list fields — must be stripped by the response model:
        "DESCRIPTION": "x" * 500,
        "manufacturer": "Lenovo",
        "current_act_available": True,
        "current_act_doc_no": 42,
    }

    monkeypatch.setattr(
        equipment_db,
        "get_equipment_grouped",
        lambda page, limit, db_id=None: {
            "grouped": {"HQ": {"Каб 101": [dict(heavy_row)]}},
            "total": 3,
            "page": page,
            "limit": limit,
            "pages": 1,
        },
    )
    app, _equipment_api = _equipment_app(monkeypatch)
    client = TestClient(app)

    response = client.get("/equipment/all-grouped?page=2&limit=50")
    assert response.status_code == 200
    payload = response.json()

    assert payload["page"] == 2
    assert payload["limit"] == 50
    assert payload["total"] == 3
    assert payload["pages"] == 1
    rows = payload["grouped"]["HQ"]["Каб 101"]
    assert len(rows) == 1
    row = rows[0]
    # Whitelisted keys survive...
    for key in ("ID", "INV_NO", "SERIAL_NO", "part_no", "type_name", "model_name",
                "employee_name", "branch_name", "location", "status", "qty",
                "ip_address", "mac_address", "network_name", "domain_name"):
        assert key in row, f"missing whitelisted key {key}"
    # ...heavy/enrich keys are stripped.
    for key in ("DESCRIPTION", "manufacturer", "vendor_name",
                "current_act_available", "current_act_doc_no"):
        assert key not in row, f"unexpected heavy key {key}"


def test_all_grouped_limit_cap_is_documented(monkeypatch):
    """limit le=10000 is part of the contract: above that the API says 422."""
    from fastapi.testclient import TestClient
    from backend.database import equipment_db

    monkeypatch.setattr(
        equipment_db,
        "get_equipment_grouped",
        lambda page, limit, db_id=None: {
            "grouped": {}, "total": 0, "page": page, "limit": limit, "pages": 0,
        },
    )
    app, _equipment_api = _equipment_app(monkeypatch)
    client = TestClient(app)

    assert client.get("/equipment/all-grouped?limit=10000").status_code == 200
    assert client.get("/equipment/all-grouped?limit=10001").status_code == 422
    assert client.get("/equipment/all-grouped?page=0").status_code == 422


def test_all_grouped_branch_path_keeps_limit_in_response(monkeypatch):
    """The ?branch= variant must return the same pagination contract."""
    from fastapi.testclient import TestClient
    from backend.database import equipment_db

    monkeypatch.setattr(
        equipment_db,
        "get_equipment_by_branch",
        lambda branch_name, page, limit, db_id=None: {
            "equipment": [{"ID": 1, "INV_NO": 5, "location": "Каб 1"}],
            "total": 1,
            "page": page,
            "limit": limit,
            "pages": 1,
            "branch": branch_name,
        },
    )
    app, _equipment_api = _equipment_app(monkeypatch)
    client = TestClient(app)

    payload = client.get("/equipment/all-grouped?branch=HQ&limit=25").json()
    assert payload["limit"] == 25
    assert payload["page"] == 1
    assert payload["pages"] == 1
    assert payload["total"] == 1
    assert payload["grouped"]["HQ"]["Каб 1"][0]["INV_NO"] == 5


def test_grouped_queries_have_stable_order_tiebreaker():
    """Grouped list ordering must end with the i.ID tie-breaker."""
    from backend.database import queries_new

    for name in ("QUERY_GET_EQUIPMENT_GROUPED", "QUERY_GET_EQUIPMENT_BY_BRANCH"):
        query = getattr(queries_new, name)
        assert "ORDER BY" in query and "i.INV_NO, i.ID" in query, name


def test_grouped_list_runs_no_enrich_cte(monkeypatch):
    """get_equipment_grouped must be COUNT + list SQL only — no DOCS_LIST enrich."""
    from backend.database import equipment_db

    fake_db = FakeDB([[{"total": 3}], [{"ID": 1, "INV_NO": 7, "branch_name": "HQ", "location": "Каб"}]])
    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: fake_db)

    result = equipment_db.get_equipment_grouped(page=2, limit=50, db_id="main")

    assert len(fake_db.calls) == 2, "expected COUNT + list queries only"
    for query, _params in fake_db.calls:
        assert "DOCS_LIST" not in query, "enrich CTE leaked into list path"
    # Second call is the page query with real OFFSET/FETCH params.
    assert fake_db.calls[1][1] == (50, 50)
    assert result["page"] == 2 and result["limit"] == 50 and result["total"] == 3
    row = result["grouped"]["HQ"]["Каб"][0]
    assert "current_act_available" not in row


def test_universal_search_pagination_contract(monkeypatch):
    """search/universal returns honest page/pages/total from COUNT+OFFSET/FETCH."""
    from backend.database import queries as db_queries

    universal_rows = [{"inv_no": "1002", "model_name": "Dell P2422H"}]
    count_rows = [{"total": 7}]
    fake_db = FakeDB([count_rows, universal_rows])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.search_equipment_universal("Dell", page=2, limit=3, db_id="main")

    assert result["equipment"] == universal_rows
    assert result["total"] == 7
    assert result["page"] == 2
    assert result["pages"] == 3  # ceil(7/3) — honest, not len(rows)-based
    # COUNT first, then the page query with OFFSET/FETCH params.
    assert fake_db.calls[0][0] == db_queries.QUERY_COUNT_UNIVERSAL
    assert fake_db.calls[1][0] == db_queries.QUERY_SEARCH_UNIVERSAL
    assert fake_db.calls[1][1][-2:] == (3, 3)  # offset=3, limit=3


def test_universal_search_covers_client_index_fields():
    """Server universal search must cover every field the client index used.

    The retired hot-path client index searched: INV_NO, SERIAL_NO, HW_SERIAL_NO,
    PART_NO, MODEL_NAME, TYPE_NAME, OWNER_DISPLAY_NAME, IP_ADDRESS, MAC_ADDRESS
    (incl. compact form), NETBIOS_NAME, DOMAIN_NAME. Universal search is a
    superset (adds vendor/dept/branch/location/status).
    """
    from backend.database import equipment_search_reads

    where = equipment_search_reads.QUERY_SEARCH_UNIVERSAL.split("WHERE")[-1]
    for column in (
        "i.INV_NO", "i.SERIAL_NO", "i.HW_SERIAL_NO", "i.PART_NO",
        "m.MODEL_NAME", "t.TYPE_NAME", "o.OWNER_DISPLAY_NAME",
        "i.IP_ADDRESS", "i.MAC_ADDRESS", "i.NETBIOS_NAME", "i.DOMAIN_NAME",
    ):
        assert column in where, f"universal search lost coverage of {column}"
    # Result rows carry id + grouping keys for the list/act-badge machinery.
    select = equipment_search_reads.QUERY_SEARCH_UNIVERSAL.split("FROM")[0]
    for alias in ("id", "inv_no", "branch_name", "location_name"):
        assert f"as {alias}" in select, f"missing alias {alias}"


def test_current_acts_endpoint_batches_visible_rows(monkeypatch):
    """POST /equipment/current-acts returns per-item act info in one call."""
    from fastapi.testclient import TestClient
    from backend.database import equipment_current_act_reads

    captured = {}

    def fake_lookup(item_ids, db_id=None, *, get_db_fn=None):
        captured["item_ids"] = list(item_ids)
        captured["db_id"] = db_id
        return {
            11: {"item_id": 11, "doc_no": 77, "doc_number": "Акт 77", "doc_date": "2026-01-05"},
        }

    monkeypatch.setattr(equipment_current_act_reads, "lookup_current_acts", fake_lookup)
    app, _equipment_api = _equipment_app(monkeypatch)
    client = TestClient(app)

    response = client.post(
        "/equipment/current-acts",
        json={"item_ids": [11, 12]},
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert captured["item_ids"] == [11, 12]
    assert captured["db_id"] == "OBJ-ITINVENT"
    by_id = {item["item_id"]: item for item in payload["items"]}
    assert by_id[11]["available"] is True
    assert by_id[11]["doc_no"] == 77
    assert by_id[12]["available"] is False


def test_current_acts_endpoint_marks_lookup_failure_unknown(monkeypatch):
    """A failed act lookup must report available=None, never false."""
    from fastapi.testclient import TestClient
    from backend.database import equipment_current_act_reads

    monkeypatch.setattr(
        equipment_current_act_reads,
        "lookup_current_acts",
        lambda item_ids, db_id=None, *, get_db_fn=None: None,
    )
    app, _equipment_api = _equipment_app(monkeypatch)
    client = TestClient(app)

    payload = client.post("/equipment/current-acts", json={"item_ids": [5]}).json()
    assert payload["items"] == [{"item_id": 5, "available": None,
                                 "doc_no": None, "doc_number": None, "doc_date": None}]
    # Empty request is a cheap no-op.
    assert client.post("/equipment/current-acts", json={"item_ids": []}).json() == {"items": []}
