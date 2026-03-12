from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import auth
from backend.models.auth import User
from backend.services.session_service import SessionService


def _utc_now_iso(offset: timedelta | None = None) -> str:
    return (datetime.now(timezone.utc) + (offset or timedelta())).isoformat()


def _make_user(*, permissions: list[str]) -> User:
    return User(
        id=99,
        username="operator_user",
        email=None,
        full_name="Operator User",
        role="viewer",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
    )


@pytest.fixture
def isolated_session_service(tmp_path, monkeypatch):
    from backend import config as backend_config_module
    session_service_module = importlib.import_module("backend.services.session_service")

    monkeypatch.setattr(backend_config_module.config.session, "idle_timeout_minutes", 30)
    monkeypatch.setattr(backend_config_module.config.session, "history_retention_days", 14)
    monkeypatch.setattr(backend_config_module.config.session, "cleanup_min_interval_seconds", 0)
    monkeypatch.setattr(backend_config_module.config.jwt, "access_token_expire_minutes", 480)
    monkeypatch.setattr(session_service_module.config.session, "idle_timeout_minutes", 30)
    monkeypatch.setattr(session_service_module.config.session, "history_retention_days", 14)
    monkeypatch.setattr(session_service_module.config.session, "cleanup_min_interval_seconds", 0)
    monkeypatch.setattr(session_service_module.config.jwt, "access_token_expire_minutes", 480)
    return SessionService(file_path=tmp_path / "web_sessions.json")


def test_create_session_returns_active_payload_with_idle_expiry(isolated_session_service):
    created = isolated_session_service.create_session(
        session_id="session-create",
        user_id=1,
        username="admin",
        role="admin",
        ip_address="127.0.0.1",
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0.0.0",
        expires_at=_utc_now_iso(timedelta(hours=8)),
    )

    assert created["status"] == "active"
    assert created["idle_expires_at"]
    assert "Chrome" in created["device_label"]
    assert "Windows" in created["device_label"]


def test_idle_expired_session_becomes_invalid_without_logout(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-idle",
        user_id=1,
        username="admin",
        role="admin",
        ip_address="127.0.0.1",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(hours=8)),
    )
    sessions = isolated_session_service._load_sessions()
    sessions[0]["last_seen_at"] = _utc_now_iso(timedelta(minutes=-31))
    isolated_session_service._save_sessions(sessions)

    assert isolated_session_service.is_session_active("session-idle") is False

    session = next(item for item in isolated_session_service.list_sessions(active_only=False) if item["session_id"] == "session-idle")
    assert session["status"] == "expired_idle"
    assert session["is_active"] is False


def test_absolute_expired_session_becomes_invalid_even_when_recently_active(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-absolute",
        user_id=1,
        username="admin",
        role="admin",
        ip_address="127.0.0.1",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(minutes=-5)),
    )

    assert isolated_session_service.is_session_active("session-absolute") is False

    session = next(item for item in isolated_session_service.list_sessions(active_only=False) if item["session_id"] == "session-absolute")
    assert session["status"] == "expired_absolute"
    assert session["is_active"] is False


def test_cleanup_removes_old_history_and_keeps_multiple_active_sessions(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-a",
        user_id=7,
        username="user7",
        role="viewer",
        ip_address="10.0.0.1",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at=_utc_now_iso(timedelta(hours=8)),
    )
    isolated_session_service.create_session(
        session_id="session-b",
        user_id=7,
        username="user7",
        role="viewer",
        ip_address="10.0.0.2",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at=_utc_now_iso(timedelta(hours=8)),
    )

    stale_history = {
        "session_id": "stale-history",
        "user_id": 99,
        "username": "old-user",
        "role": "viewer",
        "ip_address": "127.0.0.1",
        "user_agent": "Mozilla/5.0",
        "created_at": _utc_now_iso(timedelta(days=-20)),
        "last_seen_at": _utc_now_iso(timedelta(days=-20)),
        "expires_at": _utc_now_iso(timedelta(days=-19)),
        "is_active": False,
        "closed_at": _utc_now_iso(timedelta(days=-19)),
        "closed_reason": "terminated",
        "mailbox_email": None,
        "mailbox_login": None,
        "mailbox_password_enc": "",
        "mail_auth_source": None,
    }
    sessions = isolated_session_service._load_sessions()
    sessions.append(stale_history)
    isolated_session_service._save_sessions(sessions)

    result = isolated_session_service.cleanup_sessions(force=True)

    assert result["deleted"] == 1
    active_sessions = isolated_session_service.list_sessions(active_only=True)
    assert {item["session_id"] for item in active_sessions} == {"session-a", "session-b"}


def test_purge_inactive_sessions_removes_all_non_active_records(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-active",
        user_id=3,
        username="user3",
        role="viewer",
        ip_address="10.0.0.3",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at=_utc_now_iso(timedelta(hours=8)),
    )
    isolated_session_service.create_session(
        session_id="session-expired",
        user_id=4,
        username="user4",
        role="viewer",
        ip_address="10.0.0.4",
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at=_utc_now_iso(timedelta(minutes=-5)),
    )

    result = isolated_session_service.purge_inactive_sessions()

    assert result["deleted"] == 1
    active_sessions = isolated_session_service.list_sessions(active_only=False)
    assert [item["session_id"] for item in active_sessions] == ["session-active"]


def test_non_admin_with_manage_users_permission_can_access_users_endpoint(monkeypatch):
    monkeypatch.setattr(auth.user_service, "list_users", lambda: [{
        "id": 1,
        "username": "demo",
        "email": None,
        "full_name": "Demo User",
        "is_active": True,
        "role": "viewer",
        "permissions": [],
        "use_custom_permissions": False,
        "custom_permissions": [],
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }])
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.users.manage"])

    response = TestClient(app).get("/auth/users")

    assert response.status_code == 200
    assert response.json()[0]["username"] == "demo"


def test_non_admin_with_manage_sessions_permission_can_access_sessions_endpoint(monkeypatch):
    monkeypatch.setattr(auth.session_service, "list_sessions", lambda active_only=True: [{
        "session_id": "active-session",
        "user_id": 10,
        "username": "demo",
        "role": "viewer",
        "ip_address": "127.0.0.1",
        "user_agent": "Mozilla/5.0",
        "created_at": _utc_now_iso(timedelta(minutes=-10)),
        "last_seen_at": _utc_now_iso(timedelta(minutes=-1)),
        "expires_at": _utc_now_iso(timedelta(hours=7)),
        "idle_expires_at": _utc_now_iso(timedelta(minutes=29)),
        "is_active": True,
        "status": "active",
        "closed_at": None,
        "closed_reason": None,
        "device_label": "Chrome on Windows",
    }])
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.sessions.manage"])

    response = TestClient(app).get("/auth/sessions")

    assert response.status_code == 200
    assert response.json()[0]["session_id"] == "active-session"


def test_non_admin_with_manage_sessions_permission_can_purge_inactive_sessions(monkeypatch):
    monkeypatch.setattr(auth.session_service, "purge_inactive_sessions", lambda: {
        "deactivated": 1,
        "deleted": 4,
    })
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _make_user(permissions=["settings.sessions.manage"])

    response = TestClient(app).post("/auth/sessions/purge-inactive")

    assert response.status_code == 200
    assert response.json() == {"deactivated": 1, "deleted": 4}
