from __future__ import annotations

from datetime import datetime, timedelta, timezone
import importlib

import pytest


def _utc_now_iso(delta: timedelta = timedelta()) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


@pytest.fixture
def isolated_session_service(tmp_path, monkeypatch):
    from backend import config as backend_config_module
    from backend.services.session_service import SessionService

    session_service_module = importlib.import_module("backend.services.session_service")
    monkeypatch.setattr(backend_config_module.config.session, "idle_timeout_minutes", 30)
    monkeypatch.setattr(backend_config_module.config.session, "idle_timeout_trusted_days", 7)
    monkeypatch.setattr(backend_config_module.config.session, "idle_timeout_internal_days", 7)
    monkeypatch.setattr(backend_config_module.config.session, "cleanup_min_interval_seconds", 0)
    monkeypatch.setattr(session_service_module.config.session, "idle_timeout_minutes", 30)
    monkeypatch.setattr(session_service_module.config.session, "idle_timeout_trusted_days", 7)
    monkeypatch.setattr(session_service_module.config.session, "idle_timeout_internal_days", 7)
    monkeypatch.setattr(session_service_module.config.session, "cleanup_min_interval_seconds", 0)
    monkeypatch.setattr(session_service_module, "is_app_database_configured", lambda: False)
    return SessionService(file_path=tmp_path / "web_sessions.json")


def test_internal_session_stays_active_after_thirty_minutes_without_http(isolated_session_service):
    """Requirement: idle tab >30m then API auth check still succeeds for internal."""
    created = isolated_session_service.create_session(
        session_id="session-internal-idle",
        user_id=11,
        username="office_user",
        role="viewer",
        ip_address="10.12.1.40",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(days=7)),
        login_network_zone="internal",
    )
    assert created["login_network_zone"] == "internal"

    sessions = isolated_session_service._load_sessions()
    sessions[0]["last_seen_at"] = _utc_now_iso(timedelta(minutes=-45))
    sessions[0]["idle_expires_at"] = None
    isolated_session_service._save_sessions(sessions)
    isolated_session_service._cache_invalidate("session-internal-idle")

    assert isolated_session_service.is_session_active("session-internal-idle") is True

    diagnostics = isolated_session_service.build_session_diagnostics("session-internal-idle")
    assert diagnostics is not None
    assert diagnostics["closed_reason"] is None
    assert diagnostics["status"] == "active"
    assert diagnostics["login_network_zone"] == "internal"
    assert diagnostics["absolute_expires_at"]
    assert diagnostics["refresh_expires_at"]
    idle_expires = datetime.fromisoformat(diagnostics["idle_expires_at"])
    last_seen = datetime.fromisoformat(diagnostics["last_seen_at"])
    assert idle_expires - last_seen >= timedelta(days=6, hours=23)


def test_reapply_idle_policy_upgrades_legacy_internal_sessions(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-legacy",
        user_id=12,
        username="legacy_user",
        role="viewer",
        ip_address="10.99.1.2",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(days=7)),
        login_network_zone="external",
    )
    sessions = isolated_session_service._load_sessions()
    sessions[0]["login_network_zone"] = None
    sessions[0]["last_seen_at"] = _utc_now_iso(timedelta(minutes=-40))
    # Simulate old writer that stamped +30 minutes.
    sessions[0]["idle_expires_at"] = _utc_now_iso(timedelta(minutes=-10))
    isolated_session_service._save_sessions(sessions)
    isolated_session_service._cache_invalidate("session-legacy")

    result = isolated_session_service.reapply_idle_policy_for_active_sessions()
    assert result["updated"] >= 1
    assert isolated_session_service.is_session_active("session-legacy") is True
    diagnostics = isolated_session_service.build_session_diagnostics("session-legacy")
    assert diagnostics["login_network_zone"] == "internal"
    idle_expires = datetime.fromisoformat(diagnostics["idle_expires_at"])
    assert idle_expires > datetime.now(timezone.utc) + timedelta(days=6)


def test_external_password_session_still_expires_after_thirty_minutes(isolated_session_service):
    isolated_session_service.create_session(
        session_id="session-external",
        user_id=13,
        username="remote_user",
        role="viewer",
        ip_address="203.0.113.10",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(days=7)),
        login_network_zone="external",
    )
    sessions = isolated_session_service._load_sessions()
    sessions[0]["last_seen_at"] = _utc_now_iso(timedelta(minutes=-45))
    isolated_session_service._save_sessions(sessions)
    isolated_session_service._cache_invalidate("session-external")
    assert isolated_session_service.is_session_active("session-external") is False


def test_office_ip_keeps_seven_day_idle_even_if_zone_mislabeled_external(isolated_session_service):
    created = isolated_session_service.create_session(
        session_id="session-mislabeled",
        user_id=14,
        username="office_mislabeled",
        role="viewer",
        ip_address="10.50.1.9",
        user_agent="Mozilla/5.0",
        expires_at=_utc_now_iso(timedelta(days=7)),
        login_network_zone="external",
    )
    assert created["login_network_zone"] == "internal"
    idle_expires = datetime.fromisoformat(created["idle_expires_at"])
    created_at = datetime.fromisoformat(created["created_at"])
    assert idle_expires - created_at >= timedelta(days=6, hours=23)

    sessions = isolated_session_service._load_sessions()
    sessions[0]["login_network_zone"] = "external"
    sessions[0]["last_seen_at"] = _utc_now_iso(timedelta(minutes=-45))
    sessions[0]["idle_expires_at"] = _utc_now_iso(timedelta(minutes=-10))
    isolated_session_service._save_sessions(sessions)
    isolated_session_service._cache_invalidate("session-mislabeled")
    assert isolated_session_service.is_session_active("session-mislabeled") is True
