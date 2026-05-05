from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


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


def test_equipment_search_helpers_preserve_query_params_and_shapes(monkeypatch):
    serial_rows = [{"INV_NO": "1001", "SERIAL_NO": "SN-1001"}]
    universal_rows = [{"inv_no": "1002", "model_name": "Dell P2422H"}]
    count_rows = [{"total": 3}]
    employee_rows = [{"OWNER_NO": 501, "OWNER_DISPLAY_NAME": "User", "equipment_count": 2}]
    owner_rows = [{"INV_NO": "1003", "model_name": "Latitude"}]
    fake_db = FakeDB([serial_rows, universal_rows, count_rows, employee_rows, owner_rows])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.search_equipment_by_serial("SN-1001", db_id="main") == serial_rows
    assert db_queries.search_equipment_universal("Dell", page=3, limit=7, db_id="main") == {
        "equipment": universal_rows,
        "total": 1,
        "page": 1,
        "pages": 1,
    }
    assert db_queries.search_employees("User", page=2, limit=10, db_id="main") == {
        "employees": employee_rows,
        "total": 3,
        "page": 2,
        "limit": 10,
        "pages": 1,
    }
    assert db_queries.get_equipment_by_owner(501, db_id="main") == owner_rows

    assert db_ids == ["main", "main", "main", "main"]
    assert fake_db.calls == [
        (db_queries.QUERY_SEARCH_BY_SERIAL, ("%SN-1001%", "%SN-1001%", "%SN-1001%")),
        (db_queries.QUERY_SEARCH_UNIVERSAL.format(limit=7), ("%Dell%",) * 15),
        (db_queries.QUERY_COUNT_EMPLOYEES, ("%User%", "%User%")),
        (db_queries.QUERY_SEARCH_BY_EMPLOYEE, ("%User%", "%User%", 10, 10)),
        (db_queries.QUERY_GET_EQUIPMENT_BY_OWNER, (501,)),
    ]


def test_universal_equipment_search_preserves_error_fallback(monkeypatch):
    fake_db = FakeDB(exc=RuntimeError("sql down"))

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.search_equipment_universal("monitor", page=9, limit=4, db_id="main") == {
        "equipment": [],
        "total": 0,
        "page": 1,
        "pages": 1,
    }
    assert fake_db.calls == [
        (db_queries.QUERY_SEARCH_UNIVERSAL.format(limit=4), ("%monitor%",) * 15),
    ]
