from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path

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
from backend.models.auth import User  # noqa: E402


def _make_user(*, role: str = "admin", custom_permissions: list[str] | None = None) -> User:
    return User(
        id=1,
        username=role,
        role=role,  # type: ignore[arg-type]
        is_active=True,
        use_custom_permissions=bool(custom_permissions),
        custom_permissions=list(custom_permissions or []),
    )


@pytest.fixture
def consumable_delete_env():
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    current = {"user": _make_user(role="admin")}

    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_current_database_id] = lambda: "main"

    def set_user(**kwargs):
        current["user"] = _make_user(**kwargs)

    return {
        "client": TestClient(app),
        "set_user": set_user,
    }


def test_delete_consumable_route_allows_admin_success(monkeypatch, consumable_delete_env):
    calls = []

    def fake_delete(item_id, db_id=None):
        calls.append((item_id, db_id))
        return {
            "success": True,
            "item_id": 42,
            "inv_no": "2001",
            "message": "Consumable deleted",
        }

    monkeypatch.setattr(equipment_api.queries, "delete_consumable_by_id", fake_delete)
    cache_calls = []
    monkeypatch.setattr(
        equipment_api,
        "invalidate_equipment_cache",
        lambda db_id: cache_calls.append(db_id),
    )

    response = consumable_delete_env["client"].delete("/equipment/consumables/42")

    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert calls == [(42, "main")]
    assert cache_calls == ["main"]


def test_delete_consumable_route_rejects_operator_without_permission(
    monkeypatch,
    consumable_delete_env,
):
    consumable_delete_env["set_user"](role="operator")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("delete helper must not be called without database.delete")

    monkeypatch.setattr(equipment_api.queries, "delete_consumable_by_id", fail_if_called)

    response = consumable_delete_env["client"].delete("/equipment/consumables/42")

    assert response.status_code == 403, response.text
    assert "database.delete" in response.json()["detail"]


def test_delete_consumable_route_allows_custom_permission(monkeypatch, consumable_delete_env):
    consumable_delete_env["set_user"](
        role="operator",
        custom_permissions=["database.delete"],
    )

    monkeypatch.setattr(
        equipment_api.queries,
        "delete_consumable_by_id",
        lambda item_id, db_id=None: {
            "success": True,
            "item_id": item_id,
            "inv_no": "2001",
            "message": "Consumable deleted",
        },
    )
    monkeypatch.setattr(equipment_api, "invalidate_equipment_cache", lambda db_id: None)

    response = consumable_delete_env["client"].delete("/equipment/consumables/42")

    assert response.status_code == 200, response.text


def test_delete_consumable_route_returns_not_found(monkeypatch, consumable_delete_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "delete_consumable_by_id",
        lambda item_id, db_id=None: {
            "success": False,
            "code": "not_found",
            "message": "Consumable with ID 42 not found",
        },
    )

    response = consumable_delete_env["client"].delete("/equipment/consumables/42")

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Consumable with ID 42 not found"


def test_delete_consumable_route_returns_conflict_for_dependencies(monkeypatch, consumable_delete_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "delete_consumable_by_id",
        lambda item_id, db_id=None: {
            "success": False,
            "code": "has_dependencies",
            "message": "Consumable is linked to acts or history and cannot be deleted (acts=1, history=2)",
        },
    )

    response = consumable_delete_env["client"].delete("/equipment/consumables/42")

    assert response.status_code == 409, response.text
    assert "cannot be deleted" in response.json()["detail"]


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
        if "SELECT TOP 1 ID, INV_NO FROM ITEMS" in normalized and "CI_TYPE = 4" in normalized:
            self._fetchone = self.item_row
            return
        if "SELECT COUNT(1) FROM DOCS_LIST" in normalized:
            self._fetchone = (self.docs_count,)
            return
        if "SELECT COUNT(1) FROM CI_HISTORY" in normalized:
            self._fetchone = (self.history_count,)
            return
        if normalized.startswith("DELETE FROM ITEMS") and "CI_TYPE = 4" in normalized:
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


def test_delete_consumable_query_helper_blocks_on_dependencies(monkeypatch):
    cursor = _FakeCursor(item_row=(42, 2001.0), docs_count=1, history_count=2)
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: _FakeDB(cursor))

    result = db_queries.delete_consumable_by_id(42, db_id="main")

    assert result["success"] is False
    assert result["code"] == "has_dependencies"
    assert result["docs_count"] == 1
    assert result["history_count"] == 2
    assert not any(query.startswith("DELETE FROM ITEMS") for query, _ in cursor.executed)


def test_delete_consumable_query_helper_deletes_item_without_dependencies(monkeypatch):
    cursor = _FakeCursor(item_row=(42, 2001.0), docs_count=0, history_count=0, delete_rowcount=1)
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: _FakeDB(cursor))

    result = db_queries.delete_consumable_by_id(42, db_id="main")

    assert result == {
        "success": True,
        "item_id": 42,
        "inv_no": "2001",
        "message": "Consumable deleted",
    }
    assert any(
        query.startswith("DELETE FROM ITEMS") and "CI_TYPE = 4" in query
        for query, _ in cursor.executed
    )


def test_delete_consumable_query_helper_rejects_invalid_item_id():
    result = db_queries.delete_consumable_by_id(0, db_id="main")

    assert result["success"] is False
    assert result["code"] == "invalid_item_id"
