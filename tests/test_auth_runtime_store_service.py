from __future__ import annotations

import sys
import importlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

runtime_module = importlib.import_module("backend.services.auth_runtime_store_service")
from backend.services.auth_runtime_store_service import AuthRuntimeStoreService


def _sqlite_url(temp_dir: str, name: str = "auth_runtime.db") -> str:
    return f"sqlite:///{Path(temp_dir) / name}"


def test_db_runtime_store_expires_ttl_items(temp_dir, monkeypatch):
    now = datetime(2026, 4, 24, 10, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now)
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))

    service.set_text("ttl", "key", "value", ttl_seconds=30)
    assert service.get_text("ttl", "key") == "value"

    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now + timedelta(seconds=31))

    assert service.get_text("ttl", "key") is None


def test_db_runtime_store_consumes_once(temp_dir):
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))

    service.set_json("challenge", "abc", {"user_id": 7}, ttl_seconds=300)

    assert service.pop_json("challenge", "abc") == {"user_id": 7}
    assert service.pop_json("challenge", "abc") is None


def test_db_runtime_store_refresh_rotation_is_one_time(temp_dir):
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))

    service.save_refresh_token("refresh-jti", {"session_id": "s1", "user_id": 7}, ttl_seconds=300)

    assert service.consume_refresh_token("refresh-jti") == {"session_id": "s1", "user_id": 7}
    assert service.consume_refresh_token("refresh-jti") is None


def test_db_runtime_store_increments_rate_counter_atomically(temp_dir, monkeypatch):
    now = datetime(2026, 4, 24, 10, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now)
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))

    first = service.increment_counter("rate", "ip:user", window_seconds=60)
    second = service.increment_counter("rate", "ip:user", window_seconds=60)

    assert first["count"] == 1
    assert second["count"] == 2

    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now + timedelta(seconds=61))
    reset = service.increment_counter("rate", "ip:user", window_seconds=60)

    assert reset["count"] == 1


def test_db_runtime_store_cleanup_expired_rows(temp_dir, monkeypatch):
    now = datetime(2026, 4, 24, 10, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now)
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))

    service.set_text("cleanup", "expired", "1", ttl_seconds=10)
    service.set_text("cleanup", "active", "1", ttl_seconds=120)
    monkeypatch.setattr(runtime_module, "_utc_now", lambda: now + timedelta(seconds=30))

    assert service.cleanup_expired() == 1
    assert service.get_text("cleanup", "expired") is None
    assert service.get_text("cleanup", "active") == "1"


def _replacement(jti="new-jti"):
    return {
        "access_token": "synthetic-access", "refresh_token": "synthetic-refresh",
        "access_ttl_seconds": 900, "refresh_ttl_seconds": 600,
        "user": {"id": 7}, "session_id": "s1", "_refresh_jti": jti,
        "_refresh_state": {"user_id": 7, "session_id": "s1", "device_id": "d1"},
    }


@pytest.mark.parametrize("memory", [False, True])
def test_complete_rotation_has_one_winner_and_bounded_replay(temp_dir, monkeypatch, memory):
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))
    if memory:
        monkeypatch.setattr(service, "_use_database_backend", lambda: False)
    old_state = {"session_id": "s1", "user_id": 7, "device_id": "d1"}
    service.save_refresh_token("old-jti", old_state, ttl_seconds=600)
    first = service.complete_refresh_rotation("old-jti", _replacement(), grace_ttl_seconds=15, revoke_ttl_seconds=600)
    second = service.complete_refresh_rotation("old-jti", _replacement("loser-jti"), grace_ttl_seconds=15, revoke_ttl_seconds=600)
    assert second == first
    assert service.get_json("refresh", "old-jti") is None
    assert service.get_json("refresh", "new-jti") == old_state
    assert service.get_json("refresh", "loser-jti") is None
    assert service.is_jti_revoked("old-jti")
    service.delete("refresh_grace", "old-jti")
    assert service.complete_refresh_rotation("old-jti", _replacement("replay-jti"), grace_ttl_seconds=15, revoke_ttl_seconds=600) is None
    assert service.get_json("refresh", "replay-jti") is None


def test_rotation_database_rollback_keeps_old_token(temp_dir, monkeypatch):
    service = AuthRuntimeStoreService(database_url=_sqlite_url(temp_dir))
    old_state = {"session_id": "s1", "user_id": 7}
    service.save_refresh_token("old-jti", old_state, ttl_seconds=600)
    original_session = runtime_module.app_session

    @contextmanager
    def failing_commit(database_url=None):
        with original_session(database_url) as session:
            yield session
            session.flush()
            raise RuntimeError("simulated commit failure after all rotation writes")

    with monkeypatch.context() as patch:
        patch.setattr(runtime_module, "app_session", failing_commit)
        with pytest.raises(RuntimeError, match="simulated commit failure"):
            service.complete_refresh_rotation("old-jti", _replacement(), grace_ttl_seconds=15, revoke_ttl_seconds=600)
    assert service.get_json("refresh", "old-jti") == old_state
    assert service.get_json("refresh", "new-jti") is None
    assert service.get_refresh_rotation_grace("old-jti") is None
    assert not service.is_jti_revoked("old-jti")
