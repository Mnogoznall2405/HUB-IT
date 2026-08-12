from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import desktop_presence as desktop_presence_api
from backend.appdb.db import app_session, initialize_app_schema
from backend.appdb.models import AppDesktopPresence
from backend.models.auth import User
from backend.services.desktop_presence_service import DesktopPresenceService


def _sqlite_url(tmp_path) -> str:
    return f"sqlite:///{(tmp_path / 'app.db').as_posix()}"


def _user(user_id: int = 7) -> User:
    return User(
        id=user_id,
        username=f"user-{user_id}",
        role="viewer",
        is_active=True,
    )


def test_heartbeat_upserts_one_row_per_authenticated_session(tmp_path):
    database_url = _sqlite_url(tmp_path)
    initialize_app_schema(database_url)
    now = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
    clock = [now]
    service = DesktopPresenceService(
        database_url=database_url,
        ttl_seconds=180,
        clock=lambda: clock[0],
    )

    first = service.heartbeat(user_id=7, session_id="session-a")
    clock[0] += timedelta(seconds=60)
    second = service.heartbeat(user_id=7, session_id="session-a")

    assert first == {"active": True, "expires_in_seconds": 180}
    assert second == {"active": True, "expires_in_seconds": 180}
    with app_session(database_url) as session:
        rows = session.query(AppDesktopPresence).all()
        assert len(rows) == 1
        assert rows[0].user_id == 7
        assert rows[0].session_id == "session-a"
        assert rows[0].last_seen_at.replace(tzinfo=timezone.utc) == clock[0]


def test_presence_keeps_multiple_sessions_for_one_user_independent(tmp_path):
    database_url = _sqlite_url(tmp_path)
    initialize_app_schema(database_url)
    now = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
    service = DesktopPresenceService(database_url=database_url, clock=lambda: now)

    service.heartbeat(user_id=7, session_id="desktop-pc-a")
    service.heartbeat(user_id=7, session_id="desktop-pc-b")

    assert service.count_active_for_user(user_id=7) == 2
    assert service.disconnect(user_id=7, session_id="desktop-pc-a") is True
    assert service.count_active_for_user(user_id=7) == 1
    assert service.get_current(user_id=7, session_id="desktop-pc-a")["active"] is False
    assert service.get_current(user_id=7, session_id="desktop-pc-b")["active"] is True


def test_presence_expires_at_server_ttl_boundary_and_cleanup_is_bounded(tmp_path):
    database_url = _sqlite_url(tmp_path)
    initialize_app_schema(database_url)
    clock = [datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)]
    service = DesktopPresenceService(
        database_url=database_url,
        ttl_seconds=180,
        clock=lambda: clock[0],
    )
    for index in range(3):
        service.heartbeat(user_id=7, session_id=f"session-{index}")

    clock[0] += timedelta(seconds=179)
    assert service.count_active_for_user(user_id=7) == 3
    clock[0] += timedelta(seconds=1)
    assert service.count_active_for_user(user_id=7) == 0
    assert service.cleanup_expired(limit=2) == 2
    assert service.cleanup_expired(limit=2) == 1


def test_disconnect_cannot_remove_another_users_session(tmp_path):
    database_url = _sqlite_url(tmp_path)
    initialize_app_schema(database_url)
    service = DesktopPresenceService(database_url=database_url)
    service.heartbeat(user_id=7, session_id="session-a")

    assert service.disconnect(user_id=8, session_id="session-a") is False
    assert service.get_current(user_id=7, session_id="session-a")["active"] is True


class _FakePresenceService:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def heartbeat(self, *, user_id: int, session_id: str):
        self.calls.append(("heartbeat", user_id, session_id))
        return {"active": True, "expires_in_seconds": 180}

    def get_current(self, *, user_id: int, session_id: str):
        self.calls.append(("status", user_id, session_id))
        return {"active": True, "expires_in_seconds": 120}

    def disconnect(self, *, user_id: int, session_id: str):
        self.calls.append(("disconnect", user_id, session_id))
        return True


def _presence_client(monkeypatch, *, session_id: str | None = "session-api"):
    app = FastAPI()
    app.include_router(desktop_presence_api.router, prefix="/desktop-presence")
    app.dependency_overrides[deps.get_current_active_user] = lambda: _user()
    app.dependency_overrides[deps.get_current_session_id] = lambda: session_id
    fake = _FakePresenceService()
    monkeypatch.setattr(desktop_presence_api, "desktop_presence_service", fake)
    return TestClient(app), fake


def test_presence_api_binds_identity_to_dependencies_and_returns_no_identifier(monkeypatch):
    client, fake = _presence_client(monkeypatch)

    heartbeat = client.post("/desktop-presence/heartbeat", json={})
    status = client.get("/desktop-presence/status")
    disconnected = client.delete("/desktop-presence/current")

    assert heartbeat.status_code == 200
    assert heartbeat.json() == {"active": True, "expires_in_seconds": 180}
    assert status.json() == {"active": True, "expires_in_seconds": 120}
    assert disconnected.json() == {"active": False, "expires_in_seconds": 0}
    assert fake.calls == [
        ("heartbeat", 7, "session-api"),
        ("status", 7, "session-api"),
        ("disconnect", 7, "session-api"),
    ]
    assert "session" not in heartbeat.text.lower()


def test_presence_api_rejects_client_selected_identity_and_missing_session(monkeypatch):
    client, fake = _presence_client(monkeypatch)
    expanded = client.post(
        "/desktop-presence/heartbeat",
        json={"user_id": 99, "session_id": "victim", "device_id": "chosen"},
    )
    assert expanded.status_code == 422
    assert fake.calls == []

    no_session_client, _ = _presence_client(monkeypatch, session_id=None)
    missing_session = no_session_client.post("/desktop-presence/heartbeat", json={})
    assert missing_session.status_code == 401


def test_presence_api_requires_authentication():
    app = FastAPI()
    app.include_router(desktop_presence_api.router, prefix="/desktop-presence")

    response = TestClient(app).post("/desktop-presence/heartbeat", json={})

    assert response.status_code == 401
