from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Response
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import auth
from backend.models.auth import LoginRequest, MobileRefreshRequest


def _make_request(*, mobile: bool = False, headers: dict | None = None) -> SimpleNamespace:
    merged = dict(headers or {})
    if mobile:
        merged["x-auth-client"] = "mobile"
    return SimpleNamespace(
        client=SimpleNamespace(host="95.24.10.1"),
        headers=merged,
        url=SimpleNamespace(scheme="https"),
    )


def _invoke_login(payload: LoginRequest, request, response: Response):
    handler = getattr(auth.login, "__wrapped__", auth.login)
    return asyncio.run(handler(payload, request, response))


def test_mobile_login_returns_tokens_in_json_body(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
    monkeypatch.setattr(
        auth.user_service,
        "authenticate",
        lambda username, password: {"id": 1, "username": "admin", "is_active": True},
    )
    monkeypatch.setattr(
        auth.user_service,
        "get_by_id",
        lambda user_id: {"id": 1, "username": "admin", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        auth.auth_security_service,
        "start_login",
        lambda **kwargs: {"status": "authenticated", "user": {"id": 1, "username": "admin", "role": "admin"}},
    )
    monkeypatch.setattr(
        auth.auth_security_service,
        "complete_password_only_login",
        lambda **kwargs: {
            "status": "authenticated",
            "access_token": "access-test-token",
            "refresh_token": "refresh-test-token",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 604800,
            "user": {
                "id": 1,
                "username": "admin",
                "role": "admin",
                "is_active": True,
                "permissions": [],
                "use_custom_permissions": False,
                "custom_permissions": [],
                "auth_source": "local",
            },
            "session_id": "sess-mobile-1",
        },
    )
    monkeypatch.setattr(auth, "ensure_admin_ip_allowed", lambda *args, **kwargs: None)

    response = Response()
    result = _invoke_login(
        LoginRequest(username="admin", password="secret"),
        _make_request(mobile=True),
        response,
    )

    assert result.status == "authenticated"
    assert result.access_token == "access-test-token"
    assert result.refresh_token == "refresh-test-token"
    assert response.headers.get("set-cookie") is None


def test_web_login_keeps_cookie_delivery_and_hides_tokens(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
    monkeypatch.setattr(
        auth.user_service,
        "authenticate",
        lambda username, password: {"id": 1, "username": "admin", "is_active": True},
    )
    monkeypatch.setattr(
        auth.user_service,
        "get_by_id",
        lambda user_id: {"id": 1, "username": "admin", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        auth.auth_security_service,
        "start_login",
        lambda **kwargs: {"status": "authenticated", "user": {"id": 1, "username": "admin", "role": "admin"}},
    )
    monkeypatch.setattr(
        auth.auth_security_service,
        "complete_password_only_login",
        lambda **kwargs: {
            "status": "authenticated",
            "access_token": "access-web-token",
            "refresh_token": "refresh-web-token",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 604800,
            "user": {
                "id": 1,
                "username": "admin",
                "role": "admin",
                "is_active": True,
                "permissions": [],
                "use_custom_permissions": False,
                "custom_permissions": [],
                "auth_source": "local",
            },
            "session_id": "sess-web-1",
        },
    )
    monkeypatch.setattr(auth, "ensure_admin_ip_allowed", lambda *args, **kwargs: None)

    response = Response()
    result = _invoke_login(
        LoginRequest(username="admin", password="secret"),
        _make_request(mobile=False),
        response,
    )

    assert result.access_token is None
    assert result.refresh_token is None
    assert "set-cookie" in str(response.headers).lower()


def test_resolve_refresh_token_prefers_body_for_mobile():
    request = _make_request(mobile=True)
    token = auth._resolve_refresh_token(
        request=request,
        refresh_token_cookie=None,
        mobile_payload=MobileRefreshRequest(refresh_token="body-refresh"),
    )
    assert token == "body-refresh"
