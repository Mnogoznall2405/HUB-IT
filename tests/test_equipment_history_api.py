from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402


@pytest.fixture
def equipment_history_env():
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    current_user = SimpleNamespace(username="operator", role="operator", is_active=True)
    app.dependency_overrides[deps.get_current_active_user] = lambda: current_user
    app.dependency_overrides[deps.get_current_database_id] = lambda: "main"

    return TestClient(app)


class _FakeHistoryDB:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute_query(self, query, params=()):
        self.calls.append((query, tuple(params or ())))
        return self.rows


def test_get_equipment_history_by_inv_reads_ci_history_by_item_id(monkeypatch):
    rows = [
        {
            "hist_id": 9,
            "item_id": 77,
            "old_employee_name": "Old Holder",
            "new_employee_name": "New Holder",
            "old_branch_name": "Old Branch",
            "new_branch_name": "New Branch",
            "old_location_name": "Old Room",
            "new_location_name": "New Room",
            "ch_user": "web",
            "ch_comment": "move",
        }
    ]
    fake_db = _FakeHistoryDB(rows)

    monkeypatch.setattr(db_queries, "get_equipment_by_inv", lambda inv_no, db_id=None: {"id": 77})
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    result = db_queries.get_equipment_history_by_inv("1001", db_id="main")

    assert result == {"item_id": 77, "history": rows}
    assert fake_db.calls[0][1] == (77,)
    assert "FROM CI_HISTORY" in fake_db.calls[0][0]
    assert "h.CH_DATE DESC" in fake_db.calls[0][0]


def test_get_equipment_history_by_inv_normalizes_empty_history(monkeypatch):
    fake_db = _FakeHistoryDB([])

    monkeypatch.setattr(db_queries, "get_equipment_by_inv", lambda inv_no, db_id=None: {"ID": 77})
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_equipment_history_by_inv("1001", db_id="main") == {
        "item_id": 77,
        "history": [],
    }


def test_equipment_history_route_returns_history(monkeypatch, equipment_history_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "get_equipment_by_inv",
        lambda inv_no, db_id=None: {"id": 77, "inv_no": inv_no},
    )
    monkeypatch.setattr(
        equipment_api.queries,
        "get_equipment_history_by_inv",
        lambda inv_no, db_id=None: {
            "item_id": 77,
            "history": [{"hist_id": 1, "old_employee_name": "Old", "new_employee_name": "New"}],
        },
    )

    response = equipment_history_env.get("/equipment/1001/history")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "inv_no": "1001",
        "item_id": 77,
        "total": 1,
        "history": [{"hist_id": 1, "old_employee_name": "Old", "new_employee_name": "New"}],
    }


def test_equipment_history_route_returns_not_found(monkeypatch, equipment_history_env):
    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", lambda inv_no, db_id=None: None)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("history helper must not be called for missing equipment")

    monkeypatch.setattr(equipment_api.queries, "get_equipment_history_by_inv", fail_if_called)

    response = equipment_history_env.get("/equipment/404/history")

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Equipment with inventory number 404 not found"
