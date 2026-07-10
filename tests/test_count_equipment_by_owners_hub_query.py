from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.database import queries as db_queries  # noqa: E402


def test_count_prefers_part_no_and_allows_model_without_part(monkeypatch):
    fake_db = MagicMock()
    fake_db.execute_query.return_value = [{"owner_no": 10, "hub_count": 1}]
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    counts = db_queries.count_equipment_by_owners_hub_query(
        [10],
        part_no="PN-111",
        part_nos=["PN-1C"],
        model_name="Dell P2419H",
    )

    assert counts[10] == 1
    sql, params = fake_db.execute_query.call_args[0]
    assert "PART_NO" in sql
    assert "MODEL_NAME" in sql
    assert "LIKE ?" in sql
    assert params[0] == 10
    assert "pn-111" in params
    assert "pn-1c" in params
    assert "%dell p2419h%" in params


def test_count_model_only_when_part_no_missing(monkeypatch):
    fake_db = MagicMock()
    fake_db.execute_query.return_value = [{"owner_no": 10, "hub_count": 2}]
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    counts = db_queries.count_equipment_by_owners_hub_query(
        [10],
        part_no="не найден",
        model_name="Dell P2419H",
    )

    assert counts[10] == 2
    sql, params = fake_db.execute_query.call_args[0]
    assert "MODEL_NAME" in sql
    assert params == (10, "%dell p2419h%")
    assert "LIKE ?" in sql
