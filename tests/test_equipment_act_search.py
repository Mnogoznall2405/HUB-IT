from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.database.equipment_act_history_reads import search_equipment_acts  # noqa: E402


class FakeDB:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def execute_query(self, query, params=None):
        self.calls.append((query, tuple(params or ())))
        return self._responses.pop(0) if self._responses else []


def test_search_equipment_acts_returns_empty_for_short_query():
    fake_db = FakeDB()

    def fake_get_db(db_id=None):
        return fake_db

    result = search_equipment_acts("a", db_id="main", get_db_fn=fake_get_db)

    assert result == {"query": "a", "total": 0, "acts": [], "truncated": False}
    assert fake_db.calls == []


def test_search_equipment_acts_matches_doc_number_and_enriches_type_name(monkeypatch):
    search_rows = [
        {
            "doc_no": 501,
            "doc_number": "Акт перемещения 501",
            "doc_date": "2026-01-10",
            "TYPE_NO": 7,
            "branch_name": "MSK",
            "location_name": "Office",
            "employee_name": "Иванов И.И.",
            "item_id": 11,
            "inv_no": "1001",
            "serial_no": "SN-1",
            "model_name": "HP 400",
        }
    ]
    fake_db = FakeDB(
        [
            search_rows,
            [{"ref_table": "DOC_TYPES", "ref_column": "TYPE_NO"}],
            [{"has_type_name": 1, "has_descr": 0}],
            [{"type_no": 7, "type_name": "Акт перемещения"}],
            [{"doc_no": 501}],
        ]
    )

    def fake_get_db(db_id=None):
        return fake_db

    result = search_equipment_acts("перемещ", db_id="main", get_db_fn=fake_get_db)

    assert result["query"] == "перемещ"
    assert result["total"] == 1
    assert result["acts"][0]["doc_no"] == 501
    assert result["acts"][0]["type_name"] == "Акт перемещения"
    assert result["acts"][0]["has_file"] is True
    assert result["acts"][0]["items"] == [
        {
            "item_id": 11,
            "inv_no": "1001",
            "serial_no": "SN-1",
            "model_name": "HP 400",
        }
    ]

    search_query, search_params = fake_db.calls[0]
    assert "%перемещ%" in search_params[0]
    assert "FROM DOCS d" in search_query
    assert "INNER JOIN DOCS_LIST dl" in search_query
    assert "NOT LIKE N'%аннулир%'" in search_query


def test_search_equipment_acts_matches_inventory_number_and_groups_items(monkeypatch):
    search_rows = [
        {
            "doc_no": 900,
            "doc_number": "Акт 900",
            "doc_date": "2026-02-01",
            "TYPE_NO": 3,
            "branch_name": "SPB",
            "location_name": "Floor 2",
            "employee_name": "Петров П.П.",
            "item_id": 21,
            "inv_no": "2002",
            "serial_no": "SN-A",
            "model_name": "Dell 7090",
        },
        {
            "doc_no": 900,
            "doc_number": "Акт 900",
            "doc_date": "2026-02-01",
            "TYPE_NO": 3,
            "branch_name": "SPB",
            "location_name": "Floor 2",
            "employee_name": "Петров П.П.",
            "item_id": 22,
            "inv_no": "2003",
            "serial_no": "SN-B",
            "model_name": "Dell 7090",
        },
    ]
    fake_db = FakeDB([search_rows, [], [{"doc_no": 900}]])

    def fake_get_db(db_id=None):
        return fake_db

    result = search_equipment_acts("2002", db_id="archive", get_db_fn=fake_get_db)

    assert result["total"] == 1
    assert len(result["acts"][0]["items"]) == 2
    assert {item["inv_no"] for item in result["acts"][0]["items"]} == {"2002", "2003"}

    search_query, search_params = fake_db.calls[0]
    assert "%2002%" in search_params[2]


def test_search_equipment_acts_supports_numeric_doc_no_lookup():
    fake_db = FakeDB([[], []])

    def fake_get_db(db_id=None):
        return fake_db

    search_equipment_acts("12345", db_id="main", get_db_fn=fake_get_db)

    _, search_params = fake_db.calls[0]
    assert 12345 in search_params


def test_queries_wrapper_delegates_to_act_history_search(monkeypatch):
    calls = []

    def fake_search(q, *, limit=50, db_id=None, get_db_fn=None):
        calls.append((q, limit, db_id))
        return {"query": q, "total": 0, "acts": [], "truncated": False}

    monkeypatch.setattr(
        "backend.database.queries._act_history_search_equipment_acts",
        fake_search,
    )

    result = db_queries.search_equipment_acts("акт 10", limit=25, db_id="main")

    assert result["query"] == "акт 10"
    assert calls == [("акт 10", 25, "main")]
