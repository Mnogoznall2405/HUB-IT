from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402


class FakeDB:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def execute_query(self, query, params=None):
        self.calls.append((query, params))
        return self._responses.pop(0) if self._responses else []


def _user():
    return SimpleNamespace(id=1, username="tester", role="operator", full_name="Tester")


def test_consumables_lookup_query_preserves_sql_filters_limit_and_late_bound_get_db(monkeypatch):
    rows = [{"ID": 77, "INV_NO": "C-100"}]
    fake_db = FakeDB([rows, []])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.get_consumables_lookup(
        db_id="main",
        type_no=20,
        model_name=" HP 85A ",
        branch_no="17",
        loc_no="203",
        only_positive_qty=True,
        limit=5000,
    ) == rows
    assert db_queries.get_consumables_lookup(
        db_id="main",
        branch_no="",
        loc_no=None,
        only_positive_qty=False,
        limit=0,
    ) == []

    assert db_ids == ["main", "main"]

    filtered_query, filtered_params = fake_db.calls[0]
    assert "SELECT TOP 1000" in filtered_query
    assert "i.CI_TYPE = 4" in filtered_query
    assert "ISNULL(i.QTY, 0) > 0" in filtered_query
    assert "i.TYPE_NO = ?" in filtered_query
    assert "LOWER(CAST(m.MODEL_NAME AS NVARCHAR(255))) LIKE ?" in filtered_query
    assert "i.BRANCH_NO = ?" in filtered_query
    assert "i.LOC_NO = ?" in filtered_query
    assert filtered_params == (20, "%hp 85a%", "17", "203")

    unfiltered_query, unfiltered_params = fake_db.calls[1]
    assert "SELECT TOP 300" in unfiltered_query
    assert "ISNULL(i.QTY, 0) > 0" not in unfiltered_query
    assert "i.BRANCH_NO = ?" not in unfiltered_query
    assert "i.LOC_NO = ?" not in unfiltered_query
    assert unfiltered_params == ()


@pytest.mark.asyncio
async def test_consumables_lookup_route_normalizes_params_rows_and_preserves_backend_contract(monkeypatch):
    calls = []

    def fake_get_consumables_lookup(**kwargs):
        calls.append(kwargs)
        return [
            {
                "ID": "77",
                "INV_NO": "C-100",
                "TYPE_NO": "20",
                "TYPE_NAME": "Cartridge",
                "MODEL_NO": "88",
                "MODEL_NAME": "HP 85A",
                "QTY": "12",
                "BRANCH_NO": "17.0",
                "BRANCH_NAME": "Tyumen",
                "LOC_NO": "203",
                "LOCATION_NAME": "Storage",
                "PART_NO": "CE285A",
                "DESCRIPTION": "Toner cartridge",
            },
            {"ID": None, "INV_NO": "bad-row"},
        ]

    monkeypatch.setattr(equipment_api.queries, "get_consumables_lookup", fake_get_consumables_lookup)

    result = await equipment_api.get_consumables_lookup(
        type_no=20,
        model_name=" HP 85A ",
        branch_no="17",
        loc_no="room-a",
        only_positive_qty=False,
        limit=25,
        db_id="main",
        _=_user(),
    )

    assert calls == [{
        "db_id": "main",
        "type_no": 20,
        "model_name": "HP 85A",
        "branch_no": 17,
        "loc_no": "room-a",
        "only_positive_qty": False,
        "limit": 25,
    }]
    assert result == [{
        "id": 77,
        "inv_no": "C-100",
        "type_no": 20,
        "type_name": "Cartridge",
        "model_no": 88,
        "model_name": "HP 85A",
        "qty": 12,
        "branch_no": 17,
        "branch_name": "Tyumen",
        "loc_no": 203,
        "location_name": "Storage",
        "part_no": "CE285A",
        "description": "Toner cartridge",
    }]
