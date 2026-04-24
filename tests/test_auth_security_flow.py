from __future__ import annotations

import asyncio
import sys
import importlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import auth
from backend.models.auth import User
from backend.utils.request_network import build_request_network_context, classify_network_zone, is_twofa_required_for_zone

auth_security_module = importlib.import_module("backend.services.auth_security_service")


def _clear_auth_runtime_store() -> None:
    lock = getattr(auth.auth_runtime_store_service, "_lock", None)
    memory = getattr(auth.auth_runtime_store_service, "_memory", None)
    if lock is not None and memory is not None:
        with lock:
            memory.clear()


def _make_login_request(client_ip: str) -> SimpleNamespace:
    return SimpleNamespace(
        client=SimpleNamespace(host=client_ip),
        headers={},
        url=SimpleNamespace(scheme="http"),
    )


def _invoke_login(payload, request, response: Response):
    handler = getattr(auth.login, "__wrapped__", auth.login)
    return asyncio.run(handler(payload, request, response))


def _sample_public_user(**overrides):
    payload = {
        "id": 7,
        "username": "ivanov",
        "email": "ivanov@zsgp.ru",
        "full_name": "Ivan Ivanov",
        "is_active": True,
        "role": "viewer",
        "permissions": [],
        "use_custom_permissions": False,
        "custom_permissions": [],
        "auth_source": "ldap",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": "ivanov@zsgp.ru",
        "mailbox_login": None,
        "mail_signature_html": None,
        "mail_is_configured": True,
        "is_2fa_enabled": False,
        "trusted_devices_count": 0,
        "discoverable_trusted_devices_count": 0,
        "twofa_enforced": True,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }
    payload.update(overrides)
    return payload


def test_login_lockout_bans_after_five_failed_attempts(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: None)
    clock = {"now": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(auth, "_auth_lockout_now_utc", lambda: clock["now"])
    payload = auth.LoginRequest(username=" Ivanov ", password="bad-password")
    request = _make_login_request("95.24.10.1")

    try:
        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(payload, request, Response())
            assert exc.value.status_code == 401

        with pytest.raises(HTTPException) as exc:
            _invoke_login(payload, request, Response())

        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == "600"
        assert "failed login attempts" in str(exc.value.detail).lower()
    finally:
        _clear_auth_runtime_store()


def test_login_lockout_blocks_active_ban_before_authenticate(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    calls = {"count": 0}

    def _authenticate(username, password):
        calls["count"] += 1
        return None

    monkeypatch.setattr(auth.user_service, "authenticate", _authenticate)
    clock = {"now": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(auth, "_auth_lockout_now_utc", lambda: clock["now"])
    payload = auth.LoginRequest(username="ivanov", password="bad-password")
    request = _make_login_request("95.24.10.1")

    try:
        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(payload, request, Response())
            assert exc.value.status_code == 401

        with pytest.raises(HTTPException) as exc:
            _invoke_login(payload, request, Response())
        assert exc.value.status_code == 429
        assert calls["count"] == 5

        with pytest.raises(HTTPException) as exc:
            _invoke_login(payload, request, Response())
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == "600"
        assert calls["count"] == 5
    finally:
        _clear_auth_runtime_store()


def test_login_lockout_escalates_to_hour_and_day(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: None)
    clock = {"now": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(auth, "_auth_lockout_now_utc", lambda: clock["now"])
    payload = auth.LoginRequest(username="ivanov", password="bad-password")
    request = _make_login_request("95.24.10.1")

    def _run_failed_cycle(expected_retry_after: str) -> None:
        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(payload, request, Response())
            assert exc.value.status_code == 401
        with pytest.raises(HTTPException) as exc:
            _invoke_login(payload, request, Response())
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == expected_retry_after

    try:
        _run_failed_cycle("600")
        clock["now"] = clock["now"] + timedelta(seconds=601)
        _run_failed_cycle("3600")
        clock["now"] = clock["now"] + timedelta(seconds=3601)
        _run_failed_cycle("86400")
    finally:
        _clear_auth_runtime_store()


def test_login_lockout_resets_after_day_without_failures(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: None)
    clock = {"now": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(auth, "_auth_lockout_now_utc", lambda: clock["now"])
    payload = auth.LoginRequest(username="ivanov", password="bad-password")
    request = _make_login_request("95.24.10.1")

    def _run_failed_cycle(expected_retry_after: str) -> None:
        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(payload, request, Response())
            assert exc.value.status_code == 401
        with pytest.raises(HTTPException) as exc:
            _invoke_login(payload, request, Response())
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == expected_retry_after

    try:
        _run_failed_cycle("600")
        clock["now"] = clock["now"] + timedelta(seconds=601)
        _run_failed_cycle("3600")
        clock["now"] = clock["now"] + timedelta(seconds=86401)
        _run_failed_cycle("600")
    finally:
        _clear_auth_runtime_store()


def test_login_success_clears_failure_window_without_resetting_escalation(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    user_payload = _sample_public_user(is_2fa_enabled=True, auth_source="local")
    monkeypatch.setattr(
        auth.user_service,
        "authenticate",
        lambda username, password: dict(user_payload) if password == "correct-password" else None,
    )
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(user_payload))
    monkeypatch.setattr(
        auth.auth_security_service,
        "start_login",
        lambda **kwargs: {
            "status": "2fa_required",
            "user": None,
            "session_id": None,
            "login_challenge_id": "challenge-1",
            "available_second_factors": ["totp"],
            "trusted_devices_available": False,
        },
    )
    clock = {"now": datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(auth, "_auth_lockout_now_utc", lambda: clock["now"])
    request = _make_login_request("95.24.10.1")

    try:
        bad_payload = auth.LoginRequest(username="ivanov", password="bad-password")
        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(bad_payload, request, Response())
            assert exc.value.status_code == 401

        success_payload = auth.LoginRequest(username="ivanov", password="correct-password")
        result = _invoke_login(success_payload, request, Response())
        assert result.status == "2fa_required"

        for _ in range(4):
            with pytest.raises(HTTPException) as exc:
                _invoke_login(bad_payload, request, Response())
            assert exc.value.status_code == 401

        with pytest.raises(HTTPException) as exc:
            _invoke_login(bad_payload, request, Response())
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == "600"
    finally:
        _clear_auth_runtime_store()


def test_admin_login_requires_allowed_ip(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    admin_payload = _sample_public_user(role="admin", username="admin")
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(admin_payload))
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])
    start_login_calls = {"count": 0}

    def _start_login(**kwargs):
        start_login_calls["count"] += 1
        return {}

    monkeypatch.setattr(auth.auth_security_service, "start_login", _start_login)

    try:
        with pytest.raises(HTTPException) as exc:
            _invoke_login(
                auth.LoginRequest(username="admin", password="correct-password"),
                _make_login_request("95.24.10.1"),
                Response(),
            )
        assert exc.value.status_code == 401
        assert exc.value.detail == "Incorrect username or password"
        assert start_login_calls["count"] == 0
    finally:
        _clear_auth_runtime_store()


def test_non_admin_login_is_not_blocked_by_admin_ip_allowlist(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    viewer_payload = _sample_public_user(role="viewer", username="ivanov")
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(viewer_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(viewer_payload))
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])
    monkeypatch.setattr(
        auth.auth_security_service,
        "start_login",
        lambda **kwargs: {
            "status": "authenticated",
            "user": dict(viewer_payload),
            "session_id": "session-1",
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "access_ttl_seconds": 300,
            "refresh_ttl_seconds": 3600,
        },
    )
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)

    try:
        result = _invoke_login(
            auth.LoginRequest(username="ivanov", password="correct-password"),
            _make_login_request("95.24.10.1"),
            Response(),
        )
        assert result.status == "authenticated"
        assert result.user.username == "ivanov"
    finally:
        _clear_auth_runtime_store()


def test_enforce_rate_limit_skips_internal_requests(monkeypatch):
    _clear_auth_runtime_store()
    monkeypatch.setattr(auth.auth_runtime_store_service, "_redis_client", None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")

    internal_request = _make_login_request("10.105.0.42")
    external_request = _make_login_request("95.24.10.1")

    try:
        auth._enforce_rate_limit(
            namespace="auth_internal_test",
            key="same-key",
            limit=1,
            window_seconds=60,
            request=internal_request,
        )
        auth._enforce_rate_limit(
            namespace="auth_internal_test",
            key="same-key",
            limit=1,
            window_seconds=60,
            request=internal_request,
        )

        auth._enforce_rate_limit(
            namespace="auth_external_test",
            key="same-key",
            limit=1,
            window_seconds=60,
            request=external_request,
        )
        with pytest.raises(HTTPException) as exc:
            auth._enforce_rate_limit(
                namespace="auth_external_test",
                key="same-key",
                limit=1,
                window_seconds=60,
                request=external_request,
            )
        assert exc.value.status_code == 429
    finally:
        _clear_auth_runtime_store()


def test_passkey_rate_limit_key_uses_client_ip_and_user_agent_bucket():
    request_a = _make_login_request("95.24.10.1")
    request_a.headers["user-agent"] = "Mozilla/5.0 Chrome/142.0.0.0"
    request_b = _make_login_request("95.24.10.1")
    request_b.headers["user-agent"] = "Mozilla/5.0 Firefox/140.0"

    key_a = auth._passkey_rate_limit_key(client_ip="95.24.10.1", request=request_a)
    key_b = auth._passkey_rate_limit_key(client_ip="95.24.10.1", request=request_b)

    assert key_a.startswith("95.24.10.1:chrome:")
    assert key_b.startswith("95.24.10.1:firefox:")
    assert key_a != key_b


def test_refresh_rate_limit_key_scopes_to_session_user_and_ip():
    first = SimpleNamespace(session_id="session-a", user_id=7)
    second = SimpleNamespace(session_id="session-b", user_id=8)

    assert auth._refresh_rate_limit_key(token_data=first, client_ip="95.24.10.1") == "session-a:7:95.24.10.1"
    assert auth._refresh_rate_limit_key(token_data=second, client_ip="95.24.10.1") == "session-b:8:95.24.10.1"
    assert auth._refresh_rate_limit_key(token_data=first, client_ip="95.24.10.1") != auth._refresh_rate_limit_key(
        token_data=second,
        client_ip="95.24.10.1",
    )


def test_twofa_policy_all_requires_internal_and_external_networks():
    assert is_twofa_required_for_zone("internal", policy="all") is True
    assert is_twofa_required_for_zone("external", policy="all") is True
    assert is_twofa_required_for_zone("internal", policy="external_only") is False
    assert is_twofa_required_for_zone("external", policy="external_only") is True


def test_login_returns_twofa_setup_required_for_user_without_twofa(monkeypatch):
    user_payload = _sample_public_user(is_2fa_enabled=False)
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(user_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(user_payload))
    monkeypatch.setattr(auth_security_module.security_email_service, "send_new_login_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="95.24.10.1", network_zone="external"),
    )
    original_twofa_enforced = auth.config.security.twofa_enforced
    original_twofa_policy = auth.config.security.twofa_policy
    auth.config.security.twofa_enforced = True
    auth.config.security.twofa_policy = "external_only"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post("/auth/login", json={"username": "ivanov", "password": "secret"})
    finally:
        auth.config.security.twofa_enforced = original_twofa_enforced
        auth.config.security.twofa_policy = original_twofa_policy

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "2fa_setup_required"
    assert data["user"] is None
    assert data["login_challenge_id"]


def test_login_returns_authenticated_for_internal_network_without_twofa(monkeypatch):
    user_payload = _sample_public_user(is_2fa_enabled=False, auth_source="local")
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(user_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(user_payload))
    monkeypatch.setattr(auth_security_module.security_email_service, "send_new_login_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )
    original_twofa_enforced = auth.config.security.twofa_enforced
    original_twofa_policy = auth.config.security.twofa_policy
    auth.config.security.twofa_enforced = True
    auth.config.security.twofa_policy = "external_only"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post("/auth/login", json={"username": "ivanov", "password": "secret"})
    finally:
        auth.config.security.twofa_enforced = original_twofa_enforced
        auth.config.security.twofa_policy = original_twofa_policy

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "authenticated"
    assert data["user"]["network_zone"] == "internal"
    assert data["user"]["twofa_policy"] == "external_only"
    assert data["user"]["twofa_required_for_current_request"] is False


def test_login_mode_returns_internal_password_only(monkeypatch):
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )
    original_rp_id = auth.config.security.webauthn_rp_id
    original_origin = auth.config.security.webauthn_origin
    auth.config.security.webauthn_rp_id = "hubit.zsgp.ru"
    auth.config.security.webauthn_origin = "https://hubit.zsgp.ru"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).get("/auth/login-mode")
    finally:
        auth.config.security.webauthn_rp_id = original_rp_id
        auth.config.security.webauthn_origin = original_origin

    assert response.status_code == 200
    assert response.json() == {
        "network_zone": "internal",
        "biometric_login_enabled": False,
    }


def test_login_mode_returns_external_passkey_when_webauthn_is_configured(monkeypatch):
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="95.24.10.1", network_zone="external"),
    )
    original_rp_id = auth.config.security.webauthn_rp_id
    original_origin = auth.config.security.webauthn_origin
    auth.config.security.webauthn_rp_id = "hubit.zsgp.ru"
    auth.config.security.webauthn_origin = "https://hubit.zsgp.ru"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).get("/auth/login-mode")
    finally:
        auth.config.security.webauthn_rp_id = original_rp_id
        auth.config.security.webauthn_origin = original_origin

    assert response.status_code == 200
    assert response.json() == {
        "network_zone": "external",
        "biometric_login_enabled": True,
    }


def test_verify_twofa_login_sets_auth_and_refresh_cookies(monkeypatch):
    monkeypatch.setattr(
        auth.auth_security_service,
        "verify_login_second_factor",
        lambda challenge_id, **kwargs: {
            "user": _sample_public_user(is_2fa_enabled=True, trusted_devices_count=1),
            "session_id": "session-1",
            "access_token": "access-token-1",
            "refresh_token": "refresh-token-1",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 86400,
        },
    )
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/verify-2fa-login",
        json={
            "login_challenge_id": "challenge-1",
            "totp_code": "123456",
        },
    )

    assert response.status_code == 200
    set_cookie = "\n".join(response.headers.get_list("set-cookie"))
    assert config_cookie_name() in set_cookie
    assert refresh_cookie_name() in set_cookie
    assert response.json()["status"] == "authenticated"


def test_verify_twofa_login_consumes_challenge_on_invalid_totp(monkeypatch):
    challenge = {
        "challenge_id": "challenge-1",
        "user_id": 7,
        "username": "ivanov",
        "request_username": "ivanov",
        "role": "viewer",
        "auth_source": "local",
        "ip_address": "95.24.10.1",
        "user_agent": "pytest",
        "network_zone": "external",
        "twofa_policy": "external_only",
        "twofa_required_for_current_request": True,
    }
    stored = {"challenge-1": dict(challenge)}
    monkeypatch.setattr(
        auth_security_module.auth_runtime_store_service,
        "consume_login_challenge",
        lambda challenge_id: stored.pop(challenge_id, None),
    )
    monkeypatch.setattr(
        auth_security_module.user_service,
        "get_by_id",
        lambda user_id: _sample_public_user(is_2fa_enabled=True, totp_secret_enc="encrypted-secret"),
    )
    monkeypatch.setattr(auth_security_module.twofa_service, "decrypt_secret", lambda secret: "totp-secret")
    monkeypatch.setattr(auth_security_module.twofa_service, "verify_totp", lambda **kwargs: False)

    with pytest.raises(auth_security_module.AuthSecurityError):
        auth.auth_security_service.verify_login_second_factor("challenge-1", totp_code="000000")

    assert stored == {}


def test_enable_twofa_returns_manual_entry_key(monkeypatch):
    monkeypatch.setattr(
        auth.auth_security_service,
        "start_totp_enrollment",
        lambda challenge_id: {
            "login_challenge_id": challenge_id,
            "otpauth_uri": "otpauth://totp/HUB-IT:test?secret=ABC123",
            "issuer": "HUB-IT",
            "account_name": "test@zsgp.ru",
            "manual_entry_key": "ABC123",
            "qr_svg": None,
        },
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post("/auth/enable-2fa", json={"login_challenge_id": "challenge-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["manual_entry_key"] == "ABC123"
    assert payload["otpauth_uri"].startswith("otpauth://")


def test_refresh_rejects_replayed_refresh_token(monkeypatch):
    monkeypatch.setattr(
        auth,
        "decode_access_token",
        lambda token, **kwargs: SimpleNamespace(
            jti="refresh-jti",
            session_id="session-1",
            user_id=7,
            device_id="session:session-1",
        ),
    )
    monkeypatch.setattr(auth.auth_runtime_store_service, "is_jti_revoked", lambda jti: False)
    monkeypatch.setattr(auth.auth_runtime_store_service, "consume_refresh_token", lambda jti: None)

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/refresh",
        cookies={refresh_cookie_name(): "refresh-token-1"},
    )

    assert response.status_code == 401
    assert "already used" in response.json()["detail"]


def test_auth_me_returns_security_fields(monkeypatch):
    current_user = User(**_sample_public_user(is_2fa_enabled=True, trusted_devices_count=2))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: _sample_public_user(is_2fa_enabled=True, trusted_devices_count=2))
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )
    original_twofa_enforced = auth.config.security.twofa_enforced
    original_twofa_policy = auth.config.security.twofa_policy
    auth.config.security.twofa_enforced = True
    auth.config.security.twofa_policy = "external_only"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")
        app.dependency_overrides[deps.get_current_active_user] = lambda: current_user

        response = TestClient(app).get("/auth/me")
    finally:
        auth.config.security.twofa_enforced = original_twofa_enforced
        auth.config.security.twofa_policy = original_twofa_policy

    assert response.status_code == 200
    payload = response.json()
    assert payload["is_2fa_enabled"] is True
    assert payload["trusted_devices_count"] == 2
    assert payload["twofa_enforced"] is False
    assert payload["network_zone"] == "internal"
    assert payload["twofa_policy"] == "external_only"
    assert payload["twofa_required_for_current_request"] is False


def test_network_zone_classification_treats_only_ten_net_as_internal():
    assert classify_network_zone("10.12.13.14") == "internal"
    assert classify_network_zone("10.105.0.42:50263") == "internal"
    assert classify_network_zone("172.16.1.5") == "external"
    assert classify_network_zone("192.168.1.5") == "external"
    assert classify_network_zone("95.24.10.1:54321") == "external"
    assert classify_network_zone("[::1]:54321") == "external"
    assert classify_network_zone("") == "external"


def test_twofa_policy_all_requires_internal_network_too():
    from backend.utils.request_network import is_twofa_required_for_zone

    assert is_twofa_required_for_zone("internal", policy="all") is True
    assert is_twofa_required_for_zone("external", policy="all") is True


def test_build_request_network_context_normalizes_direct_ip_with_port():
    request = SimpleNamespace(
        client=SimpleNamespace(host="10.105.0.42:50263"),
        headers={},
    )

    context = build_request_network_context(request)

    assert context.client_ip == "10.105.0.42"
    assert context.network_zone == "internal"
    assert context.trusted_proxy is False
    assert context.via_forwarded_header is False


def test_build_request_network_context_prefers_forwarded_ip_from_trusted_proxy():
    request = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1:54321"),
        headers={"x-forwarded-for": "10.105.0.42, 10.105.0.42:50263"},
    )

    context = build_request_network_context(request)

    assert context.client_ip == "10.105.0.42"
    assert context.network_zone == "internal"
    assert context.trusted_proxy is True
    assert context.via_forwarded_header is True


def test_build_request_network_context_handles_invalid_forwarded_header_safely():
    request = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1:54321"),
        headers={"x-forwarded-for": "bad-value"},
    )

    context = build_request_network_context(request)

    assert context.client_ip == "127.0.0.1"
    assert context.network_zone == "external"
    assert context.trusted_proxy is True
    assert context.via_forwarded_header is False


def test_admin_session_request_is_forbidden_from_disallowed_ip(monkeypatch):
    current_user = User(**_sample_public_user(role="admin", username="admin"))
    monkeypatch.setattr(deps, "_load_user_from_token", lambda token: current_user)
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])

    request = SimpleNamespace(
        client=SimpleNamespace(host="95.24.10.1"),
        headers={},
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.get_current_user(request=request, credentials=None, access_token_cookie="access-token"))

    assert exc.value.status_code == 403
    assert "not allowed" in str(exc.value.detail).lower()


def test_admin_session_request_uses_forwarded_ip_from_trusted_proxy(monkeypatch):
    current_user = User(**_sample_public_user(role="admin", username="admin"))
    monkeypatch.setattr(deps, "_load_user_from_token", lambda token: current_user)
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])

    request = SimpleNamespace(
        client=SimpleNamespace(host="127.0.0.1:54321"),
        headers={"x-forwarded-for": "10.105.0.42, 127.0.0.1"},
    )

    resolved_user = asyncio.run(deps.get_current_user(request=request, credentials=None, access_token_cookie="access-token"))

    assert resolved_user.username == "admin"


def test_admin_websocket_auth_is_forbidden_from_disallowed_ip(monkeypatch):
    current_user = User(**_sample_public_user(role="admin", username="admin"))
    monkeypatch.setattr(deps, "_load_user_from_token", lambda token: current_user)
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])

    websocket = SimpleNamespace(
        client=SimpleNamespace(host="95.24.10.1"),
        headers={},
        cookies={auth.config.app.auth_cookie_name: "access-token"},
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(deps.get_current_user_from_websocket(websocket))

    assert exc.value.status_code == 403


def test_trusted_device_auth_options_returns_challenge(monkeypatch):
    monkeypatch.setattr(
        auth.auth_security_service,
        "get_login_challenge",
        lambda challenge_id: {"user_id": 7, "challenge_id": challenge_id},
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "list_devices",
        lambda user_id, active_only=True: [
            {"credential_id": "cred-1", "transports": ["internal"], "id": "device-1"}
        ],
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "build_authentication_options",
        lambda **kwargs: {"challenge": "abc123", "rpId": "hubit.zsgp.ru", "allowCredentials": []},
    )
    monkeypatch.setattr(auth.auth_runtime_store_service, "save_webauthn_challenge", lambda *args, **kwargs: None)
    original_rp_id = auth.config.security.webauthn_rp_id
    auth.config.security.webauthn_rp_id = "hubit.zsgp.ru"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post(
            "/auth/trusted-devices/auth/options",
            json={"login_challenge_id": "challenge-1"},
        )
    finally:
        auth.config.security.webauthn_rp_id = original_rp_id

    assert response.status_code == 200
    payload = response.json()
    assert payload["challenge_id"]
    assert payload["public_key"]["challenge"] == "abc123"


def test_passkey_login_options_returns_discoverable_challenge(monkeypatch):
    monkeypatch.setattr(
        auth.trusted_device_service,
        "build_discoverable_authentication_options",
        lambda **kwargs: {
            "challenge": "discoverable-abc",
            "rpId": "hubit.zsgp.ru",
            "timeout": 12000,
            "userVerification": "required",
        },
    )
    monkeypatch.setattr(auth.auth_runtime_store_service, "save_webauthn_challenge", lambda *args, **kwargs: None)
    original_rp_id = auth.config.security.webauthn_rp_id
    auth.config.security.webauthn_rp_id = "hubit.zsgp.ru"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post("/auth/passkey-login/options")
    finally:
        auth.config.security.webauthn_rp_id = original_rp_id

    assert response.status_code == 200
    payload = response.json()
    assert payload["challenge_id"]
    assert payload["public_key"]["challenge"] == "discoverable-abc"
    assert payload["public_key"]["userVerification"] == "required"
    assert "allowCredentials" not in payload["public_key"]


def test_passkey_login_options_rejects_internal_network(monkeypatch):
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post("/auth/passkey-login/options")

    assert response.status_code == 403
    assert response.json()["detail"] == "Biometric login is disabled for internal network"


def test_passkey_login_verify_authenticates_discoverable_device(monkeypatch):
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: {
            "purpose": "passkey_login",
            "challenge": "discoverable-abc",
            "expected_origin": "https://hubit.zsgp.ru",
            "expected_rp_id": "hubit.zsgp.ru",
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "find_device_by_credential",
        lambda credential_id, user_id=None, discoverable_only=False: {
            "id": "device-1",
            "user_id": 7,
            "credential_id": credential_id,
            "is_discoverable": True,
        } if discoverable_only else None,
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "verify_authentication_response",
        lambda **kwargs: {"new_sign_count": 12},
    )
    updated = []
    monkeypatch.setattr(
        auth.trusted_device_service,
        "update_sign_count",
        lambda device_id, sign_count: updated.append((device_id, sign_count)),
    )
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: _sample_public_user(is_2fa_enabled=True, trusted_devices_count=1))
    monkeypatch.setattr(
        auth.auth_security_service,
        "complete_passkey_login",
        lambda **kwargs: {
            "status": "authenticated",
            "user": _sample_public_user(is_2fa_enabled=True, trusted_devices_count=1),
            "session_id": "session-passkey-1",
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "access_ttl_seconds": 300,
            "refresh_ttl_seconds": 3600,
        },
    )
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/passkey-login/verify",
        json={"challenge_id": "passkey-challenge-1", "credential": {"id": "cred-1"}},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "authenticated"
    assert payload["session_id"] == "session-passkey-1"
    assert payload["user"]["username"] == "ivanov"
    assert updated == [("device-1", 12)]


def test_passkey_login_verify_rejects_internal_network(monkeypatch):
    pop_calls = {"count": 0}

    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: pop_calls.__setitem__("count", pop_calls["count"] + 1),
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/passkey-login/verify",
        json={"challenge_id": "passkey-challenge-1", "credential": {"id": "cred-1"}},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Biometric login is disabled for internal network"
    assert pop_calls["count"] == 0


def test_passkey_login_verify_rejects_legacy_trusted_device(monkeypatch):
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: {
            "purpose": "passkey_login",
            "challenge": "discoverable-abc",
            "expected_origin": "https://hubit.zsgp.ru",
            "expected_rp_id": "hubit.zsgp.ru",
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "find_device_by_credential",
        lambda credential_id, user_id=None, discoverable_only=False: None if discoverable_only else {
            "id": "legacy-device-1",
            "user_id": 7,
            "credential_id": credential_id,
            "is_discoverable": False,
        },
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/passkey-login/verify",
        json={"challenge_id": "passkey-challenge-1", "credential": {"id": "legacy-cred"}},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Trusted device not found"


def test_passkey_login_verify_blocks_admin_from_disallowed_ip(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: {
            "purpose": "passkey_login",
            "challenge": "discoverable-abc",
            "expected_origin": "https://hubit.zsgp.ru",
            "expected_rp_id": "hubit.zsgp.ru",
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "find_device_by_credential",
        lambda credential_id, user_id=None, discoverable_only=False: {
            "id": "device-admin-1",
            "user_id": 9,
            "credential_id": credential_id,
            "is_discoverable": True,
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "verify_authentication_response",
        lambda **kwargs: {"new_sign_count": 3},
    )
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: _sample_public_user(role="admin", username="admin", is_2fa_enabled=True, trusted_devices_count=1))
    monkeypatch.setattr(deps.app_settings_service, "get_admin_login_allowed_ips", lambda: ["10.105.0.42"])
    complete_calls = {"count": 0}
    monkeypatch.setattr(
        auth.auth_security_service,
        "complete_passkey_login",
        lambda **kwargs: complete_calls.__setitem__("count", complete_calls["count"] + 1),
    )

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/passkey-login/verify",
        json={"challenge_id": "passkey-challenge-1", "credential": {"id": "cred-admin"}},
        headers={"x-forwarded-for": "95.24.10.1"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication failed"
    assert complete_calls["count"] == 0


def test_build_public_user_exposes_discoverable_trusted_device_count(monkeypatch):
    monkeypatch.setattr(auth.trusted_device_service, "count_active_devices", lambda user_id: 3)
    monkeypatch.setattr(auth.trusted_device_service, "count_discoverable_active_devices", lambda user_id: 1)

    payload = auth.auth_security_service._build_public_user(
        _sample_public_user(
            trusted_devices_count=None,
            discoverable_trusted_devices_count=None,
            is_2fa_enabled=True,
        ),
        network_zone="external",
        twofa_policy="external_only",
    )

    assert payload["trusted_devices_count"] == 3
    assert payload["discoverable_trusted_devices_count"] == 1


def test_legacy_trusted_device_verify_flow_still_authenticates(monkeypatch):
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: {
            "purpose": "authenticate",
            "login_challenge_id": "challenge-legacy-1",
            "user_id": 7,
            "challenge": "trusted-abc",
            "expected_origin": "https://hubit.zsgp.ru",
            "expected_rp_id": "hubit.zsgp.ru",
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "find_device_by_credential",
        lambda credential_id, user_id=None, discoverable_only=False: {
            "id": "legacy-device-1",
            "user_id": 7,
            "credential_id": credential_id,
            "is_discoverable": False,
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "verify_authentication_response",
        lambda **kwargs: {"new_sign_count": 8},
    )
    monkeypatch.setattr(auth.trusted_device_service, "update_sign_count", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        auth.auth_security_service,
        "finalize_trusted_device_login",
        lambda challenge_id, device: {
            "status": "authenticated",
            "user": _sample_public_user(is_2fa_enabled=True, trusted_devices_count=1),
            "session_id": "legacy-session-1",
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "access_ttl_seconds": 300,
            "refresh_ttl_seconds": 3600,
        },
    )
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    response = TestClient(app).post(
        "/auth/trusted-devices/auth/verify",
        json={
            "login_challenge_id": "challenge-legacy-1",
            "challenge_id": "trusted-challenge-1",
            "credential": {"id": "legacy-cred"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "authenticated"
    assert payload["session_id"] == "legacy-session-1"


def test_login_returns_authenticated_for_internal_network_source_with_port(monkeypatch):
    user_payload = _sample_public_user(is_2fa_enabled=True, auth_source="local")
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(user_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(user_payload))
    monkeypatch.setattr(auth_security_module.security_email_service, "send_new_login_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: build_request_network_context(
            SimpleNamespace(
                client=SimpleNamespace(host="10.12.13.14:50263"),
                headers={},
            )
        ),
    )
    original_twofa_enforced = auth.config.security.twofa_enforced
    original_twofa_policy = auth.config.security.twofa_policy
    auth.config.security.twofa_enforced = True
    auth.config.security.twofa_policy = "external_only"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post("/auth/login", json={"username": "ivanov", "password": "secret"})
    finally:
        auth.config.security.twofa_enforced = original_twofa_enforced
        auth.config.security.twofa_policy = original_twofa_policy

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "authenticated"
    assert data["user"]["network_zone"] == "internal"


def test_login_returns_twofa_for_external_network_source_with_port(monkeypatch):
    user_payload = _sample_public_user(is_2fa_enabled=True, auth_source="local")
    monkeypatch.setattr(auth.user_service, "authenticate", lambda username, password: dict(user_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda user_id: dict(user_payload))
    monkeypatch.setattr(auth_security_module.security_email_service, "send_new_login_alert", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: build_request_network_context(
            SimpleNamespace(
                client=SimpleNamespace(host="95.24.10.1:50263"),
                headers={},
            )
        ),
    )
    original_twofa_enforced = auth.config.security.twofa_enforced
    original_twofa_policy = auth.config.security.twofa_policy
    auth.config.security.twofa_enforced = True
    auth.config.security.twofa_policy = "external_only"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")

        response = TestClient(app).post("/auth/login", json={"username": "ivanov", "password": "secret"})
    finally:
        auth.config.security.twofa_enforced = original_twofa_enforced
        auth.config.security.twofa_policy = original_twofa_policy

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "2fa_required"
    assert data["user"] is None


def test_trusted_device_register_options_supports_platform_only(monkeypatch):
    current_user = User(**_sample_public_user(is_2fa_enabled=True, trusted_devices_count=0))
    monkeypatch.setattr(
        auth.trusted_device_service,
        "list_devices",
        lambda user_id, active_only=True: [],
    )
    monkeypatch.setattr(auth.auth_runtime_store_service, "save_webauthn_challenge", lambda *args, **kwargs: None)
    original_rp_id = auth.config.security.webauthn_rp_id
    original_rp_name = auth.config.security.webauthn_rp_name
    auth.config.security.webauthn_rp_id = "hubit.zsgp.ru"
    auth.config.security.webauthn_rp_name = "HUB-IT"
    try:
        app = FastAPI()
        app.include_router(auth.router, prefix="/auth")
        app.dependency_overrides[deps.get_current_active_user] = lambda: current_user
        app.dependency_overrides[deps.get_current_session_id] = lambda: "session-1"

        response = TestClient(app).post(
            "/auth/trusted-devices/register/options",
            json={"label": "Рабочий ПК", "platform_only": True},
        )
    finally:
        auth.config.security.webauthn_rp_id = original_rp_id
        auth.config.security.webauthn_rp_name = original_rp_name

    assert response.status_code == 200
    payload = response.json()
    selection = payload["public_key"]["authenticatorSelection"]
    assert selection["authenticatorAttachment"] == "platform"
    assert selection["userVerification"] == "required"
    assert selection["residentKey"] == "required"


def test_trusted_device_register_verify_marks_new_device_discoverable(monkeypatch):
    current_user = User(**_sample_public_user(is_2fa_enabled=True, trusted_devices_count=0))
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "pop_webauthn_challenge",
        lambda challenge_id: {
            "purpose": "register",
            "user_id": int(current_user.id),
            "expected_origin": "https://hubit.zsgp.ru",
            "expected_rp_id": "hubit.zsgp.ru",
            "challenge": "register-abc",
            "label": "Work Phone",
        },
    )
    monkeypatch.setattr(
        auth.trusted_device_service,
        "verify_registration_response",
        lambda **kwargs: {
            "credential_id": "cred-1",
            "public_key_b64": "pub-1",
            "sign_count": 0,
            "aaguid": None,
        },
    )
    captured = {}

    def _register_device(**kwargs):
        captured.update(kwargs)
        return {
            "id": "device-1",
            "label": kwargs.get("label") or "",
            "is_active": True,
            "is_discoverable": bool(kwargs.get("is_discoverable")),
            "transports": kwargs.get("transports") or [],
            "created_at": None,
            "last_used_at": None,
            "revoked_at": None,
        }

    monkeypatch.setattr(auth.trusted_device_service, "register_device", _register_device)

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current_user

    response = TestClient(app).post(
        "/auth/trusted-devices/register/verify",
        json={
            "challenge_id": "register-challenge-1",
            "credential": {"response": {"transports": ["internal"]}},
            "label": "Work Phone",
        },
    )

    assert response.status_code == 200
    assert captured["is_discoverable"] is True


def test_reset_own_twofa_clears_auth_cookies(monkeypatch):
    current_user = User(**_sample_public_user(is_2fa_enabled=True, trusted_devices_count=1))
    monkeypatch.setattr(
        auth.auth_security_service,
        "reset_user_twofa",
        lambda *, user_id: {"success": True, "user_id": user_id, "revoked_devices": 1, "closed_sessions": 1},
    )
    monkeypatch.setattr(
        auth,
        "decode_access_token",
        lambda token, **kwargs: SimpleNamespace(
            jti="token-jti",
            session_id="session-1",
            user_id=7,
            device_id="trusted:device-1",
            expires_at=None,
        ) if token else None,
    )
    revoked = []
    consumed = []
    monkeypatch.setattr(auth.auth_runtime_store_service, "revoke_jti", lambda jti, ttl_seconds=None: revoked.append((jti, ttl_seconds)))
    monkeypatch.setattr(auth.auth_runtime_store_service, "consume_refresh_token", lambda jti: consumed.append(jti))

    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current_user

    response = TestClient(app).post(
        "/auth/reset-2fa-self",
        cookies={
            config_cookie_name(): "access-token-1",
            refresh_cookie_name(): "refresh-token-1",
        },
    )

    assert response.status_code == 200
    assert response.json()["success"] is True
    set_cookie = "\n".join(response.headers.get_list("set-cookie"))
    assert f"{config_cookie_name()}=" in set_cookie
    assert f"{refresh_cookie_name()}=" in set_cookie
    assert any(item[0] == "token-jti" for item in revoked)
    assert consumed == ["token-jti"]


def config_cookie_name():
    return auth.config.app.auth_cookie_name


def refresh_cookie_name():
    return auth.config.app.auth_refresh_cookie_name
