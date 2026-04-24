from __future__ import annotations

import sys
from contextlib import contextmanager
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
def equipment_delete_env():
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    current = {"user": SimpleNamespace(username="admin", role="admin", is_active=True)}

    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_current_database_id] = lambda: "main"

    return {
        "client": TestClient(app),
        "set_user": lambda role: current.__setitem__(
            "user",
            SimpleNamespace(username=role, role=role, is_active=True),
        ),
    }


def test_delete_equipment_route_allows_admin_success(monkeypatch, equipment_delete_env):
    calls = []

    def fake_delete(inv_no, db_id=None):
        calls.append((inv_no, db_id))
        return {"success": True, "inv_no": "1001", "item_id": 77, "message": "Equipment deleted"}

    monkeypatch.setattr(equipment_api.queries, "delete_equipment_by_inv", fake_delete)

    response = equipment_delete_env["client"].delete("/equipment/1001")

    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert calls == [("1001", "main")]


def test_delete_equipment_route_rejects_non_admin_before_query(monkeypatch, equipment_delete_env):
    equipment_delete_env["set_user"]("operator")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("delete helper must not be called for non-admin users")

    monkeypatch.setattr(equipment_api.queries, "delete_equipment_by_inv", fail_if_called)

    response = equipment_delete_env["client"].delete("/equipment/1001")

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Admin privileges required"


def test_delete_equipment_route_returns_not_found(monkeypatch, equipment_delete_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "delete_equipment_by_inv",
        lambda inv_no, db_id=None: {
            "success": False,
            "code": "not_found",
            "message": "Equipment with INV_NO 1001 not found",
        },
    )

    response = equipment_delete_env["client"].delete("/equipment/1001")

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Equipment with INV_NO 1001 not found"


def test_delete_equipment_route_returns_conflict_for_dependencies(monkeypatch, equipment_delete_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "delete_equipment_by_inv",
        lambda inv_no, db_id=None: {
            "success": False,
            "code": "has_dependencies",
            "message": "Equipment is linked to acts or history and cannot be deleted (acts=1, history=2)",
        },
    )

    response = equipment_delete_env["client"].delete("/equipment/1001")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Equipment is linked to acts or history and cannot be deleted (acts=1, history=2)"


class _FakeCursor:
    def __init__(self, *, item_row=None, docs_count=0, history_count=0, delete_rowcount=1):
        self.item_row = item_row
        self.docs_count = docs_count
        self.history_count = history_count
        self.delete_rowcount = delete_rowcount
        self.executed: list[tuple[str, tuple]] = []
        self.rowcount = 0
        self._fetchone = None

    def execute(self, query, params=()):
        normalized = " ".join(str(query).split()).upper()
        self.executed.append((normalized, tuple(params or ())))
        if "SELECT TOP 1 ID, INV_NO FROM ITEMS" in normalized:
            self._fetchone = self.item_row
            return
        if "SELECT COUNT(1) FROM DOCS_LIST" in normalized:
            self._fetchone = (self.docs_count,)
            return
        if "SELECT COUNT(1) FROM CI_HISTORY" in normalized:
            self._fetchone = (self.history_count,)
            return
        if normalized.startswith("DELETE FROM ITEMS"):
            self._fetchone = None
            self.rowcount = self.delete_rowcount
            return
        raise AssertionError(f"Unexpected query: {query}")

    def fetchone(self):
        return self._fetchone


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


class _FakeDB:
    def __init__(self, cursor):
        self.cursor_obj = cursor

    @contextmanager
    def get_connection(self):
        yield _FakeConnection(self.cursor_obj)


def test_delete_equipment_query_helper_blocks_on_dependencies(monkeypatch):
    cursor = _FakeCursor(item_row=(77, 1001.0), docs_count=1, history_count=2)
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: _FakeDB(cursor))

    result = db_queries.delete_equipment_by_inv("1001", db_id="main")

    assert result["success"] is False
    assert result["code"] == "has_dependencies"
    assert result["docs_count"] == 1
    assert result["history_count"] == 2
    assert not any(query.startswith("DELETE FROM ITEMS") for query, _ in cursor.executed)


def test_delete_equipment_query_helper_deletes_item_without_dependencies(monkeypatch):
    cursor = _FakeCursor(item_row=(77, 1001.0), docs_count=0, history_count=0, delete_rowcount=1)
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: _FakeDB(cursor))

    result = db_queries.delete_equipment_by_inv("1001", db_id="main")

    assert result == {
        "success": True,
        "item_id": 77,
        "inv_no": "1001",
        "message": "Equipment deleted",
    }
    assert any(query.startswith("DELETE FROM ITEMS") for query, _ in cursor.executed)
