from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _make_user(*, role: str = "admin", assigned_database: str | None = None):
    from backend.models.auth import User

    return User(
        id=77,
        username="db_user",
        email=None,
        full_name="DB User",
        role=role,
        is_active=True,
        permissions=["database.read"],
        use_custom_permissions=True,
        custom_permissions=["database.read"],
        auth_source="local",
        telegram_id=None,
        assigned_database=assigned_database,
    )


def _patch_database_catalog(monkeypatch):
    database_module = pytest.importorskip("backend.api.v1.database")
    monkeypatch.setattr(
        database_module,
        "get_all_db_configs",
        lambda: [
            {"id": "ITINVENT", "name": "Main", "access": "read-only"},
            {"id": "OBJ-ITINVENT", "name": "Objects", "access": "read-write"},
            {"id": "SPB-ITINVENT", "name": "SPB", "access": "read-only"},
        ],
    )
    monkeypatch.setattr(
        database_module,
        "get_database_config",
        lambda db_id=None: {
            "host": "sql-host",
            "database": str(db_id or "ITINVENT"),
            "username": "ROUser",
            "password": "",
            "driver": "SQL Server",
        },
    )
    monkeypatch.setattr(database_module.user_db_selection_service, "get_assigned_database", lambda telegram_id: None)
    return database_module


@pytest.mark.asyncio
async def test_current_database_prefers_server_selection_over_client_hints(monkeypatch):
    database_module = _patch_database_catalog(monkeypatch)
    monkeypatch.setattr(database_module, "get_user_database", lambda user_id, username=None: "ITINVENT")
    monkeypatch.setattr(
        database_module.settings_service,
        "get_user_settings",
        lambda user_id: {"pinned_database": "SPB-ITINVENT"},
    )

    result = await database_module.get_current_database(
        x_database_id="OBJ-ITINVENT",
        selected_database="SPB-ITINVENT",
        current_user=_make_user(role="admin"),
    )

    assert result["id"] == "ITINVENT"
    assert result["source"] == "user_selection"
    assert result["locked"] == "false"


@pytest.mark.asyncio
async def test_database_dependency_uses_header_only_without_server_selection(monkeypatch):
    database_module = _patch_database_catalog(monkeypatch)
    deps = pytest.importorskip("backend.api.deps")
    monkeypatch.setattr(database_module, "get_user_database", lambda user_id, username=None: None)
    monkeypatch.setattr(database_module.settings_service, "get_user_settings", lambda user_id: {})

    result = await deps.get_current_database_id(
        x_database_id="OBJ-ITINVENT",
        selected_database="SPB-ITINVENT",
        current_user=_make_user(role="admin"),
    )

    assert result == "OBJ-ITINVENT"


@pytest.mark.asyncio
async def test_non_admin_assigned_database_overrides_all_hints(monkeypatch):
    database_module = _patch_database_catalog(monkeypatch)
    deps = pytest.importorskip("backend.api.deps")
    monkeypatch.setattr(database_module, "get_user_database", lambda user_id, username=None: "ITINVENT")
    monkeypatch.setattr(
        database_module.settings_service,
        "get_user_settings",
        lambda user_id: {"pinned_database": "ITINVENT"},
    )

    result = await deps.get_current_database_id(
        x_database_id="OBJ-ITINVENT",
        selected_database="SPB-ITINVENT",
        current_user=_make_user(role="viewer", assigned_database="SPB-ITINVENT"),
    )

    assert result == "SPB-ITINVENT"


@pytest.mark.asyncio
async def test_switch_database_persists_server_selection_and_clears_legacy_cookie(monkeypatch):
    database_module = _patch_database_catalog(monkeypatch)
    settings_updates = []
    memory_updates = []
    monkeypatch.setattr(
        database_module.settings_service,
        "update_user_settings",
        lambda user_id, patch: settings_updates.append((user_id, patch)) or {"pinned_database": patch["pinned_database"]},
    )
    monkeypatch.setattr(
        database_module,
        "set_user_database",
        lambda user_id, database_id, username=None: memory_updates.append((user_id, database_id, username)),
    )

    response = await database_module.switch_database(
        database_module.SwitchDatabaseRequest(database_id="OBJ-ITINVENT"),
        current_user=_make_user(role="admin"),
    )

    payload = json.loads(response.body.decode("utf-8"))
    assert payload["success"] is True
    assert payload["database"]["id"] == "OBJ-ITINVENT"
    assert settings_updates == [(77, {"pinned_database": "OBJ-ITINVENT"})]
    assert memory_updates == [(77, "OBJ-ITINVENT", "db_user")]
    assert "selected_database=" in response.headers.get("set-cookie", "")
    assert "Max-Age=0" in response.headers.get("set-cookie", "")
