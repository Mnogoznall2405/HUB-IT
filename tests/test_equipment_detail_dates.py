import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


class _Db:
    def __init__(self):
        self.queries = []

    def execute_query(self, query, params=None):
        self.queries.append(query)
        return [{"inv_no": 1}]


def _patch_db(monkeypatch):
    db = _Db()
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: db)
    return db


def _columns(*names):
    return [{"column_name": name} for names_row in [names] for name in names_row]


def test_detail_query_selects_optional_date_and_user_columns(monkeypatch):
    db = _patch_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "_get_table_columns",
        lambda table, db_id=None: _columns(
            "IP_ADDRESS", "MAC_ADDRESS", "NETBIOS_NAME", "DOMAIN_NAME",
            "CREATE_DATE", "CH_DATE", "CH_USER",
        ) if table == "ITEMS" else [],
    )

    assert db_queries.get_equipment_by_inv("1") == {"inv_no": 1}

    sql = db.queries[0]
    assert "i.CREATE_DATE as date_create" in sql
    assert "i.CH_DATE as date_last_modify" in sql
    assert "i.CH_USER as ch_user" in sql


def test_detail_query_falls_back_to_second_candidates(monkeypatch):
    db = _patch_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "_get_table_columns",
        lambda table, db_id=None: _columns("DATE_CREATE", "DATE_LAST_MODIFY", "CH_USER") if table == "ITEMS" else [],
    )

    assert db_queries.get_equipment_by_inv("1") == {"inv_no": 1}

    sql = db.queries[0]
    assert "i.DATE_CREATE as date_create" in sql
    assert "i.DATE_LAST_MODIFY as date_last_modify" in sql
    assert "i.CH_USER as ch_user" in sql


def test_detail_query_omits_missing_columns_without_failing(monkeypatch):
    db = _patch_db(monkeypatch)
    monkeypatch.setattr(
        db_queries,
        "_get_table_columns",
        lambda table, db_id=None: _columns("IP_ADDRESS", "MAC_ADDRESS") if table == "ITEMS" else [],
    )

    assert db_queries.get_equipment_by_inv("1") == {"inv_no": 1}

    sql = db.queries[0]
    assert "date_create" not in sql
    assert "date_last_modify" not in sql
    assert "ch_user" not in sql


def test_detail_query_omits_columns_when_metadata_lookup_fails(monkeypatch):
    db = _patch_db(monkeypatch)

    def raise_lookup(table, db_id=None):
        raise RuntimeError("INFORMATION_SCHEMA unavailable")

    monkeypatch.setattr(db_queries, "_get_table_columns", raise_lookup)

    assert db_queries.get_equipment_by_inv("1") == {"inv_no": 1}

    sql = db.queries[0]
    assert "date_create" not in sql
    assert "date_last_modify" not in sql
    assert "ch_user" not in sql
