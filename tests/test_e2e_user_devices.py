"""Real auth routes, JWTs and SQLite stores: owner boundaries and remote revocation."""
import hashlib
import importlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from test_e2e_smoke import app, auth, deps, config, _stub_auth_env, _USER_PAYLOAD
from backend.appdb.db import app_session
from backend.appdb.models import AppMobileBiometricCredential, AppUser, AppSessionRecord
from backend.services.session_service import SessionService, hash_client_device_id, SessionCredentialRevokedError
from backend.services.user_device_service import UserDeviceService
from backend.utils.security import decode_access_token


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


def test_forged_token_cannot_borrow_another_users_session(devices_env, monkeypatch):
    """An access JWT claiming another user's live session_id must never
    authenticate: session owner binding applies on HTTP loaders and WS lease."""
    login, _, service, _ = devices_env
    client, data = login("installation-one")
    borrowed_sid = data["session_id"]

    def _get_by_id(uid):
        uid = int(uid or 0)
        return dict(_USER_PAYLOAD, id=uid, username=f"user{uid}")

    monkeypatch.setattr(auth.user_service, "get_by_id", _get_by_id)

    forged = jwt.encode(
        {
            "sub": "user8",
            "user_id": 8,
            "token_type": "access",
            "session_id": borrowed_sid,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        config.jwt.secret_key,
        algorithm=config.jwt.algorithm,
    )

    deleted_contexts = []
    monkeypatch.setattr(
        deps.session_auth_context_service, "delete_session_context", deleted_contexts.append
    )

    forged_client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    response = forged_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401, response.text
    # A borrowed-session rejection must not invalidate the victim's session context.
    assert deleted_contexts == []

    assert deps._load_optional_user_from_token(forged) is None
    with pytest.raises(HTTPException) as caught:
        deps._load_session_id_from_token(forged)
    assert caught.value.status_code == 401
    with pytest.raises(HTTPException) as caught:
        deps.assert_access_token_still_valid(forged, touch_session=False)
    assert caught.value.status_code == 401

    from backend.chat.ws_auth import WsSessionLease
    assert WsSessionLease(forged, user_id=8).revalidate() == "dead"

    # The legitimate session owner keeps working on every path.
    assert client.get("/api/v1/auth/me").status_code == 200
    assert deps._load_session_id_from_token(data["access_token"]) == borrowed_sid

    # A session created for user 8 authenticates that same user normally.
    service.create_session(session_id="sess-u8", user_id=8, username="user8", role="viewer",
                           ip_address="10.0.0.1", user_agent="Other", client_device_id="dev-u8",
                           expires_at=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat())
    own = jwt.encode(
        {"sub": "user8", "user_id": 8, "token_type": "access", "session_id": "sess-u8",
         "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
        config.jwt.secret_key, algorithm=config.jwt.algorithm)
    own_client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    assert own_client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {own}"}
    ).status_code == 200


def _spy_device_revocation(monkeypatch):
    biometric_calls, push_calls = [], []
    monkeypatch.setattr(
        auth.mobile_biometric_session_service,
        "revoke_device",
        lambda **kwargs: biometric_calls.append(kwargs),
    )
    monkeypatch.setattr(
        auth.native_push_service,
        "revoke_device_tokens",
        lambda **kwargs: push_calls.append(kwargs),
    )
    return biometric_calls, push_calls


_MOBILE_HEADERS = {"X-Auth-Client": "mobile", "X-Client-Device-ID": "installation-one"}


def test_refresh_only_logout_closes_the_bound_session_and_device(devices_env, monkeypatch):
    """Deferred mobile cleanup sends only the refresh token: the server must
    still close the session bound to it and revoke push/biometric for its owner."""
    login, _, service, _ = devices_env
    client, data = login("installation-one")
    biometric_calls, push_calls = _spy_device_revocation(monkeypatch)

    anonymous = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    response = anonymous.post(
        "/api/v1/auth/logout",
        json={"refresh_token": data["refresh_token"]},
        headers=_MOBILE_HEADERS,
    )
    assert response.status_code == 200, response.text
    assert service.is_session_active(data["session_id"]) is False
    assert client.get("/api/v1/auth/me").status_code == 401
    assert biometric_calls == [{"user_id": 7, "client_device_id": "installation-one"}]
    assert push_calls == [{"user_id": 7, "device_id": "installation-one"}]


def test_forged_access_token_logout_cannot_close_another_users_session(devices_env, monkeypatch):
    """A signed access JWT borrowing another user's session_id must not close
    that session or revoke the victim's device bindings."""
    login, _, service, _ = devices_env
    client, data = login("installation-one")

    def _get_by_id(uid):
        uid = int(uid or 0)
        return dict(_USER_PAYLOAD, id=uid, username=f"user{uid}")

    monkeypatch.setattr(auth.user_service, "get_by_id", _get_by_id)
    forged = jwt.encode(
        {
            "sub": "user8",
            "user_id": 8,
            "token_type": "access",
            "session_id": data["session_id"],
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
        },
        config.jwt.secret_key,
        algorithm=config.jwt.algorithm,
    )
    biometric_calls, push_calls = _spy_device_revocation(monkeypatch)

    forged_client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    response = forged_client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {forged}", **_MOBILE_HEADERS},
    )
    assert response.status_code == 200, response.text
    assert service.is_session_active(data["session_id"]) is True
    assert client.get("/api/v1/auth/me").status_code == 200
    assert biometric_calls == [] and push_calls == []


def test_consumed_refresh_logout_is_idempotent_without_closing_session(devices_env, monkeypatch):
    """A refresh token whose JTI was already consumed must get an idempotent
    200: it cannot close the session or revoke device bindings."""
    login, _, service, _ = devices_env
    client, data = login("installation-one")

    refresh_data = decode_access_token(data["refresh_token"], expected_token_type="refresh")
    assert refresh_data is not None and refresh_data.jti
    assert auth.auth_runtime_store_service.consume_refresh_token(refresh_data.jti) is not None
    biometric_calls, push_calls = _spy_device_revocation(monkeypatch)

    anonymous = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    response = anonymous.post(
        "/api/v1/auth/logout",
        json={"refresh_token": data["refresh_token"]},
        headers=_MOBILE_HEADERS,
    )
    assert response.status_code == 200, response.text
    assert service.is_session_active(data["session_id"]) is True
    assert client.get("/api/v1/auth/me").status_code == 200
    assert biometric_calls == [] and push_calls == []


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

