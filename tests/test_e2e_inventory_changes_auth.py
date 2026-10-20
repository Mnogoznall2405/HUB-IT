"""GET /api/v1/inventory/changes exposes hostname/MAC/diff of the PC fleet,
so it must reject anonymous callers and serve users with computers.read.

Runs through the real ``backend.main`` app. The inventory store is pointed
at a throw-away sqlite file (``temp_dir``), never at the .env databases.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import inventory  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.auth import User  # noqa: E402


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver", raise_server_exceptions=False)


def test_inventory_changes_requires_authenticated_user_with_computers_read(client, temp_dir, monkeypatch):
    database_url = f"sqlite:///{(Path(temp_dir) / 'inventory_app.db').as_posix()}"
    monkeypatch.setattr(inventory, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(
        inventory,
        "get_local_store",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store must not be used")),
    )

    anonymous = client.get("/api/v1/inventory/changes")
    assert anonymous.status_code in (401, 403), anonymous.text

    user = User(
        id=7,
        username="ivanov",
        role="viewer",
        is_active=True,
        permissions=["computers.read"],
    )
    app.dependency_overrides[deps.get_current_user] = lambda: user
    try:
        authorized = client.get("/api/v1/inventory/changes", params={"limit": 5})
    finally:
        app.dependency_overrides.pop(deps.get_current_user, None)

    assert authorized.status_code == 200, authorized.text
    body = authorized.json()
    assert body["latest_events"] == []
    assert set(body["totals"]) == {"changed_24h", "changed_7d", "changed_30d"}


def test_inventory_changes_denies_authenticated_user_without_computers_read(client, monkeypatch):
    def forbidden_load(**kwargs):
        raise AssertionError("Inventory must not be read before permission checks")

    monkeypatch.setattr(inventory, "_load_changes", forbidden_load)
    user = User(id=8, username="viewer", role="viewer", is_active=True, permissions=[])
    app.dependency_overrides[deps.get_current_user] = lambda: user
    try:
        response = client.get("/api/v1/inventory/changes")
    finally:
        app.dependency_overrides.pop(deps.get_current_user, None)
    assert response.status_code == 403, response.text
