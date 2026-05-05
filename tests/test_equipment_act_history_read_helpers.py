from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


class FakeDB:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def execute_query(self, query, params=None):
        self.calls.append((query, tuple(params or ())))
        return self._responses.pop(0) if self._responses else []


def test_act_and_history_reads_return_empty_payload_for_missing_equipment(monkeypatch):
    equipment_calls = []

    def fake_get_equipment_by_inv(inv_no, db_id=None):
        equipment_calls.append((inv_no, db_id))
        return None

    def fail_get_db(db_id=None):
        raise AssertionError("missing equipment should not open a database connection")

    monkeypatch.setattr(db_queries, "get_equipment_by_inv", fake_get_equipment_by_inv)
    monkeypatch.setattr(db_queries, "get_db", fail_get_db)

    assert db_queries.get_equipment_acts_by_inv("404", db_id="main") == {"item_id": None, "acts": []}
    assert db_queries.get_equipment_history_by_inv("404", db_id="main") == {"item_id": None, "history": []}
    assert equipment_calls == [("404", "main"), ("404", "main")]


def test_get_equipment_acts_by_inv_reads_docs_by_item_id_and_enriches_type_name(monkeypatch):
    act_rows = [
        {
            "doc_no": 9001,
            "doc_number": "A-9001",
            "TYPE_NO": 12,
            "employee_name": "Old Owner",
        }
    ]
    fake_db = FakeDB(
        [
            act_rows,
            [{"ref_table": "DOC_TYPES", "ref_column": "TYPE_NO"}],
            [{"has_type_name": 1, "has_descr": 0}],
            [{"type_no": 12, "type_name": "Transfer act"}],
        ]
    )
    db_ids = []
    equipment_calls = []

    def fake_get_equipment_by_inv(inv_no, db_id=None):
        equipment_calls.append((inv_no, db_id))
        return {"ID": "77"}

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_equipment_by_inv", fake_get_equipment_by_inv)
    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    result = db_queries.get_equipment_acts_by_inv("1001", db_id="archive")

    assert result == {
        "item_id": 77,
        "acts": [
            {
                "doc_no": 9001,
                "doc_number": "A-9001",
                "TYPE_NO": 12,
                "employee_name": "Old Owner",
                "type_name": "Transfer act",
            }
        ],
    }
    assert equipment_calls == [("1001", "archive")]
    assert db_ids == ["archive", "archive"]

    act_query, act_params = fake_db.calls[0]
    assert act_params == (77,)
    assert "FROM DOCS_LIST dl" in act_query
    assert "INNER JOIN DOCS d ON d.DOC_NO = dl.DOC_NO" in act_query
    assert "WHERE dl.ITEM_ID = ?" in act_query
    assert "d.DOC_DATE DESC" in act_query
    assert "d.CREATE_DATE DESC" in act_query
    assert "d.DOC_NO DESC" in act_query

    type_lookup_query, type_lookup_params = fake_db.calls[3]
    assert type_lookup_params == (12,)
    assert "FROM [DOC_TYPES] t" in type_lookup_query
    assert "t.[TYPE_NO] IN (?)" in type_lookup_query


def test_get_equipment_history_by_inv_preserves_ci_history_query_shape_and_params(monkeypatch):
    history_rows = [
        {
            "hist_id": 33,
            "item_id": 88,
            "old_employee_name": "Old Owner",
            "new_employee_name": "New Owner",
        }
    ]
    fake_db = FakeDB([history_rows])
    db_ids = []
    equipment_calls = []

    def fake_get_equipment_by_inv(inv_no, db_id=None):
        equipment_calls.append((inv_no, db_id))
        return {"id": "88"}

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_equipment_by_inv", fake_get_equipment_by_inv)
    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    result = db_queries.get_equipment_history_by_inv("1002", db_id="archive")

    assert result == {"item_id": 88, "history": history_rows}
    assert equipment_calls == [("1002", "archive")]
    assert db_ids == ["archive"]

    history_query, history_params = fake_db.calls[0]
    assert history_params == (88,)
    assert "FROM CI_HISTORY h" in history_query
    assert "WHERE h.ITEM_ID = ?" in history_query
    assert "old_owner.OWNER_DISPLAY_NAME AS old_employee_name" in history_query
    assert "new_owner.OWNER_DISPLAY_NAME AS new_employee_name" in history_query
    assert "h.CH_DATE DESC" in history_query
    assert "h.HIST_ID DESC" in history_query
