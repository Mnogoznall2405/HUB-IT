"""Thin HTTP smoke over the real ``backend.main`` FastAPI app.

Covers the golden path end-to-end instead of isolated units:
application route table boots, health probes answer, protected routes
reject anonymous callers, and a login -> /auth/me roundtrip works through
the real middleware, dependency and JWT stack. Only the deepest
boundaries (user store, session store, mail) are stubbed.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import auth  # noqa: E402
from backend.config import config  # noqa: E402
from backend.main import app  # noqa: E402

auth_security_module = __import__("backend.services.auth_security_service", fromlist=["x"])


@pytest.fixture
def client():
    # No lifespan: background loops are feature-flagged and out of scope here.
    # https base_url: auth cookies are Secure and would not be sent over http.
    return TestClient(app, base_url="https://testserver", raise_server_exceptions=False)


def test_health_probes_answer_on_the_real_app(client):
    for path in ("/health", "/health/ready"):
        response = client.get(path)
        assert response.status_code == 200, f"{path} -> {response.status_code}"
        assert response.json()["status"] == "ok"


def test_protected_routes_reject_anonymous_callers(client):
    """A route accidentally left unauthenticated is caught here."""
    for path in (
        "/api/v1/auth/me",
        "/api/v1/tickets/requests",
        "/api/v1/equipment/database",
    ):
        response = client.get(path)
        assert response.status_code == 401, f"{path} -> {response.status_code}"


_USER_PAYLOAD = {
    "id": 7,
    "username": "ivanov",
    "email": "ivanov@zsgp.ru",
    "full_name": "Ivan Ivanov",
    "is_active": True,
    "role": "viewer",
    "permissions": [],
    "use_custom_permissions": False,
    "custom_permissions": [],
    "auth_source": "local",
    "is_2fa_enabled": False,
}


def _stub_auth_env(monkeypatch, *, closed_sessions=None):
    """Stub only the deepest boundaries; routes, JWT and middleware stay real.

    ``closed_sessions`` is the session store seen by ``is_session_active`` —
    sessions are valid until ``close_session`` adds them to the set, which is
    what the real logout route does. Pass ``None`` to keep the real session
    service (needed by refresh/session-management tests that exercise the
    real rotation and termination paths).
    """
    if closed_sessions is not None:
        monkeypatch.setattr(
            deps.session_service, "is_session_active", lambda sid: sid not in closed_sessions
        )
        monkeypatch.setattr(deps.session_service, "touch_session", lambda sid: True)
        monkeypatch.setattr(
            deps.session_service, "close_session", lambda sid: closed_sessions.add(sid)
        )
    monkeypatch.setattr(auth.user_service, "authenticate", lambda u, p: dict(_USER_PAYLOAD))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda uid: dict(_USER_PAYLOAD))
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", network_zone="internal"),
    )
    monkeypatch.setattr(
        auth_security_module.security_email_service, "send_new_login_alert", lambda *a, **k: None
    )
    monkeypatch.setattr(
        auth.session_auth_context_service, "delete_session_context", lambda sid: None
    )
    monkeypatch.setattr(
        deps.trusted_device_service, "is_token_device_valid", lambda **kw: True
    )
    monkeypatch.setattr(
        deps, "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.12.13.14", via_forwarded_header=False),
    )
    monkeypatch.setattr(config.security, "twofa_enforced", False)


def test_login_then_auth_me_roundtrip(client, monkeypatch):
    """Real login route -> real JWT -> real auth dependency -> user payload."""
    _stub_auth_env(monkeypatch, closed_sessions=set())

    login = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
    assert login.status_code == 200, login.text
    data = login.json()
    assert data["status"] == "authenticated"
    # Web clients receive the session as an httpOnly cookie; TestClient
    # keeps it, so /auth/me exercises the real cookie auth path.
    assert client.cookies.get(config.app.auth_cookie_name)

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["username"] == "ivanov"


def test_wrong_password_returns_401_without_session(client, monkeypatch):
    """Bad credentials must not issue a token or an auth cookie."""
    _stub_auth_env(monkeypatch, closed_sessions=set())
    monkeypatch.setattr(auth.user_service, "authenticate", lambda u, p: None)

    login = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "wrong"})
    assert login.status_code == 401, login.text
    assert client.cookies.get(config.app.auth_cookie_name) is None


def test_inactive_user_cannot_log_in(client, monkeypatch):
    """A deactivated employee must not get a session even with valid creds."""
    _stub_auth_env(monkeypatch, closed_sessions=set())
    inactive = {**_USER_PAYLOAD, "is_active": False}
    monkeypatch.setattr(auth.user_service, "authenticate", lambda u, p: dict(inactive))

    login = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
    assert login.status_code == 403, login.text
    assert client.cookies.get(config.app.auth_cookie_name) is None


def test_logout_revokes_the_access_token(client, monkeypatch):
    """After logout a captured access token must stop working server-side —
    clearing the client cookie alone would not cover a stolen token."""
    closed_sessions: set[str] = set()
    _stub_auth_env(monkeypatch, closed_sessions=closed_sessions)

    login = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
    assert login.status_code == 200, login.text
    cookie_name = config.app.auth_cookie_name
    captured_token = client.cookies.get(cookie_name)
    assert captured_token

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 200, logout.text

    assert closed_sessions, "logout did not close the session"
    # Replay the token captured before logout: the session is gone, so the
    # protected route must reject it even though the JWT itself is unexpired.
    replayed = client.get("/api/v1/auth/me", cookies={cookie_name: captured_token})
    assert replayed.status_code == 401, replayed.text


def test_refresh_rotates_tokens_and_rejects_replay(client, monkeypatch):
    """The refresh cookie rotates on every use. A replayed token gets the
    rotation-grace payload once (covers the mobile reconnect race), then —
    after the grace window — is rejected like a stolen cookie should be."""
    _stub_auth_env(monkeypatch)  # real session service — refresh needs its store
    monkeypatch.setattr(config.security, "twofa_policy", "off")
    monkeypatch.setattr(config.session, "refresh_rotation_grace_seconds", 1)

    login = client.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
    assert login.status_code == 200, login.text
    refresh_cookie = config.app.auth_refresh_cookie_name
    old_refresh = client.cookies.get(refresh_cookie)
    assert old_refresh

    refreshed = client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200, refreshed.text
    new_access = client.cookies.get(config.app.auth_cookie_name)
    assert new_access
    assert client.get("/api/v1/auth/me").status_code == 200

    # Within the rotation grace window the old refresh token replays the same
    # rotated payload — deliberate tolerance for racing mobile clients.
    grace = client.post("/api/v1/auth/refresh", cookies={refresh_cookie: old_refresh})
    assert grace.status_code == 200, grace.text

    time.sleep(1.2)

    # Past grace the consumed token is dead — the stolen-cookie case.
    replayed = client.post("/api/v1/auth/refresh", cookies={refresh_cookie: old_refresh})
    assert replayed.status_code == 401, replayed.text


def test_admin_can_list_and_terminate_sessions(client, monkeypatch):
    """Session management: an admin lists active sessions and terminating one
    kills its access token immediately (what 'log out this device' does)."""
    _stub_auth_env(monkeypatch)  # real session service — terminate must kill it
    # Admin logins are gated by the real IP allowlist — use the shipped default.
    monkeypatch.setattr(
        auth,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.105.0.42", network_zone="internal"),
    )
    monkeypatch.setattr(
        deps,
        "build_request_network_context",
        lambda request: SimpleNamespace(client_ip="10.105.0.42", via_forwarded_header=False),
    )
    admin_payload = {**_USER_PAYLOAD, "role": "admin"}
    monkeypatch.setattr(auth.user_service, "authenticate", lambda u, p: dict(admin_payload))
    monkeypatch.setattr(auth.user_service, "get_by_id", lambda uid: dict(admin_payload))

    # Two separate logins => two live sessions; TestClient keeps both jars.
    client_a = client
    login_a = client_a.post("/api/v1/auth/login", json={"username": "ivanov", "password": "secret"})
    assert login_a.status_code == 200, login_a.text
    session_a = login_a.json().get("session_id")
    assert session_a

    sessions = client_a.get("/api/v1/auth/sessions")
    assert sessions.status_code == 200, sessions.text
    listed_ids = {str(item.get("session_id")) for item in sessions.json()}
    assert session_a in listed_ids, sessions.json()

    cookie_name = config.app.auth_cookie_name
    captured_token = client_a.cookies.get(cookie_name)

    terminated = client_a.delete(f"/api/v1/auth/sessions/{session_a}")
    assert terminated.status_code == 200, terminated.text

    replayed = client_a.get("/api/v1/auth/me", cookies={cookie_name: captured_token})
    assert replayed.status_code == 401, replayed.text
