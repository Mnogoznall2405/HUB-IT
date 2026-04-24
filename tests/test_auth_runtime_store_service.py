from __future__ import annotations

import sys
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

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
