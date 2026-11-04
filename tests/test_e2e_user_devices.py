"""Real auth routes, JWTs and SQLite stores: owner boundaries and remote revocation."""
import hashlib
import importlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from test_e2e_smoke import app, auth, deps, config, _stub_auth_env, _USER_PAYLOAD
from backend.appdb.db import app_session
from backend.appdb.models import AppMobileBiometricCredential, AppUser, AppSessionRecord
from backend.services.session_service import SessionService, hash_client_device_id, SessionCredentialRevokedError
from backend.services.user_device_service import UserDeviceService


@pytest.fixture
def devices_env(prebuilt_app_db, monkeypatch):
    url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    service = SessionService(database_url=url)
    security = importlib.import_module("backend.services.auth_security_service")
    devices_module = importlib.import_module("backend.services.user_device_service")
    ws_auth = importlib.import_module("backend.chat.ws_auth")
    _stub_auth_env(monkeypatch)
    for module in (auth, deps, security, devices_module, ws_auth):
        monkeypatch.setattr(module, "session_service", service)
    monkeypatch.setattr(auth, "user_device_service", UserDeviceService(url))
    monkeypatch.setattr(auth.mobile_biometric_session_service, "_database_url", url)
    monkeypatch.setattr(config.security, "twofa_policy", "off")
    with app_session(url) as db:
        for uid in (7, 8):
            db.add(AppUser(id=uid, username=f"device-user-{uid}", is_active=True, is_2fa_enabled=True))

    def login(device):
        client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
        client.headers.update({"X-Auth-Client": "mobile", "X-Client-Device-ID": device})
        response = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
        assert response.status_code == 200, response.text
        payload = response.json()
        client.headers["Authorization"] = f"Bearer {payload['access_token']}"
        return client, payload

    def credential(device, credential_id="a" * 32):
        token = f"mb1.{credential_id}.{'B' * 48}"
        with app_session(url) as db:
            db.add(AppMobileBiometricCredential(
                id=credential_id, user_id=7, client_device_key_hash=hash_client_device_id(device),
                token_hash=hashlib.sha256(token.encode()).hexdigest(), is_active=True,
            ))
        return token

    return login, credential, service, url


def test_own_devices_group_installation_without_exposing_foreign_sessions(devices_env):
    login, _, service, _ = devices_env
    first, a = login("installation-one")
    second, b = login("installation-two")
    _, repeated = login("installation-two")
    assert b["session_id"] == repeated["session_id"]
    service.create_session(session_id="foreign-session", user_id=8, username="other", role="viewer",
                           ip_address="10.0.0.1", user_agent="Other", client_device_id="foreign-device",
                           expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
    response = first.get("/api/v1/auth/my-devices")
    assert response.status_code == 200, response.text
    devices = response.json()
    assert len(devices) == 2
    assert devices[0]["is_current"] is True
    assert {s["session_id"] for d in devices for s in d["sessions"]} == {a["session_id"], b["session_id"]}
    assert first.delete("/api/v1/auth/my-devices/s:foreign-session").status_code == 404
    assert first.delete("/api/v1/auth/my-devices/sessions/foreign-session").status_code == 404
    assert service.is_session_active("foreign-session") is True
    assert second.get("/api/v1/auth/me").status_code == 200


def test_remove_device_revokes_access_refresh_grace_and_biometrics(devices_env):
    login, credential, _, url = devices_env
    first, _ = login("installation-one")
    second, b = login("installation-two")
    renewal = credential("installation-two")
    enrollment = auth.mobile_biometric_session_service.issue_enrollment_code(
        user_id=7, client_device_id="installation-two", session_id=b["session_id"])
    from backend.chat.ws_auth import WsSessionLease
    lease = WsSessionLease(b["access_token"], user_id=7)
    assert lease.revalidate() == "ok"
    # Prime rotation grace before remote deletion.
    refresh = second.post("/api/v1/auth/refresh", json={"refresh_token": b["refresh_token"]})
    assert refresh.status_code == 200, refresh.text
    target = f"/api/v1/auth/my-devices/s:{b['session_id']}"
    removed = first.delete(target)
    assert removed.status_code == 200, removed.text
    assert removed.json()["revoked_biometric_credentials"] == 1
    assert first.delete(target).json()["closed_sessions"] == 0
    assert second.get("/api/v1/auth/me").status_code == 401
    assert lease.revalidate() == "dead"
    assert second.post("/api/v1/auth/refresh", json={"refresh_token": b["refresh_token"]}).status_code == 401
    assert second.post("/api/v1/auth/mobile-biometric/session", json={"renewal_token": renewal}).status_code == 401
    late_enrollment = first.post("/api/v1/auth/mobile-biometric/enroll", json={"enrollment_code": enrollment},
                                 headers={"X-Client-Device-ID": "installation-two"})
    assert late_enrollment.status_code == 400, late_enrollment.text
    assert first.get("/api/v1/auth/me").status_code == 200
    with app_session(url) as db:
        assert db.get(AppSessionRecord, b["session_id"]).closed_reason == "terminated"


def test_parallel_removal_preserves_closed_state_and_current_device(devices_env):
    login, credential, service, _ = devices_env
    current, _ = login("installation-one")
    other, data = login("installation-two")
    credential("installation-two")
    path = f"/api/v1/auth/my-devices/s:{data['session_id']}"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: current.delete(path), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert not service.is_session_active(data["session_id"])
    assert other.get("/api/v1/auth/me").status_code == 401
    assert current.get("/api/v1/auth/me").status_code == 200
    assert len(current.get("/api/v1/auth/my-devices").json()) == 1


def test_device_management_rejects_anonymous_requests():
    client = TestClient(app, base_url="https://testserver")
    assert client.get("/api/v1/auth/my-devices").status_code == 401
    assert client.post("/api/v1/auth/my-devices/terminate-others").status_code == 401
    assert client.delete("/api/v1/auth/my-devices/s:unknown").status_code == 401
    assert client.delete("/api/v1/auth/my-devices/sessions/unknown").status_code == 401


def test_removal_retries_context_cleanup_after_a_committed_revocation(devices_env, monkeypatch):
    login, _, service, _ = devices_env
    current, _ = login("installation-one")
    _, other = login("installation-two")
    calls = []

    def cleanup(session_id):
        calls.append(session_id)
        if len(calls) == 1:
            raise RuntimeError("Temporary context store failure")

    monkeypatch.setattr(auth.session_auth_context_service, "delete_session_context", cleanup)
    target = f"/api/v1/auth/my-devices/s:{other['session_id']}"
    assert current.delete(target).status_code == 500
    assert not service.is_session_active(other["session_id"])
    retry = current.delete(target)
    assert retry.status_code == 200, retry.text
    assert retry.json()["closed_sessions"] == 0
    assert calls == [other["session_id"], other["session_id"]]


def test_terminate_others_keeps_current_installation_and_removes_dormant_biometrics(devices_env):
    login, credential, _, _ = devices_env
    first, a = login("installation-one")
    second, _ = login("installation-two")
    credential("installation-one", "c" * 32)
    credential("dormant-android-installation", "d" * 32)
    assert len(first.get("/api/v1/auth/my-devices").json()) == 3
    response = first.post("/api/v1/auth/my-devices/terminate-others")
    assert response.status_code == 200, response.text
    assert response.json()["revoked_biometric_credentials"] == 1
    assert response.json()["current_session_closed"] is False
    remaining = first.get("/api/v1/auth/my-devices").json()
    assert len(remaining) == 1 and remaining[0]["biometric_enabled"] is True
    assert remaining[0]["sessions"][0]["session_id"] == a["session_id"]
    assert second.get("/api/v1/auth/me").status_code == 401


def test_user_can_end_current_session_without_revoking_saved_biometric_trust(devices_env):
    login, credential, _, url = devices_env
    client, data = login("installation-one")
    credential("installation-one")
    response = client.delete(f"/api/v1/auth/my-devices/sessions/{data['session_id']}")
    assert response.status_code == 200, response.text
    assert response.json()["current_session_closed"] is True
    assert client.get("/api/v1/auth/me").status_code == 401
    with app_session(url) as db:
        assert db.get(AppMobileBiometricCredential, "a" * 32).is_active is True


def test_remove_dormant_android_device_without_an_active_session(devices_env):
    login, credential, _, _ = devices_env
    client, _ = login("installation-one")
    renewal = credential("dormant-android-installation")
    response = client.delete(f"/api/v1/auth/my-devices/b:{'a' * 32}")
    assert response.status_code == 200, response.text
    assert response.json()["closed_sessions"] == 0
    assert response.json()["revoked_biometric_credentials"] == 1
    assert len(client.get("/api/v1/auth/my-devices").json()) == 1
    anonymous = TestClient(app, base_url="https://testserver")
    response = anonymous.post("/api/v1/auth/mobile-biometric/session", json={"renewal_token": renewal},
                              headers={"X-Auth-Client": "mobile", "X-Client-Device-ID": "dormant-android-installation"})
    assert response.status_code == 401


def test_revocation_between_biometric_authentication_and_session_creation_is_rejected(devices_env):
    # Critical race: HTTP alone cannot pause between credential verification and DB creation.
    login, credential, service, _ = devices_env
    client, _ = login("installation-one")
    renewal = credential("dormant-android-installation")
    verified = auth.mobile_biometric_session_service.authenticate(
        renewal_token=renewal, client_device_id="dormant-android-installation")
    assert client.delete(f"/api/v1/auth/my-devices/b:{verified['credential_id']}").status_code == 200
    with pytest.raises(SessionCredentialRevokedError):
        service.create_session(session_id="late-renewal", user_id=7, username="ivanov", role="viewer",
                               ip_address="10.0.0.1", user_agent="Android", client_device_id="dormant-android-installation",
                               biometric_credential_id=verified["credential_id"],
                               expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
    assert service.get_session("late-renewal") is None

