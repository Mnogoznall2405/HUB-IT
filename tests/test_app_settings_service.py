from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import settings as settings_api
from backend.models.auth import User
from backend.services.app_settings_service import AppSettingsService


def _make_admin() -> User:
    permissions = ["settings.read", "settings.users.manage", "settings.sessions.manage", "tasks.read", "tasks.review"]
    return User(
        id=1,
        username="admin",
        email=None,
        full_name="Admin",
        role="admin",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=False,
    )


@pytest.fixture(autouse=True)
def _force_file_app_settings_store(monkeypatch):
    module = importlib.import_module("backend.services.app_settings_service")
    monkeypatch.setattr(module, "is_app_database_configured", lambda: False)


def test_default_app_setting_prefers_configured_review_user(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")

    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 7,
                "username": "kozlovskii.me",
                "full_name": "Kozlovskii Me",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
            {
                "id": 9,
                "username": "backup.admin",
                "full_name": "Backup Admin",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )

    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["transfer_act_reminder_controller_username"] == "kozlovskii.me"
    assert payload["admin_login_allowed_ips"] == ["10.105.0.42"]
    assert payload["resolved_controller"]["username"] == "kozlovskii.me"
    assert payload["resolved_controller_source"] == "configured"
    assert payload["fallback_used"] is False
    assert payload["warning"] is None


def test_admin_login_allowlist_normalizes_and_deduplicates_entries(temp_dir):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")

    updated = service.update_settings({
        "admin_login_allowed_ips": [" 10.105.0.42 ", "10.105.0.42", "::1"],
    })

    assert updated["admin_login_allowed_ips"] == ["10.105.0.42", "::1"]
    assert service.get_admin_login_allowed_ips() == ["10.105.0.42", "::1"]
    assert service.is_admin_login_ip_allowed("10.105.0.42") is True
    assert service.is_admin_login_ip_allowed("10.105.0.43") is False


def test_admin_login_allowlist_rejects_invalid_entries(temp_dir):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")

    with pytest.raises(ValueError, match="admin_login_allowed_ips"):
        service.update_settings({"admin_login_allowed_ips": ["10.105.0.42", "bad ip"]})


def test_invalid_configured_user_falls_back_to_first_active_review_user(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")

    service.update_settings({"transfer_act_reminder_controller_username": "missing.user"})
    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 11,
                "username": "viewer.user",
                "full_name": "Viewer User",
                "role": "viewer",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
            {
                "id": 8,
                "username": "backup.admin",
                "full_name": "Backup Admin",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )

    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["transfer_act_reminder_controller_username"] == "missing.user"
    assert payload["resolved_controller"]["username"] == "backup.admin"
    assert payload["resolved_controller_source"] == "fallback"
    assert payload["fallback_used"] is True
    assert "fallback" in str(payload["warning"]).lower()


def test_inactive_configured_user_falls_back_to_active_review_user(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")

    service.update_settings({"transfer_act_reminder_controller_username": "kozlovskii.me"})
    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 7,
                "username": "kozlovskii.me",
                "full_name": "Kozlovskii Me",
                "role": "admin",
                "is_active": False,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
            {
                "id": 8,
                "username": "backup.admin",
                "full_name": "Backup Admin",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )

    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["resolved_controller"]["username"] == "backup.admin"
    assert payload["resolved_controller_source"] == "fallback"
    assert payload["fallback_used"] is True


def test_admin_without_explicit_tasks_review_is_still_allowed(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")

    service.update_settings({"transfer_act_reminder_controller_username": "kozlovskii.me"})
    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 7,
                "username": "kozlovskii.me",
                "full_name": "Kozlovskii Me",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": True,
                "custom_permissions": [],
            },
        ],
    )

    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["resolved_controller"]["username"] == "kozlovskii.me"
    assert payload["resolved_controller_source"] == "configured"
    assert payload["fallback_used"] is False


def test_no_review_users_returns_warning_and_no_resolution(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")

    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 11,
                "username": "viewer.user",
                "full_name": "Viewer User",
                "role": "viewer",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )

    payload = service.resolve_transfer_act_reminder_controller()

    assert payload["resolved_controller"] is None
    assert payload["resolved_controller_source"] == "none"
    assert payload["fallback_used"] is False
    assert "tasks.review" in str(payload["warning"])


def test_settings_app_endpoint_reads_and_updates_default_controller(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    app_settings_service_module = importlib.import_module("backend.services.app_settings_service")
    service.update_settings({
        "transfer_act_reminder_controller_username": "kozlovskii.me",
        "admin_login_allowed_ips": ["10.105.0.42"],
    })

    monkeypatch.setattr(
        app_settings_service_module.user_service,
        "list_users",
        lambda: [
            {
                "id": 7,
                "username": "kozlovskii.me",
                "full_name": "Kozlovskii Me",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
            {
                "id": 8,
                "username": "backup.admin",
                "full_name": "Backup Admin",
                "role": "admin",
                "is_active": True,
                "use_custom_permissions": False,
                "custom_permissions": [],
            },
        ],
    )
    monkeypatch.setattr(settings_api, "app_settings_service", service)

    app = FastAPI()
    app.include_router(settings_api.router, prefix="/settings")
    app.dependency_overrides[deps.get_current_admin_user] = _make_admin
    client = TestClient(app)

    get_response = client.get("/settings/app")
    assert get_response.status_code == 200
    assert get_response.json()["admin_login_allowed_ips"] == ["10.105.0.42"]
    assert get_response.json()["resolved_controller"]["username"] == "kozlovskii.me"

    patch_response = client.patch(
        "/settings/app",
        json={
            "transfer_act_reminder_controller_username": "backup.admin",
            "admin_login_allowed_ips": ["10.105.0.42", "10.105.0.43", "10.105.0.42"],
        },
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["transfer_act_reminder_controller_username"] == "backup.admin"
    assert patch_response.json()["admin_login_allowed_ips"] == ["10.105.0.42", "10.105.0.43"]
    assert patch_response.json()["resolved_controller"]["username"] == "backup.admin"


def test_settings_app_endpoint_rejects_invalid_admin_allowlist(temp_dir, monkeypatch):
    service = AppSettingsService(file_path=Path(temp_dir) / "web_app_settings.json")
    monkeypatch.setattr(settings_api, "app_settings_service", service)

    app = FastAPI()
    app.include_router(settings_api.router, prefix="/settings")
    app.dependency_overrides[deps.get_current_admin_user] = _make_admin
    client = TestClient(app)

    response = client.patch(
        "/settings/app",
        json={"admin_login_allowed_ips": ["10.105.0.42", "bad ip"]},
    )

    assert response.status_code == 400
    assert "admin_login_allowed_ips" in str(response.json().get("detail"))
