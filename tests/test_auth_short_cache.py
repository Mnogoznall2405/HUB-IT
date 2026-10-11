"""Hot-path auth checks (revoked token / trusted device) are remembered for a few seconds.

Why unit tests: this is a security-relevant cache. The failure modes — a revocation that does not
take effect in the revoking process, or a cache that never expires — cannot be seen through the
HTTP boundary on sqlite, so they are pinned here."""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import auth_short_cache
from backend.services.auth_runtime_store_service import AuthRuntimeStoreService
from backend.services.trusted_device_service import TrustedDeviceService


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _install_clock(monkeypatch) -> _Clock:
    clock = _Clock()
    monkeypatch.setattr(auth_short_cache.time, "monotonic", clock)
    return clock


def test_not_revoked_answer_is_cached_briefly_and_expires(monkeypatch):
    monkeypatch.delenv("AUTH_REVOCATION_CACHE_TTL_SEC", raising=False)
    clock = _install_clock(monkeypatch)
    service = AuthRuntimeStoreService()
    reads: list[str] = []
    monkeypatch.setattr(service, "get_text", lambda namespace, key: reads.append(key))

    assert service.is_jti_revoked("jti-1") is False
    assert service.is_jti_revoked("jti-1") is False
    assert reads == ["jti-1"]  # the second answer came from memory

    clock.now += 3.5  # default TTL is 3 s
    assert service.is_jti_revoked("jti-1") is False
    assert reads == ["jti-1", "jti-1"]


def test_revoking_in_this_process_takes_effect_immediately(monkeypatch):
    clock = _install_clock(monkeypatch)
    service = AuthRuntimeStoreService()
    assert service.is_jti_revoked("jti-2") is False  # remembered as "allowed"
    service.revoke_jti("jti-2", 60)
    assert service.is_jti_revoked("jti-2") is True
    clock.now += 100
    assert service.is_jti_revoked("jti-2") is True


def test_refresh_rotation_revokes_the_old_token_at_once(monkeypatch):
    _install_clock(monkeypatch)
    service = AuthRuntimeStoreService()
    assert service.is_jti_revoked("old-jti") is False
    service.revoke_jti("old-jti", 60)
    assert service.is_jti_revoked("old-jti") is True


def test_ttl_zero_disables_the_cache(monkeypatch):
    monkeypatch.setenv("AUTH_REVOCATION_CACHE_TTL_SEC", "0")
    _install_clock(monkeypatch)
    service = AuthRuntimeStoreService()
    reads: list[str] = []
    monkeypatch.setattr(service, "get_text", lambda namespace, key: reads.append(key))
    service.is_jti_revoked("jti-3")
    service.is_jti_revoked("jti-3")
    assert len(reads) == 2


def test_only_valid_devices_are_cached_and_revocation_clears_the_cache(temp_dir, monkeypatch):
    clock = _install_clock(monkeypatch)
    service = TrustedDeviceService(database_url=f"sqlite:///{Path(temp_dir) / 'devices.db'}")
    created = service.register_device(
        user_id=7, label="Phone", credential_id="cred-1", public_key_b64="key", sign_count=0,
        transports=["internal"], aaguid=None, rp_id="hubit.zsgp.ru", origin="https://hubit.zsgp.ru",
        is_discoverable=True,
    )
    token_device = f"trusted:{created['id']}"
    lookups: list[str] = []
    original = service.get_device

    def counting(device_id, **kwargs):
        lookups.append(device_id)
        return original(device_id, **kwargs)

    monkeypatch.setattr(service, "get_device", counting)

    assert service.is_token_device_valid(user_id=7, token_device_id=token_device) is True
    assert service.is_token_device_valid(user_id=7, token_device_id=token_device) is True
    assert len(lookups) == 1
    # A different user must not ride on someone else's cached answer.
    assert service.is_token_device_valid(user_id=8, token_device_id=token_device) is False

    service.revoke_device(user_id=7, device_id=created["id"])
    assert service.is_token_device_valid(user_id=7, token_device_id=token_device) is False
    clock.now += 100
    assert service.is_token_device_valid(user_id=7, token_device_id=token_device) is False
