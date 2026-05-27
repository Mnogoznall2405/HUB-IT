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


class FakeRecentCardsService:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.items = [
            {
                "inv_no": "1001",
                "db_id": "main",
                "last_action": "view",
                "last_action_label": "Открыта",
                "last_activity_at": "2026-05-27T08:00:00+00:00",
                "activity_count": 1,
                "snapshot": {"INV_NO": "1001", "MODEL_NAME": "OptiPlex"},
            }
        ]

    def list_recent(self, **kwargs):
        self.calls.append(("list_recent", kwargs))
        return self.items

    def touch(self, **kwargs):
        self.calls.append(("touch", kwargs))
        return {
            "inv_no": str(kwargs["inv_no"]),
            "db_id": str(kwargs["db_id"]),
            "last_action": str(kwargs["action_type"]),
            "last_action_label": "Изменена",
            "last_activity_at": "2026-05-27T08:01:00+00:00",
            "activity_count": 2,
            "snapshot": kwargs.get("snapshot") or {},
        }

    def remove(self, **kwargs):
        self.calls.append(("remove", kwargs))
        return {"removed": 1}

    def clear(self, **kwargs):
        self.calls.append(("clear", kwargs))
        return {"removed": 3}


@pytest.fixture
def recent_api_env(monkeypatch):
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")

    current_user = SimpleNamespace(id=7, username="operator", role="operator", is_active=True)
    app.dependency_overrides[deps.get_current_active_user] = lambda: current_user
    app.dependency_overrides[deps.get_current_database_id] = lambda: "main"

    fake_service = FakeRecentCardsService()
    monkeypatch.setattr(equipment_api, "equipment_recent_cards_service", fake_service)

    return TestClient(app), fake_service


def test_recent_cards_get_uses_current_user_and_database(recent_api_env):
    client, fake_service = recent_api_env

    response = client.get("/equipment/recent-cards?limit=4")

    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["inv_no"] == "1001"
    assert fake_service.calls == [
        ("list_recent", {"user_id": 7, "db_id": "main", "limit": 4}),
    ]


def test_recent_cards_touch_uses_body_user_and_database(recent_api_env):
    client, fake_service = recent_api_env

    response = client.post(
        "/equipment/recent-cards/touch",
        json={
            "inv_no": "1001",
            "action_type": "edit",
            "snapshot": {"MODEL_NAME": "OptiPlex"},
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["last_action"] == "edit"
    assert fake_service.calls == [
        (
            "touch",
            {
                "user_id": 7,
                "db_id": "main",
                "inv_no": "1001",
                "action_type": "edit",
                "snapshot": {"MODEL_NAME": "OptiPlex"},
            },
        ),
    ]


def test_recent_cards_remove_and_clear_scope_to_current_user(recent_api_env):
    client, fake_service = recent_api_env

    remove_response = client.delete("/equipment/recent-cards/1001")
    clear_response = client.delete("/equipment/recent-cards")

    assert remove_response.status_code == 200, remove_response.text
    assert clear_response.status_code == 200, clear_response.text
    assert fake_service.calls == [
        ("remove", {"user_id": 7, "db_id": "main", "inv_no": "1001"}),
        ("clear", {"user_id": 7, "db_id": "main"}),
    ]


def test_recent_cards_require_authentication():
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    client = TestClient(app)

    response = client.get("/equipment/recent-cards")

    assert response.status_code in {401, 403}
