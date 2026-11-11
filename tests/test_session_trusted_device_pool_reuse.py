from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.models import AppSessionRecord
from backend.services.session_service import SessionService
from backend.services.trusted_device_service import TrustedDeviceService


session_service_module = importlib.import_module("backend.services.session_service")


def test_trusted_device_lookup_reuses_supplied_app_session(monkeypatch):
    service = object.__new__(TrustedDeviceService)
    row = object()
    supplied_session = SimpleNamespace(get=lambda model, key: row)
    monkeypatch.setattr(service, "_expire_row_if_needed", lambda candidate: False)
    monkeypatch.setattr(service, "_row_to_dict", lambda candidate: {"id": "trusted-1"})

    result = service.get_device("trusted-1", db_session=supplied_session)

    assert result == {"id": "trusted-1"}


def test_session_normalization_passes_current_transaction_to_trusted_lookup(monkeypatch):
    now = datetime.now(timezone.utc)
    row = AppSessionRecord(
        session_id="session-1",
        user_id=1,
        username="user",
        role="viewer",
        ip_address="203.0.113.10",
        user_agent="pytest",
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=1),
        idle_expires_at=now + timedelta(days=7),
        is_active=True,
        status="active",
        trusted_device_id="trusted-1",
        login_network_zone="external",
    )
    supplied_session = object()
    seen_sessions: list[object] = []

    def get_device(device_id: str, *, db_session=None):
        assert device_id == "trusted-1"
        seen_sessions.append(db_session)
        return {"id": device_id, "is_active": True, "is_expired": False}

    monkeypatch.setattr(session_service_module.trusted_device_service, "get_device", get_device)
    service = object.__new__(SessionService)

    payload = service._normalize_db_row(row, now=now, db_session=supplied_session)

    assert payload["status"] == "active"
    assert seen_sessions
    assert all(candidate is supplied_session for candidate in seen_sessions)
