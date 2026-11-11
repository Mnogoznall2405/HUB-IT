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
from backend.api.v1 import itinvent_references as references_api  # noqa: E402
from backend.database import itinvent_reference_writes as store  # noqa: E402
from backend.services import itinvent_reference_service as service  # noqa: E402


class FakeCursor:
    """Routes normalized SQL to a handler returning (columns, rows) or None for writes."""

    def __init__(self, handler):
        self.handler = handler
        self.executed: list[tuple[str, tuple]] = []
        self.description = None
        self._rows: list[tuple] = []

    def execute(self, sql, params=()):
        normalized = " ".join(str(sql).split())
        self.executed.append((normalized, tuple(params or ())))
        result = self.handler(normalized, tuple(params or ()))
        if result is None:
            self.description, self._rows = None, []
        else:
            columns, rows = result
            self.description = [(name,) for name in columns]
            self._rows = list(rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)

    def writes(self):
        return [item for item in self.executed if item[0].startswith(("INSERT", "UPDATE", "DELETE"))]


class FakeDB:
    def __init__(self, cursor):
        self.cursor_obj = cursor

    @contextmanager
    def get_connection(self):
        yield SimpleNamespace(cursor=lambda: self.cursor_obj)


def _fake_db_fn(cursor):
    db = FakeDB(cursor)
    return lambda db_id=None: db


def test_create_model_allocates_next_number_and_inserts_vendor(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT ISNULL(MAX(MODEL_NO)"):
            return ("n",), [(901,)]
        if sql.startswith("SELECT 1 FROM CI_TYPES WHERE TYPE_NO"):
            return ("x",), [(1,)]
        if sql.startswith("SELECT 1 FROM VENDORS"):
            return ("x",), [(1,)]
        if sql.startswith("SELECT TOP 1 1 FROM CI_MODELS"):
            return ("x",), []
        if sql.startswith("SELECT MODEL_NO AS id"):
            return ("id", "name", "ci_type", "type_no", "vendor_no"), [(901, "LaserJet 400", 1, 5, 7)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    row = store.create_reference(
        "models", {"name": "  LaserJet   400 ", "ci_type": 1, "type_no": 5, "vendor_no": 7}, "main"
    )

    assert row["id"] == 901
    assert cursor.writes() == [
        (
            "INSERT INTO CI_MODELS (MODEL_NO, CI_TYPE, TYPE_NO, MODEL_NAME, VENDOR_NO) VALUES (?, ?, ?, ?, ?)",
            (901, 1, 5, "LaserJet 400", 7),
        )
    ]


def test_create_duplicate_name_is_rejected_without_insert(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT ISNULL(MAX(VENDOR_NO)"):
            return ("n",), [(92,)]
        if sql.startswith("SELECT TOP 1 1 FROM VENDORS"):
            assert params[0] == "hp"
            return ("x",), [(1,)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    with pytest.raises(store.ReferenceDataError) as error:
        store.create_reference("vendors", {"name": " HP "}, "main")

    assert error.value.code == "duplicate"
    assert cursor.writes() == []


def test_legacy_vendor_with_key_zero_is_addressable(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT VENDOR_NO AS id"):
            assert params == (0,)
            return ("id", "name"), [(0, "HP")]
        if "FROM sys.columns" in sql:
            return ("t", "c"), [("CI_MODELS", "VENDOR_NO")]
        if sql.startswith("SELECT COUNT(1) FROM CI_MODELS WHERE VENDOR_NO = ?"):
            return ("c",), [(4,)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    usage = store.get_reference_usage("vendors", 0, "main")

    assert usage["total"] == 4


def test_delete_used_model_is_blocked_and_nothing_is_deleted(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT TOP 1 1 FROM CI_MODELS WITH"):
            return ("x",), [(1,)]
        if sql.startswith("SELECT MODEL_NO AS id"):
            return ("id", "name", "ci_type", "type_no", "vendor_no"), [(10, "X", 1, 5, None)]
        if "FROM sys.columns" in sql:
            return ("t", "c"), [("ITEMS", "MODEL_NO")]
        if sql.startswith("SELECT COUNT(1) FROM ITEMS WHERE MODEL_NO = ? AND CI_TYPE = ?"):
            assert params == (10, 1)
            return ("c",), [(3,)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    with pytest.raises(store.ReferenceDataError) as error:
        store.delete_reference("models", 10, "main", ci_type=1)

    assert error.value.code == "in_use"
    assert "3" in error.value.message
    assert cursor.writes() == []


def test_delete_unused_location_removes_branch_links_first(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT TOP 1 1 FROM LOCATIONS WITH"):
            return ("x",), [(1,)]
        if sql.startswith("SELECT LOC_NO AS id"):
            return ("id", "name"), [(40, "Каб. 12")]
        if sql.startswith("SELECT BRANCH_NO FROM LOC_BRANCH"):
            return ("b",), [(2,)]
        if "FROM sys.columns" in sql:
            return ("t", "c"), [("ITEMS", "LOC_NO")]
        if sql.startswith("SELECT COUNT(1) FROM ITEMS"):
            return ("c",), [(0,)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    deleted = store.delete_reference("locations", 40, "main")

    assert deleted["name"] == "Каб. 12"
    assert [sql for sql, _ in cursor.writes()] == [
        "DELETE FROM LOC_BRANCH WHERE LOC_NO = ?",
        "DELETE FROM LOCATIONS WHERE LOC_NO = ?",
    ]


def test_change_model_type_is_blocked_when_model_is_used(monkeypatch):
    def handler(sql, params):
        if sql.startswith("SELECT TOP 1 1 FROM CI_MODELS WITH"):
            return ("x",), [(1,)]
        if sql.startswith("SELECT MODEL_NO AS id"):
            return ("id", "name", "ci_type", "type_no", "vendor_no"), [(10, "X", 1, 5, None)]
        if sql.startswith("SELECT 1 FROM CI_TYPES"):
            return ("x",), [(1,)]
        if "FROM sys.columns" in sql:
            return ("t", "c"), [("ITEMS", "MODEL_NO")]
        if sql.startswith("SELECT COUNT(1) FROM ITEMS"):
            return ("c",), [(1,)]
        return None

    cursor = FakeCursor(handler)
    monkeypatch.setattr(store, "_default_get_db", _fake_db_fn(cursor))

    with pytest.raises(store.ReferenceDataError) as error:
        store.update_reference("models", 10, {"type_no": 6}, "main", ci_type=1)

    assert error.value.code == "in_use"
    assert cursor.writes() == []


@pytest.fixture
def references_env(monkeypatch):
    app = FastAPI()
    app.include_router(references_api.router, prefix="/itinvent-references")
    current = {"user": SimpleNamespace(username="admin", role="admin", is_active=True)}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"
    monkeypatch.setattr(service, "invalidate_equipment_cache", lambda db_id=None: None)
    return {
        "client": TestClient(app),
        "set_user": lambda role, **extra: current.__setitem__(
            "user", SimpleNamespace(username=role, role=role, is_active=True, **extra)
        ),
    }


def test_references_api_requires_dedicated_permission(monkeypatch, references_env):
    references_env["set_user"]("operator")
    monkeypatch.setattr(store, "create_reference", lambda *a, **k: pytest.fail("must not reach the store"))

    response = references_env["client"].post("/itinvent-references/vendors", json={"name": "Acme"})

    assert response.status_code == 403
    assert "database.references.manage" in response.json()["detail"]


def test_references_api_maps_store_errors_to_http_statuses(monkeypatch, references_env):
    def fake_create(kind, payload, db_id):
        raise store.ReferenceDataError("duplicate", "Запись с таким названием уже существует")

    def fake_delete(kind, ref_id, db_id, ci_type=None):
        raise store.ReferenceDataError(
            "in_use", "Запись используется", usage=[{"table": "ITEMS", "label": "оборудование", "count": 3}]
        )

    monkeypatch.setattr(store, "create_reference", fake_create)
    monkeypatch.setattr(store, "delete_reference", fake_delete)
    client = references_env["client"]

    created = client.post("/itinvent-references/vendors", json={"name": "HP"})
    deleted = client.delete("/itinvent-references/models/10?ci_type=1")
    unknown = client.get("/itinvent-references/unknown")

    assert created.status_code == 409
    assert deleted.status_code == 409
    assert deleted.json()["detail"]["usage"][0]["count"] == 3
    assert unknown.status_code == 404


def test_references_api_allows_non_admin_with_custom_permission(monkeypatch, references_env):
    references_env["set_user"](
        "operator", use_custom_permissions=True, custom_permissions=["database.references.manage"]
    )
    calls = []
    monkeypatch.setattr(
        store, "create_reference", lambda kind, payload, db_id: calls.append((kind, payload, db_id)) or {"id": 93, "name": "Acme"}
    )

    response = references_env["client"].post("/itinvent-references/vendors", json={"name": "Acme"})

    assert response.status_code == 201, response.text
    assert response.json() == {"id": 93, "name": "Acme"}
    assert calls == [("vendors", {"name": "Acme"}, "main")]
