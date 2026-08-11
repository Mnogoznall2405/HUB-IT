from __future__ import annotations

import importlib
import os
import re
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.session_service import SessionService


session_service_module = importlib.import_module("backend.services.session_service")


def _utc_iso(offset: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + offset).isoformat()


def _new_service(tmp_path, monkeypatch) -> SessionService:
    monkeypatch.setattr(session_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(session_service_module.config.session, "max_active_per_user", 3, raising=False)
    monkeypatch.setattr(session_service_module.config.session, "cleanup_min_interval_seconds", 0)
    return SessionService(file_path=tmp_path / "web_sessions.json")


def _new_app_db_service(tmp_path, monkeypatch) -> SessionService:
    monkeypatch.setattr(session_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(session_service_module.config.session, "max_active_per_user", 3, raising=False)
    monkeypatch.setattr(session_service_module.config.session, "cleanup_min_interval_seconds", 0)
    database_url = f"sqlite:///{(tmp_path / 'sessions.db').as_posix()}"
    return SessionService(
        file_path=tmp_path / "web_sessions.json",
        database_url=database_url,
    )


def _create(service: SessionService, *, session_id: str, device_id: str | None, ip: str) -> dict:
    return service.create_session(
        session_id=session_id,
        user_id=7,
        username="user7",
        role="viewer",
        ip_address=ip,
        user_agent="Mozilla/5.0 Chrome/142.0.0.0",
        expires_at=_utc_iso(timedelta(days=1)),
        client_device_id=device_id,
    )


def test_same_client_device_reuses_session_when_ip_changes(tmp_path, monkeypatch):
    service = _new_service(tmp_path, monkeypatch)

    first = _create(service, session_id="session-first", device_id="browser-a-000000000000", ip="10.0.0.1")
    second = _create(service, session_id="session-second", device_id="browser-a-000000000000", ip="10.0.0.2")

    assert first["_session_reused"] is False
    assert second["_session_reused"] is True
    assert second["session_id"] == first["session_id"]
    active = service.list_sessions(active_only=True)
    assert len(active) == 1
    assert active[0]["ip_address"] == "10.0.0.2"


def test_different_devices_are_limited_per_user(tmp_path, monkeypatch):
    service = _new_service(tmp_path, monkeypatch)

    for index in range(4):
        _create(service, session_id=f"session-{index}", device_id=f"browser-{index}-000000000000", ip=f"10.0.0.{index + 1}")

    active = service.list_sessions(active_only=True)
    assert len(active) == 3
    assert {item["session_id"] for item in active} == {"session-1", "session-2", "session-3"}


def test_legacy_sessions_without_device_id_count_toward_limit(tmp_path, monkeypatch):
    service = _new_service(tmp_path, monkeypatch)

    for index in range(3):
        _create(service, session_id=f"legacy-{index}", device_id=None, ip=f"10.0.0.{index + 1}")
    _create(service, session_id="new-device", device_id="browser-new-000000000000", ip="10.0.0.10")

    active = service.list_sessions(active_only=True)
    assert len(active) == 3
    assert "legacy-0" not in {item["session_id"] for item in active}


def test_normalize_limit_supports_dry_run_and_apply(tmp_path, monkeypatch):
    service = _new_service(tmp_path, monkeypatch)
    sessions = []
    for index in range(5):
        sessions.append(
            {
                "session_id": f"session-{index}",
                "user_id": 7,
                "username": "user7",
                "role": "viewer",
                "ip_address": "10.0.0.1",
                "user_agent": "Mozilla/5.0",
                "created_at": _utc_iso(timedelta(minutes=-index - 1)),
                "last_seen_at": _utc_iso(timedelta(minutes=-index - 1)),
                "expires_at": _utc_iso(timedelta(days=1)),
                "idle_expires_at": None,
                "is_active": True,
                "status": "active",
                "closed_at": None,
                "closed_reason": None,
                "trusted_device_id": None,
                "login_network_zone": "internal",
                "device_label": "Chrome on Windows",
                "client_device_key_hash": None,
            }
        )
    service._save_sessions(sessions)

    preview = service.normalize_active_session_limits(apply=False)
    assert preview["sessions_to_close"] == 2
    assert len(service.list_sessions(active_only=True)) == 5

    applied = service.normalize_active_session_limits(apply=True)
    assert applied["sessions_closed"] == 2
    assert len(service.list_sessions(active_only=True)) == 3


def test_app_database_reuses_device_and_enforces_limit(tmp_path, monkeypatch):
    service = _new_app_db_service(tmp_path, monkeypatch)

    first = _create(service, session_id="app-first", device_id="browser-a-000000000000", ip="10.0.0.1")
    reused = _create(service, session_id="app-reused", device_id="browser-a-000000000000", ip="10.0.0.2")
    assert first["_session_reused"] is False
    assert reused["_session_reused"] is True
    assert reused["session_id"] == first["session_id"]

    for index in range(3):
        _create(
            service,
            session_id=f"app-device-{index}",
            device_id=f"browser-{index}-000000000000",
            ip=f"10.0.0.{index + 3}",
        )

    active = service.list_sessions(active_only=True)
    assert len(active) == 3
    assert {item["session_id"] for item in active} == {"app-device-0", "app-device-1", "app-device-2"}


def test_postgres_concurrent_logins_do_not_exceed_limit(monkeypatch):
    raw_database_url = str(os.getenv("TEST_DATABASE_URL") or "").strip()
    if not raw_database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")

    from sqlalchemy import delete
    from sqlalchemy.engine import make_url

    from backend.appdb.db import app_session
    from backend.appdb.models import AppSessionRecord, AppUser

    parsed_url = make_url(raw_database_url)
    database_name = str(parsed_url.database or "").strip().lower()
    if parsed_url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL TEST_DATABASE_URL is required")
    if not re.search(r"(?:^|[_-])test(?:[_-]|$)", database_name):
        pytest.fail(f"REFUSED non-test database: {database_name!r}")

    user_id = 1_000_000_000 + uuid.uuid4().int % 1_000_000_000
    username = f"session_limit_test_{uuid.uuid4().hex[:12]}"
    service = SessionService(database_url=raw_database_url)
    monkeypatch.setattr(session_service_module.config.session, "max_active_per_user", 3, raising=False)
    monkeypatch.setattr(session_service_module.config.session, "cleanup_min_interval_seconds", 0)

    with app_session(raw_database_url) as session:
        session.add(AppUser(id=user_id, username=username, role="viewer"))

    worker_count = 8
    barrier = threading.Barrier(worker_count)

    def _login(index: int) -> dict:
        barrier.wait(timeout=10)
        return service.create_session(
            session_id=f"pg-session-{uuid.uuid4().hex}",
            user_id=user_id,
            username=username,
            role="viewer",
            ip_address=f"10.20.30.{index + 1}",
            user_agent="pytest-postgres-concurrency",
            expires_at=_utc_iso(timedelta(days=1)),
            client_device_id=f"pg-device-{index:02d}-000000000000",
        )

    try:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            results = list(executor.map(_login, range(worker_count)))

        assert len(results) == worker_count
        active = [
            item
            for item in service.list_sessions(active_only=True)
            if int(item.get("user_id", 0) or 0) == user_id
        ]
        assert len(active) == 3
    finally:
        with app_session(raw_database_url) as session:
            session.execute(delete(AppSessionRecord).where(AppSessionRecord.user_id == user_id))
            session.execute(delete(AppUser).where(AppUser.id == user_id))
