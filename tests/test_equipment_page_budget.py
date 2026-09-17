"""Performance budget for the Database page hot path (robustness plan, stage 8).

Pinned budgets — a regression that adds queries to the initial page load or
turns the act batch into per-row lookups must turn this test red:

- GET /equipment/all-grouped (list): exactly 2 SQL — COUNT + page.
- Universal search: exactly 2 SQL — COUNT + page.
- POST /equipment/current-acts batch: 1 SQL per <=1800 ids (set-based
  chunked lookup, never per-item).
- Directory/database selection resolution: 0 SQL inside the TTL window
  (covered by settings service tests; here we only pin that the list path
  performs no extra reference reads).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


class CountingDB:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def execute_query(self, query, params=None):
        self.calls.append((query, params))
        return self._responses.pop(0) if self._responses else []


LIST_PAGE_BUDGET = 2        # COUNT + OFFSET/FETCH page
ACT_BATCH_BUDGET = 1        # one set-based query per <=1800 ids
ACT_BATCH_CHUNK = 1800


def test_grouped_list_stays_within_two_queries(monkeypatch):
    from backend.database import equipment_db

    fake_db = CountingDB([[{"total": 1}], [{"ID": 1, "INV_NO": 7}]])
    monkeypatch.setattr(equipment_db, "get_db", lambda db_id=None: fake_db)
    monkeypatch.setattr(equipment_db, "get_equipment_data_version", lambda db_id=None: 0)

    equipment_db.get_equipment_grouped(page=1, limit=50, db_id="main")

    assert len(fake_db.calls) <= LIST_PAGE_BUDGET
    for query, _params in fake_db.calls:
        assert "DOCS_LIST" not in query, "act enrich CTE leaked into the list path"


def test_universal_search_stays_within_two_queries(monkeypatch):
    from backend.database import queries as db_queries

    fake_db = CountingDB([[{"total": 5}], [{"inv_no": "1001"}]])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    db_queries.search_equipment_universal("1001", page=1, limit=200, db_id="main")

    assert len(fake_db.calls) <= LIST_PAGE_BUDGET


def test_current_act_lookup_is_set_based_not_per_item():
    """2000 item ids must cost ceil(2000/1800)=2 queries, never one per item."""
    from backend.database import equipment_current_act_reads

    fake_db = CountingDB()
    result = equipment_current_act_reads.lookup_current_acts(
        range(1, 2001), "main", get_db_fn=lambda db_id=None: fake_db
    )

    assert result == {}
    expected = -(-2000 // ACT_BATCH_CHUNK)  # ceil
    assert len(fake_db.calls) == expected
    for _query, params in fake_db.calls:
        assert len(params) <= ACT_BATCH_CHUNK


def test_current_act_lookup_small_batch_is_single_query():
    from backend.database import equipment_current_act_reads

    fake_db = CountingDB()
    equipment_current_act_reads.lookup_current_acts(
        [1, 2, 3], "main", get_db_fn=lambda db_id=None: fake_db
    )

    assert len(fake_db.calls) == ACT_BATCH_BUDGET
