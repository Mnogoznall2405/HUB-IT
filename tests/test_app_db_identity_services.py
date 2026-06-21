from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.app_settings_service import AppSettingsService
from backend.services.session_service import SessionService
from backend.services.settings_service import SettingsService
from backend.services.user_db_selection_service import UserDBSelectionService
from backend.services.user_service import UserService


@pytest.fixture(autouse=True)
def _development_app_environment(monkeypatch):
    user_module = importlib.import_module("backend.services.user_service")
    monkeypatch.setattr(user_module.config.app, "environment", "development", raising=False)


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'app_identity.db').as_posix()}"


def test_user_service_can_create_and_authenticate_with_app_db(temp_dir):
    service = UserService(file_path=Path(temp_dir) / "web_users.json", database_url=_sqlite_url(temp_dir))

    created = service.create_user(
        username="postgres-user",
        password="secret123",
        role="operator",
        email="postgres@example.com",
        full_name="Postgres User",
        department="IT",
        job_title="System Administrator",
        use_custom_permissions=True,
        custom_permissions=["tasks.read"],
    )

    assert created["username"] == "postgres-user"
    assert created["department"] == "IT"
    assert created["job_title"] == "System Administrator"
    assert service.authenticate("postgres-user", "secret123")["username"] == "postgres-user"
    listed = next(item for item in service.list_users() if item["username"] == "postgres-user")
    assert listed["department"] == "IT"
    assert listed["job_title"] == "System Administrator"


def test_user_service_uses_direct_app_db_lookup_for_identity_reads(temp_dir, monkeypatch):
    service = UserService(file_path=Path(temp_dir) / "web_users.json", database_url=_sqlite_url(temp_dir))
    created = service.create_user(
        username="direct-lookup",
        password="secret123",
        role="operator",
        email="direct@example.com",
        full_name="Direct Lookup",
    )

    monkeypatch.setattr(service, "_load_users", lambda: (_ for _ in ()).throw(AssertionError("full user load")))

    assert service.get_by_id(created["id"])["username"] == "direct-lookup"
    assert service.get_by_username("DIRECT-LOOKUP")["id"] == created["id"]


def test_session_service_works_with_app_db_backend(temp_dir):
    service = SessionService(file_path=Path(temp_dir) / "web_sessions.json", database_url=_sqlite_url(temp_dir))

    created = service.create_session(
        session_id="app-db-session",
        user_id=7,
        username="demo",
        role="viewer",
        ip_address="127.0.0.1",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at="2030-03-21T10:00:00+00:00",
    )

    assert created["session_id"] == "app-db-session"
    assert service.is_session_active("app-db-session") is True
    assert service.touch_session("app-db-session") is True
    assert service.list_sessions(active_only=True)[0]["session_id"] == "app-db-session"


def test_session_service_throttles_app_db_touch_writes(temp_dir):
    service = SessionService(file_path=Path(temp_dir) / "web_sessions.json", database_url=_sqlite_url(temp_dir))
    service.create_session(
        session_id="touch-throttle-db",
        user_id=7,
        username="demo",
        role="viewer",
        ip_address="127.0.0.1",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at="2030-03-21T10:00:00+00:00",
    )

    before = service._load_sessions()[0]["last_seen_at"]
    assert service.touch_session("touch-throttle-db") is True
    assert service._load_sessions()[0]["last_seen_at"] == before


def test_settings_and_db_selection_work_with_app_db_backend(temp_dir):
    database_url = _sqlite_url(temp_dir)
    settings_service = SettingsService(file_path=Path(temp_dir) / "web_user_settings.json", database_url=database_url)
    selection_service = UserDBSelectionService(file_path=Path(temp_dir) / "user_db_selection.json", database_url=database_url)

    assert settings_service.get_user_settings(15)["mobile_bottom_nav_items"] == [
        "/dashboard",
        "/tasks",
        "/chat",
        "/mail",
    ]
    updated = settings_service.update_user_settings(15, {
        "theme_mode": "dark",
        "font_family": "Segoe UI",
        "font_scale": 1.1,
        "pinned_database": "ITINVENT",
        "mobile_bottom_nav_items": [
            "/mail",
            "invalid",
            "/tasks",
            "/mail",
            "/dashboard",
            "/settings",
            "/database",
        ],
    })
    selection_service.set_assigned_database(123456, "ITINVENT")

    assert updated["theme_mode"] == "dark"
    assert updated["mobile_bottom_nav_items"] == ["/mail", "/tasks", "/dashboard", "/database"]
    assert settings_service.get_user_settings(15)["pinned_database"] == "ITINVENT"
    assert settings_service.get_user_settings(15)["mobile_bottom_nav_items"] == [
        "/mail",
        "/tasks",
        "/dashboard",
        "/database",
    ]
    assert selection_service.get_assigned_database(123456) == "ITINVENT"


def test_settings_mobile_bottom_nav_items_work_with_json_fallback(temp_dir, monkeypatch):
    settings_module = importlib.import_module("backend.services.settings_service")
    monkeypatch.setattr(settings_module, "is_app_database_configured", lambda: False)
    service = SettingsService(file_path=Path(temp_dir) / "web_user_settings.json")

    assert service.get_user_settings(22)["mobile_bottom_nav_items"] == [
        "/dashboard",
        "/tasks",
        "/chat",
        "/mail",
    ]

    updated = service.update_user_settings(22, {
        "mobile_bottom_nav_items": [
            "/settings",
            "/settings",
            "invalid",
            "/database",
            "/tasks",
            "/mail",
            "/kb",
        ],
    })

    assert updated["mobile_bottom_nav_items"] == ["/database", "/tasks", "/mail", "/kb"]
    assert service.get_user_settings(22)["mobile_bottom_nav_items"] == [
        "/database",
        "/tasks",
        "/mail",
        "/kb",
    ]

    assert service.update_user_settings(22, {"mobile_bottom_nav_items": []})[
        "mobile_bottom_nav_items"
    ] == []


def test_app_settings_service_persists_controller_in_app_db(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json", database_url=database_url)
    module = importlib.import_module("backend.services.app_settings_service")

    monkeypatch.setattr(
        module.user_service,
        "list_users",
        lambda: [
            {
                "id": 1,
                "username": "controller.one",
                "full_name": "Controller One",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )

    service.update_settings({
        "transfer_act_reminder_controller_username": "controller.one",
        "admin_login_allowed_ips": ["10.105.0.42", "10.105.0.43"],
    })
    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["transfer_act_reminder_controller_username"] == "controller.one"
    assert payload["admin_login_allowed_ips"] == ["10.105.0.42", "10.105.0.43"]
    assert payload["resolved_controller"]["username"] == "controller.one"


def test_user_service_replaces_task_delegates_idempotently_in_app_db(temp_dir):
    service = UserService(file_path=Path(temp_dir) / "web_users.json", database_url=_sqlite_url(temp_dir))

    owner = service.create_user(
        username="task-owner",
        password="secret123",
        role="admin",
        email="owner@example.com",
        full_name="Task Owner",
    )
    delegate = service.create_user(
        username="task-delegate",
        password="secret123",
        role="operator",
        email="delegate@example.com",
        full_name="Task Delegate",
    )

    service.replace_task_delegates(
        owner["id"],
        [{"delegate_user_id": delegate["id"], "role_type": "assistant", "is_active": True}],
    )
    updated = service.replace_task_delegates(
        owner["id"],
        [{"delegate_user_id": delegate["id"], "role_type": "deputy", "is_active": True}],
    )

    stored_links = [
        item
        for item in service._load_task_delegate_links()
        if int(item.get("owner_user_id", 0)) == int(owner["id"])
    ]

    assert len(stored_links) == 1
    assert stored_links[0]["delegate_user_id"] == delegate["id"]
    assert stored_links[0]["role_type"] == "deputy"
    assert len(updated) == 1
    assert updated[0]["delegate_user_id"] == delegate["id"]
    assert updated[0]["role_type"] == "deputy"


def test_user_service_lists_task_delegates_bulk_with_single_store_pass(temp_dir, monkeypatch):
    service = UserService(file_path=Path(temp_dir) / "web_users.json", database_url=_sqlite_url(temp_dir))

    owner_a = service.create_user(username="owner-a", password="secret123", role="admin", email="owner-a@example.com")
    owner_b = service.create_user(username="owner-b", password="secret123", role="admin", email="owner-b@example.com")
    delegate_a = service.create_user(
        username="delegate-a",
        password="secret123",
        role="operator",
        email="delegate-a@example.com",
        full_name="Delegate A",
    )
    delegate_b = service.create_user(
        username="delegate-b",
        password="secret123",
        role="operator",
        email="delegate-b@example.com",
        full_name="Delegate B",
    )

    service.replace_task_delegates(
        owner_a["id"],
        [
            {"delegate_user_id": delegate_b["id"], "role_type": "assistant", "is_active": True},
            {"delegate_user_id": delegate_a["id"], "role_type": "deputy", "is_active": True},
        ],
    )
    service.replace_task_delegates(
        owner_b["id"],
        [{"delegate_user_id": delegate_b["id"], "role_type": "assistant", "is_active": True}],
    )

    calls = {"users": 0, "links": 0}
    original_load_users = service._load_users
    original_load_links = service._load_task_delegate_links

    def _load_users_once():
        calls["users"] += 1
        return original_load_users()

    def _load_links_once():
        calls["links"] += 1
        return original_load_links()

    monkeypatch.setattr(service, "_load_users", _load_users_once)
    monkeypatch.setattr(service, "_load_task_delegate_links", _load_links_once)

    grouped = service.list_task_delegates_bulk([owner_a["id"], owner_b["id"], 999, owner_a["id"]])

    assert calls == {"users": 1, "links": 1}
    assert [item["owner_user_id"] for item in grouped] == [owner_a["id"], owner_b["id"], 999]
    assert [item["delegate_user_id"] for item in grouped[0]["task_delegate_links"]] == [
        delegate_a["id"],
        delegate_b["id"],
    ]
    assert [item["delegate_user_id"] for item in grouped[1]["task_delegate_links"]] == [delegate_b["id"]]
    assert grouped[2]["task_delegate_links"] == []
