from __future__ import annotations

import sys
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

trusted_module = importlib.import_module("backend.services.trusted_device_service")
from backend.services.trusted_device_service import TrustedDeviceService


def _sqlite_url(temp_dir: str, name: str = "trusted_devices.db") -> str:
    return f"sqlite:///{Path(temp_dir) / name}"


def test_trusted_device_expires_after_configured_ttl(temp_dir, monkeypatch):
    now = datetime(2026, 4, 24, 10, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(trusted_module, "_utc_now", lambda: now)
    monkeypatch.setattr(trusted_module.config.security, "trusted_device_ttl_days", 90, raising=False)
    service = TrustedDeviceService(database_url=_sqlite_url(temp_dir))

    created = service.register_device(
        user_id=7,
        label="Work laptop",
        credential_id="credential-1",
        public_key_b64="public-key",
        sign_count=0,
        transports=["internal"],
        aaguid=None,
        rp_id="hubit.zsgp.ru",
        origin="https://hubit.zsgp.ru",
        is_discoverable=True,
    )

    assert created["expires_at"]
    assert service.find_device_by_credential("credential-1", user_id=7)

    monkeypatch.setattr(trusted_module, "_utc_now", lambda: now + timedelta(days=91))

    assert service.find_device_by_credential("credential-1", user_id=7) is None
    expired = service.get_device(created["id"])
    assert expired["is_active"] is False
    assert expired["is_expired"] is True
