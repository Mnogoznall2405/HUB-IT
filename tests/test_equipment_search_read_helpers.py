from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402
from backend.models.equipment import EmployeeSearchResponse, EquipmentListResponse  # noqa: E402


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
    fake_db = FakeDB([serial_rows, count_rows, universal_rows, count_rows, employee_rows, owner_rows])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.search_equipment_by_serial("SN-1001", db_id="main") == serial_rows
    assert db_queries.search_equipment_universal("Dell", page=3, limit=7, db_id="main") == {
        "equipment": universal_rows,
        "total": 3,
        "page": 3,
        "pages": 1,
    }
    employee_result = db_queries.search_employees("User", page=2, limit=10, db_id="main")
    assert employee_result == {
        "employees": [
            {
                "owner_no": 501,
                "name": "User",
                "department": None,
                "email": None,
                "equipment_count": 2,
            }
        ],
        "total": 3,
        "page": 2,
        "limit": 10,
        "pages": 1,
    }
    assert EmployeeSearchResponse(**employee_result).employees[0].owner_no == 501
    assert db_queries.get_equipment_by_owner(501, db_id="main") == owner_rows

    assert db_ids == ["main", "main", "main", "main", "main"]
    assert fake_db.calls == [
        (db_queries.QUERY_SEARCH_BY_SERIAL.format(limit=200), ("%SN-1001%", "%SN-1001%", "%SN-1001%")),
        (db_queries.QUERY_COUNT_UNIVERSAL, ("%Dell%",) * 16),
        (db_queries.QUERY_SEARCH_UNIVERSAL, ("%Dell%",) * 16 + (14, 7)),
        (db_queries.QUERY_COUNT_EMPLOYEES, ("%User%", "%User%")),
        (db_queries.QUERY_SEARCH_BY_EMPLOYEE, ("%User%", "%User%", 10, 10)),
        (db_queries.QUERY_GET_EQUIPMENT_BY_OWNER, (501,)),
    ]


def test_equipment_list_normalizes_legacy_odbc_column_names(monkeypatch):
    fake_db = FakeDB(
        [
            [{"total": 1}],
            [
                {
                    "INV_NO": 100001.0,
                    "SERIAL_NO": "SN-100001",
                    "type_name": "Ноутбук",
                    "model_name": "Test Model",
                }
            ],
        ]
    )
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.get_all_equipment(page=1, limit=50, db_id="main")

    assert result["equipment"] == [
        {
            "inv_no": "100001",
            "serial_no": "SN-100001",
            "type_name": "Ноутбук",
            "model_name": "Test Model",
        }
    ]
    assert EquipmentListResponse(**result).equipment[0].inv_no == "100001"
    assert fake_db.calls == [
        (db_queries.QUERY_COUNT_ALL_EQUIPMENT, None),
        (db_queries.QUERY_GET_ALL_EQUIPMENT, (0, 50)),
    ]


def test_universal_equipment_search_preserves_error_fallback(monkeypatch):
    fake_db = FakeDB(exc=RuntimeError("sql down"))

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.search_equipment_universal("monitor", page=9, limit=4, db_id="main") == {
        "equipment": [],
        "total": 0,
        "page": 9,
        "pages": 0,
    }
    assert fake_db.calls == [
        (db_queries.QUERY_COUNT_UNIVERSAL, ("%monitor%",) * 16),
    ]


def test_get_equipment_items_by_inv_nos_single_full_card_query(monkeypatch):
    fake_db = FakeDB([[{"item_id": 7, "inv_no": "1"}]])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    rows = db_queries.get_equipment_items_by_inv_nos(["001", "INV/2"], db_id="main")

    assert rows == [{"item_id": 7, "inv_no": "1"}]
    assert db_ids == ["main"]
    assert len(fake_db.calls) == 1
    query, params = fake_db.calls[0]
    assert params == ("INV/2", 1)
    for alias in (
        "AS item_id",
        "AS id",
        "AS inv_no",
        "AS serial_no",
        "AS part_no",
        "AS type_name",
        "AS model_name",
        "AS vendor_name",
        "AS status",
        "AS employee_name",
        "AS employee_dept",
        "AS branch_name",
        "AS location",
        "AS DESCRIPTION",
        "i.IP_ADDRESS AS ip_address",
        "i.MAC_ADDRESS AS mac_address",
        "i.NETBIOS_NAME AS network_name",
        "i.DOMAIN_NAME AS domain_name",
    ):
        assert alias in query
    for null_alias in (
        "NULL AS mac_address",
        "NULL AS network_name",
        "NULL AS domain_name",
    ):
        assert null_alias not in query
    assert "UPPER(CAST(i.INV_NO AS VARCHAR(64))) IN (?)" in query
    assert "i.INV_NO IN (?)" in query
    assert "TRY_CONVERT(BIGINT, i.INV_NO) IN" not in query
    assert "ORDER BY TRY_CONVERT(BIGINT, i.INV_NO), i.ID" in query


def test_get_transfer_act_items_by_inv_nos_single_sargable_query(monkeypatch):
    fake_db = FakeDB([[{"id": 7, "inv_no": "1"}]])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    rows = db_queries.get_transfer_act_items_by_inv_nos(["001", "INV/2"], db_id="main")

    assert rows == [{"id": 7, "inv_no": "1"}]
    assert db_ids == ["main"]
    assert len(fake_db.calls) == 1
    query, params = fake_db.calls[0]
    assert params == ("INV/2", 1)
    assert "UPPER(CAST(i.INV_NO AS VARCHAR(64))) IN (?)" in query
    assert "i.INV_NO IN (?)" in query
    assert "TRY_CONVERT(BIGINT, i.INV_NO) IN" not in query
    assert "ORDER BY TRY_CONVERT(BIGINT, i.INV_NO), i.ID" in query


def test_equipment_grouped_caches_total_count_across_pages(monkeypatch):
    from backend.database import equipment_db
    from backend.database import queries_new

    equipment_db.invalidate_equipment_cache()
    recorded = []

    class PagingDB:
        def execute_query(self, query, params=None):
            recorded.append(query)
            if query == queries_new.QUERY_COUNT_ALL_EQUIPMENT:
                return [{"total": 5}]
            return []

    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: PagingDB())
    monkeypatch.setattr(
        equipment_db,
        "enrich_equipment_current_acts",
        lambda rows, db_id=None, get_db_fn=None: rows,
    )

    for page in (1, 2, 3):
        payload = equipment_db.get_equipment_grouped(page=page, limit=10, db_id="main")
        assert payload["total"] == 5
        assert payload["page"] == page

    count_queries = [q for q in recorded if q == queries_new.QUERY_COUNT_ALL_EQUIPMENT]
    page_queries = [q for q in recorded if q == queries_new.QUERY_GET_EQUIPMENT_GROUPED]
    assert len(count_queries) == 1
    assert len(page_queries) == 3

    equipment_db.invalidate_equipment_cache("main")
    equipment_db.get_equipment_grouped(page=1, limit=10, db_id="main")
    count_queries = [q for q in recorded if q == queries_new.QUERY_COUNT_ALL_EQUIPMENT]
    assert len(count_queries) == 2


def test_grouped_pagination_queries_have_deterministic_id_tiebreaker():
    from backend.database import queries_new

    for query in (
        queries_new.QUERY_GET_ALL_EQUIPMENT,
        queries_new.QUERY_GET_EQUIPMENT_GROUPED,
        queries_new.QUERY_GET_EQUIPMENT_GROUPED_ALL,
        queries_new.QUERY_GET_CONSUMABLES_GROUPED,
        queries_new.QUERY_GET_EQUIPMENT_BY_BRANCH,
    ):
        assert ", i.ID" in query.split("ORDER BY")[-1]


def test_pyodbc_pool_failed_create_does_not_leak_created_slots(monkeypatch):
    from backend.database import connection as db_connection

    pool = db_connection._PyodbcConnectionPool("DSN=test", pool_size=1)
    attempts = []

    def failing_create():
        attempts.append(1)
        raise RuntimeError("connect failed")

    monkeypatch.setattr(pool, "_create_connection", failing_create)

    with pytest.raises(RuntimeError):
        pool.acquire()
    assert pool._created == 0

    with pytest.raises(RuntimeError):
        pool.acquire()
    assert pool._created == 0
    assert len(attempts) == 2
