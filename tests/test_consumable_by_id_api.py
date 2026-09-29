from __future__ import annotations

import sys
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
from backend.api.v1 import json_operations as json_ops  # noqa: E402
from backend.database import queries as db_queries  # noqa: E402
from backend.json_db.cartridges import CartridgeDatabase  # noqa: E402
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
def consumable_by_id_env():
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    current = {"user": _make_user(role="admin")}

    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"
    app.dependency_overrides[deps.get_current_database_id] = lambda: "main"

    return {"client": TestClient(app)}


def test_get_consumable_by_id_route_returns_card(monkeypatch, consumable_by_id_env):
    calls = []

    def fake_get(item_id, db_id=None):
        calls.append((item_id, db_id))
        return {
            "id": 4821,
            "inv_no": "2001",
            "type_no": 4,
            "type_name": "Картридж",
            "model_no": 12,
            "model_name": "HP CF283A",
            "qty": 7,
            "branch_no": 1,
            "branch_name": "ЦО",
            "loc_no": "3",
            "location_name": "Серверная",
            "part_no": "PN-1",
            "description": None,
        }

    monkeypatch.setattr(equipment_api.queries, "get_consumable_by_id", fake_get)

    response = consumable_by_id_env["client"].get("/equipment/consumables/4821")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == 4821
    assert body["qty"] == 7
    assert body["model_name"] == "HP CF283A"
    assert body["location_name"] == "Серверная"
    assert calls == [(4821, "main")]


def test_get_consumable_by_id_route_returns_404(monkeypatch, consumable_by_id_env):
    monkeypatch.setattr(equipment_api.queries, "get_consumable_by_id", lambda item_id, db_id=None: None)

    response = consumable_by_id_env["client"].get("/equipment/consumables/999")

    assert response.status_code == 404, response.text
    assert "999" in response.json()["detail"]


def test_consumables_lookup_route_still_wins_over_item_id_path(monkeypatch, consumable_by_id_env):
    monkeypatch.setattr(
        equipment_api.queries,
        "get_consumables_lookup",
        lambda **kwargs: [{
            "id": 7,
            "inv_no": "2001",
            "qty": 3,
        }],
    )

    def fail_item_lookup(*args, **kwargs):
        raise AssertionError("lookup path must not be routed to the by-id handler")

    monkeypatch.setattr(equipment_api.queries, "get_consumable_by_id", fail_item_lookup)

    response = consumable_by_id_env["client"].get("/equipment/consumables/lookup")

    assert response.status_code == 200, response.text
    assert response.json()[0]["id"] == 7


class _FakeQueryDB:
    def __init__(self, rows):
        self.rows = rows
        self.executed: list[tuple[str, tuple]] = []

    def execute_query(self, query, params=()):
        self.executed.append((query, tuple(params or ())))
        return self.rows


def test_get_consumable_by_id_query_scopes_to_item_id_and_ci_type(monkeypatch):
    fake_db = _FakeQueryDB(rows=[{
        "id": 4821,
        "inv_no": 2001.0,
        "type_no": 4,
        "type_name": "Картридж",
        "model_no": 12,
        "model_name": "HP CF283A",
        "qty": 7,
        "part_no": "PN-1",
        "description": None,
        "branch_no": 1,
        "branch_name": "ЦО",
        "loc_no": "3",
        "location_name": "Серверная",
    }])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    row = db_queries.get_consumable_by_id(4821, db_id="main")

    assert row is not None
    assert row["inv_no"] == "2001"
    assert row["qty"] == 7
    query, params = fake_db.executed[0]
    assert "CI_TYPE = 4" in query
    assert "i.ID = ?" in query
    assert params == (4821,)


def test_get_consumable_by_id_query_rejects_invalid_ids(monkeypatch):
    fake_db = _FakeQueryDB(rows=[])
    monkeypatch.setattr(db_queries, "get_db", lambda db_id=None: fake_db)

    assert db_queries.get_consumable_by_id(0, db_id="main") is None
    assert db_queries.get_consumable_by_id("abc", db_id="main") is None
    assert fake_db.executed == []


class _FakeDataManager:
    def __init__(self, data):
        self._data = data

    def load_json(self, filename, default_content=None):
        return self._data


def _cartridge_db() -> CartridgeDatabase:
    return CartridgeDatabase(data_manager=_FakeDataManager({
        "HP LaserJet Pro M404dn": {
            "oem_cartridge": "CF259A",
            "compatible_models": [
                {"model": "CF259X", "description": "XL"},
            ],
        },
        "HP LaserJet Pro MFP M428fdw": {
            "oem_cartridge": "HP CF259A",
            "compatible_models": [],
        },
        "Brother HL-L2350DW": {
            "oem_cartridge": "TN-2410",
            "compatible_models": [],
        },
    }))


def test_get_printers_for_cartridge_matches_oem_and_compatible_models():
    db = _cartridge_db()

    assert db.get_printers_for_cartridge("CF259A") == [
        "HP LaserJet Pro M404dn",
        "HP LaserJet Pro MFP M428fdw",
    ]
    assert db.get_printers_for_cartridge("cf259x") == ["HP LaserJet Pro M404dn"]
    assert db.get_printers_for_cartridge("TN-2410") == ["Brother HL-L2350DW"]
    assert db.get_printers_for_cartridge("UNKNOWN-9") == []
    assert db.get_printers_for_cartridge("") == []


@pytest.fixture
def cartridge_api_env():
    app = FastAPI()
    app.include_router(json_ops.router, prefix="/json")

    current = {"user": _make_user(role="admin")}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[json_ops.get_cartridge_database] = _cartridge_db

    return {"client": TestClient(app)}


def test_printers_for_cartridge_route_returns_matches(cartridge_api_env):
    response = cartridge_api_env["client"].get("/json/cartridges/printers-for/CF259A")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["cartridge_model"] == "CF259A"
    assert "HP LaserJet Pro M404dn" in body["printer_models"]
