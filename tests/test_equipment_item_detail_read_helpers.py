from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


class FakeDB:
    def __init__(self, responses=None, *, fail_first=False):
        self.calls = []
        self._responses = list(responses or [])
        self._fail_first = fail_first

    def execute_query(self, query, params=None):
        self.calls.append((query, params))
        if self._fail_first:
            self._fail_first = False
            raise RuntimeError("primary query failed")
        return self._responses.pop(0) if self._responses else []


def test_equipment_detail_uses_schema_aliases_and_late_bound_dependencies(monkeypatch):
    equipment_row = {"id": 10, "inv_no": 1001, "mac_address": "AA:BB"}
    fake_db = FakeDB([[equipment_row]])
    db_ids = []
    column_calls = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    def fake_get_table_columns(table_name, db_id=None):
        column_calls.append((table_name, db_id))
        return [
            {"column_name": "IP_ADDRESS"},
            {"column_name": "MAC_ADDR"},
            {"column_name": "HOSTNAME"},
            {"column_name": "NET_DOMAIN"},
        ]

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)
    monkeypatch.setattr(db_queries, "_get_table_columns", fake_get_table_columns)

    assert db_queries.get_equipment_by_inv("1001", db_id="main") == equipment_row

    assert db_ids == ["main"]
    assert column_calls == [("ITEMS", "main")]
    query, params = fake_db.calls[0]
    assert params == (1001.0,)
    assert "i.MAC_ADDR as mac_address" in query
    assert "i.HOSTNAME as network_name" in query
    assert "i.NET_DOMAIN as domain_name" in query


def test_equipment_detail_falls_back_to_legacy_query_shape(monkeypatch):
    fallback_row = {"id": 20, "inv_no": 2002, "mac_address": None}
    fake_db = FakeDB([[fallback_row]], fail_first=True)

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)
    monkeypatch.setattr(
        db_queries,
        "_get_table_columns",
        lambda table_name, db_id=None: [{"column_name": "IP_ADDRESS"}],
    )

    assert db_queries.get_equipment_by_inv("2002", db_id="main") == fallback_row

    assert len(fake_db.calls) == 2
    assert fake_db.calls[0][1] == (2002.0,)
    assert fake_db.calls[1][1] == (2002.0,)
    assert "NULL as mac_address" in fake_db.calls[1][0]
    assert fake_db.calls[1][0] == db_queries.QUERY_GET_EQUIPMENT_BY_INV


def test_batch_item_reads_normalize_ids_tokens_and_late_bound_get_db(monkeypatch):
    fake_db = FakeDB([[{"item_id": 7}], [{"item_id": 8}]])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.get_equipment_items_by_ids([7, "7", "bad", 0, 8], db_id="main") == [{"item_id": 7}]
    assert db_queries.get_equipment_items_by_inv_nos([" 001.0 ", "№ABC", "001", "", None], db_id="main") == [
        {"item_id": 8}
    ]

    assert db_ids == ["main", "main"]
    ids_query, ids_params = fake_db.calls[0]
    assert ids_params == (7, 8)
    assert "i.ID IN (?, ?)" in ids_query

    inv_query, inv_params = fake_db.calls[1]
    assert inv_params == ("1", "ABC", 1)
    assert "UPPER(CAST(i.INV_NO AS VARCHAR(64))) IN (?, ?)" in inv_query
    assert "TRY_CONVERT(BIGINT, i.INV_NO) IN (?)" in inv_query


def test_transfer_act_batch_read_normalizes_tokens_without_opening_db_for_empty_input(monkeypatch):
    fake_db = FakeDB([[{"id": 11, "inv_no": "1001"}]])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_transfer_act_items_by_inv_nos([], db_id="main") == []
    assert db_queries.get_transfer_act_items_by_inv_nos(["1001", "1001.0", " №ABC "], db_id="main") == [
        {"id": 11, "inv_no": "1001"}
    ]

    assert len(fake_db.calls) == 1
    query, params = fake_db.calls[0]
    assert params == ("1001", "ABC", 1001)
    assert "i.EMPL_NO AS empl_no" in query
    assert "TRY_CONVERT(BIGINT, i.INV_NO) IN (?)" in query
