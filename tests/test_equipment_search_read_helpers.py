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


def test_universal_equipment_search_propagates_db_error(monkeypatch):
    fake_db = FakeDB(exc=RuntimeError("sql down"))

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    # DB failures must surface so the frontend can flag degraded mode —
    # a silent empty page would read as "no matching equipment".
    with pytest.raises(RuntimeError, match="sql down"):
        db_queries.search_equipment_universal("monitor", page=9, limit=4, db_id="main")
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

    # The test asserts cache/paging behavior only — stub the data-version bump
    # so it doesn't hit the conftest sqlite app DB (which has no schema).
    monkeypatch.setattr(equipment_db, "bump_equipment_data_version", lambda db_id=None: 0)
    monkeypatch.setattr(equipment_db, "get_equipment_data_version", lambda db_id=None: 0)
    equipment_db.invalidate_equipment_cache()
    recorded = []

    class PagingDB:
        def execute_query(self, query, params=None):
            recorded.append(query)
            if query == queries_new.QUERY_COUNT_ALL_EQUIPMENT:
                return [{"total": 5}]
            return []

    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: PagingDB())
    # The list page must not run the current-act enrich CTE at all.
    from backend.database import equipment_current_act_reads
    monkeypatch.setattr(
        equipment_current_act_reads,
        "lookup_current_acts",
        lambda *args, **kwargs: pytest.fail("enrich must not run on the list path"),
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


def test_pyodbc_pool_pings_only_idle_connections(monkeypatch):
    """SELECT 1 runs only when the pooled conn sat idle past the threshold."""
    from backend.database import connection as db_connection

    pool = db_connection._PyodbcConnectionPool("DSN=test", pool_size=1, idle_ping_sec=30.0)

    class FakeCursor:
        def __init__(self, log):
            self._log = log
        def execute(self, _q):
            self._log.append("SELECT 1")
        def close(self):
            pass

    class FakeConn:
        def __init__(self):
            self.pings = []
        def cursor(self):
            return FakeCursor(self.pings)
        def close(self):
            pass

    conn = FakeConn()
    pool.release(conn)

    # Fresh borrow — no ping.
    assert pool.acquire() is conn
    assert conn.pings == []
    pool.release(conn)

    # Forced idle — ping required.
    _stored = pool._pool.get_nowait()
    pool._pool.put_nowait((_stored[0], _stored[1] - 60.0))
    assert pool.acquire() is conn
    assert conn.pings == ["SELECT 1"]


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


def test_get_equipment_items_by_ids_chunks_in_clause_under_param_limit(monkeypatch):
    fake_db = FakeDB(
        [
            [{"item_id": 1, "inv_no": "1"}],
            [{"item_id": 1, "inv_no": "1"}, {"item_id": 2, "inv_no": "2"}],
            [{"item_id": 3, "inv_no": "3"}],
        ]
    )
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    chunk = db_queries._IN_CLAUSE_CHUNK_SIZE
    item_ids = list(range(1, chunk * 2 + 101))
    rows = db_queries.get_equipment_items_by_ids(item_ids, db_id="main")

    assert len(fake_db.calls) == 3
    assert len(fake_db.calls[0][1]) == chunk
    assert len(fake_db.calls[1][1]) == chunk
    assert len(fake_db.calls[2][1]) == 100
    for query, _ in fake_db.calls:
        assert "i.ID IN (" in query
    # Duplicate rows returned by overlapping chunks are merged once.
    assert [row["item_id"] for row in rows] == [1, 2, 3]


def test_create_uploaded_transfer_act_rejects_oversized_item_list():
    with pytest.raises(ValueError, match="Too many equipment items"):
        db_queries.create_uploaded_transfer_act(
            from_employee="From",
            to_employee="To",
            doc_date=None,
            equipment_item_ids=list(range(1, db_queries._IN_CLAUSE_CHUNK_SIZE + 2)),
            file_name="act.pdf",
            file_bytes=b"pdf-bytes",
        )


def test_equipment_payload_cache_evicts_oldest_beyond_cap(monkeypatch):
    from backend.database import equipment_db

    monkeypatch.setattr(equipment_db, "_EQUIPMENT_PAYLOAD_CACHE_MAX_ENTRIES", 3)
    for idx in range(5):
        equipment_db._set_cached_equipment_payload(f"key-{idx}", {"v": idx})

    assert list(equipment_db._equipment_payload_cache.keys()) == ["key-2", "key-3", "key-4"]

    # A hit promotes key-2 to newest — the next insert evicts key-3 instead.
    assert equipment_db._get_cached_equipment_payload("key-2") == {"v": 2}
    equipment_db._set_cached_equipment_payload("key-5", {"v": 5})
    assert list(equipment_db._equipment_payload_cache.keys()) == ["key-4", "key-2", "key-5"]
