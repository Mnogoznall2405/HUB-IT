from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import database as database_api
from backend.api.v1 import equipment as equipment_api
from backend.models.auth import User


def _admin() -> User:
    return User(
        id=91,
        username="mobile-db-admin",
        role="admin",
        is_active=True,
        permissions=["database.read"],
        use_custom_permissions=True,
        custom_permissions=["database.read"],
    )


def test_equipment_detail_uses_request_database_header_over_concurrent_selection(monkeypatch):
    captured: dict[str, str | None] = {}
    monkeypatch.setattr(
        database_api,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main", "access": "read-only"},
            {"id": "OBJ-ITINVENT", "name": "Objects", "access": "read-only"},
        ],
    )
    monkeypatch.setattr(database_api, "get_user_database", lambda *_args, **_kwargs: "ITINVENT")
    monkeypatch.setattr(
        database_api.settings_service,
        "get_user_settings",
        lambda _user_id: {"pinned_database": "ITINVENT"},
    )
    monkeypatch.setattr(database_api.user_db_selection_service, "get_assigned_database", lambda _telegram_id: None)

    def get_equipment(inv_no: str, db_id: str | None):
        captured.update(inv_no=inv_no, db_id=db_id)
        return {"inv_no": inv_no, "model_name": "Scoped device"}

    monkeypatch.setattr(equipment_api.queries, "get_equipment_by_inv", get_equipment)
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = _admin

    response = TestClient(app).get(
        "/equipment/INV-1",
        headers={"X-Database-ID": "OBJ-ITINVENT"},
    )

    assert response.status_code == 200
    assert captured == {"inv_no": "INV-1", "db_id": "OBJ-ITINVENT"}
