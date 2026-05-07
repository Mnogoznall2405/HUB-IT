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
        self.calls.append((query, params))
        return self._responses.pop(0) if self._responses else []


def test_reference_read_helpers_preserve_public_shapes_params_and_late_bound_get_db(monkeypatch):
    type_rows = [{"CI_TYPE": 1, "TYPE_NO": 10, "TYPE_NAME": "Notebook"}]
    status_rows = [
        {"STATUS_NO": 1, "STATUS_NAME": "In use"},
        {"status_no": 2, "status_name": "Stored"},
    ]
    status_row = [{"STATUS_NO": 3, "STATUS_NAME": "Repair"}]
    default_status_preferred_rows = []
    default_status_fallback_rows = [{"status_no": "4"}]
    type_row = [{"CI_TYPE": 4, "TYPE_NO": 20, "TYPE_NAME": "Toner"}]
    model_rows = [{"model_no": 88, "model_name": "HP 85A", "type_no": 20, "ci_type": 4}]
    model_no_rows = [{"MODEL_NO": "88"}]
    model_row = [{"CI_TYPE": 4, "TYPE_NO": 20, "MODEL_NO": 88, "MODEL_NAME": "HP 85A"}]
    owner_row = [{"OWNER_NO": 501, "OWNER_DISPLAY_NAME": "Test Owner", "OWNER_DEPT": "IT"}]
    owner_no_rows = [{"owner_no": "501"}]
    owner_email_rows = [{"OWNER_EMAIL": " owner@example.test "}]
    fake_db = FakeDB(
        [
            type_rows,
            status_rows,
            status_row,
            default_status_preferred_rows,
            default_status_fallback_rows,
            type_row,
            model_rows,
            model_no_rows,
            model_row,
            owner_row,
            owner_no_rows,
            owner_email_rows,
        ]
    )
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.get_all_equipment_types(db_id="main") == type_rows
    assert db_queries.get_all_statuses(db_id="main") == [
        {"status_no": 1, "status_name": "In use"},
        {"status_no": 2, "status_name": "Stored"},
    ]
    assert db_queries.get_status_by_no(3, db_id="main") == status_row[0]
    assert db_queries.get_default_status_no(db_id="main") == 4
    assert db_queries.get_type_by_no(20, db_id="main", ci_type=4) == type_row[0]
    assert db_queries.get_models_by_type(20, db_id="main", ci_type=4) == model_rows
    assert db_queries.get_model_no_by_name("HP 85A", ci_type=4, strict=True, db_id="main") == 88
    assert db_queries.get_model_by_no(88, db_id="main", ci_type=4) == model_row[0]
    assert db_queries.get_owner_by_no(501, db_id="main") == owner_row[0]
    assert db_queries.get_owner_no_by_name("Test Owner", strict=False, db_id="main") == 501
    assert db_queries.get_owner_email_by_no(501, db_id="main") == "owner@example.test"

    assert db_ids == ["main"] * 11
    assert fake_db.calls[0] == (db_queries.QUERY_GET_ALL_EQUIPMENT_TYPES, None)
    assert fake_db.calls[1] == (db_queries.QUERY_GET_ALL_STATUSES, None)
    assert fake_db.calls[2][1] == (3,)
    assert "FROM STATUS s" in fake_db.calls[2][0]
    assert fake_db.calls[3][1] == ()
    assert "LOWER(CAST(s.DESCR AS NVARCHAR(255)))" in fake_db.calls[3][0]
    assert fake_db.calls[4][1] == ()
    assert "ORDER BY s.STATUS_NO" in fake_db.calls[4][0]
    assert fake_db.calls[5][1] == (4, 20)
    assert "FROM CI_TYPES t" in fake_db.calls[5][0]
    assert fake_db.calls[6][1] == (4, 20)
    assert "FROM CI_MODELS m" in fake_db.calls[6][0]
    assert fake_db.calls[7][1] == (4, "HP 85A")
    assert "m.MODEL_NAME = ?" in fake_db.calls[7][0]
    assert fake_db.calls[8][1] == (4, 88)
    assert "WHERE m.CI_TYPE = ? AND m.MODEL_NO = ?" in fake_db.calls[8][0]
    assert fake_db.calls[9][1] == (501,)
    assert "FROM OWNERS o" in fake_db.calls[9][0]
    assert fake_db.calls[10][1] == ("%Test Owner%",)
    assert "o.OWNER_DISPLAY_NAME LIKE ?" in fake_db.calls[10][0]
    assert fake_db.calls[11][1] == (501,)
    assert "NULLIF(LTRIM(RTRIM(o.OWNER_EMAIL)), '')" in fake_db.calls[11][0]


def test_name_reference_lookups_do_not_open_db_for_empty_names(monkeypatch):
    def fail_get_db(db_id=None):
        raise AssertionError("empty reference name lookup should not open a database connection")

    monkeypatch.setattr(db_queries, "get_db", fail_get_db)

    assert db_queries.get_model_no_by_name("", db_id="main") is None
    assert db_queries.get_owner_no_by_name("", db_id="main") is None


def test_default_status_preferred_match_wins_without_fallback(monkeypatch):
    fake_db = FakeDB([[{"STATUS_NO": "7"}]])

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_default_status_no(db_id="main") == 7
    assert len(fake_db.calls) == 1
    assert "LOWER(CAST(s.DESCR AS NVARCHAR(255)))" in fake_db.calls[0][0]


def test_default_status_handles_missing_and_invalid_numeric_rows(monkeypatch):
    fake_db = FakeDB([[], [{"STATUS_NO": "not-a-number"}], [], []])

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_default_status_no(db_id="main") is None
    assert db_queries.get_default_status_no(db_id="main") is None


def test_reference_name_lookups_keep_strict_and_like_modes(monkeypatch):
    fake_db = FakeDB([[{"MODEL_NO": "88"}], [{"OWNER_NO": "501"}]])

    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_model_no_by_name("HP 85A", ci_type=4, strict=False, db_id="main") == 88
    assert db_queries.get_owner_no_by_name("Test Owner", strict=True, db_id="main") == 501

    assert fake_db.calls[0][1] == (4, "%HP 85A%")
    assert "m.MODEL_NAME LIKE ?" in fake_db.calls[0][0]
    assert fake_db.calls[1][1] == ("Test Owner",)
    assert "o.OWNER_DISPLAY_NAME = ?" in fake_db.calls[1][0]


def test_owner_search_helpers_preserve_query_contracts_and_late_bound_get_db(monkeypatch):
    owner_rows = [
        {"OWNER_NO": 1, "OWNER_DISPLAY_NAME": "Alice Smith", "OWNER_DEPT": "IT"},
        {"OWNER_NO": 2, "OWNER_DISPLAY_NAME": "Bob Jones", "OWNER_DEPT": "HR"},
    ]
    dept_rows = [
        {"OWNER_DEPT": " IT "},
        {"owner_dept": "HR"},
        {"OWNER_DEPT": ""},
        {"OWNER_DEPT": None},
    ]
    fake_db = FakeDB([owner_rows, dept_rows])
    db_ids = []

    def fake_get_db(db_id=None):
        db_ids.append(db_id)
        return fake_db

    monkeypatch.setattr(db_queries, "get_db", fake_get_db)

    assert db_queries.search_owners(" Alice ", limit=999, db_id="main") == owner_rows
    assert db_queries.get_owner_departments(limit=9999, db_id="main") == ["IT", "HR"]

    assert db_ids == ["main", "main"]
    assert fake_db.calls[0][1] == ("% Alice %", "% Alice %")
    assert "SELECT TOP 100" in fake_db.calls[0][0]
    assert "o.OWNER_DISPLAY_NAME LIKE ?" in fake_db.calls[0][0]
    assert "o.OWNER_DEPT LIKE ?" in fake_db.calls[0][0]
    assert "ORDER BY o.OWNER_DISPLAY_NAME" in fake_db.calls[0][0]
    assert fake_db.calls[1][1] == ()
    assert "SELECT DISTINCT TOP 2000" in fake_db.calls[1][0]
    assert "LTRIM(RTRIM(o.OWNER_DEPT))" in fake_db.calls[1][0]


def test_owner_search_limit_defaults_and_department_limit_floor(monkeypatch):
    fake_db = FakeDB([[], [], []])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.search_owners("term", limit=0, db_id="main") == []
    assert db_queries.search_owners("term", limit=-5, db_id="main") == []
    assert db_queries.get_owner_departments(limit=-5, db_id="main") == []

    assert "SELECT TOP 20" in fake_db.calls[0][0]
    assert fake_db.calls[0][1] == ("%term%", "%term%")
    assert "SELECT TOP 1" in fake_db.calls[1][0]
    assert fake_db.calls[1][1] == ("%term%", "%term%")
    assert "SELECT DISTINCT TOP 1" in fake_db.calls[2][0]
