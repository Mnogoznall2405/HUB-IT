from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import auth
from backend.models.auth import (
    MobileWebSessionConsumeRequest,
    MobileWebSessionRequest,
    User,
)


def _request(*, mobile: bool = False) -> SimpleNamespace:
    headers = {"x-auth-client": "mobile"} if mobile else {}
    return SimpleNamespace(
        client=SimpleNamespace(host="95.24.10.1"),
        headers=headers,
        url=SimpleNamespace(scheme="https"),
    )


def _user() -> User:
    return User(
        id=7,
        username="mobile.viewer",
        role="viewer",
        is_active=True,
        permissions=["dashboard.read"],
    )


def _token_data(*, token_type: str) -> SimpleNamespace:
    return SimpleNamespace(
        user_id=7,
        session_id="session-mobile-7",
        device_id="session:session-mobile-7",
        jti="refresh-jti-7" if token_type == "refresh" else "access-jti-7",
    )


def test_normalize_mobile_web_next_path_rejects_external_and_api_targets():
    assert auth._normalize_mobile_web_next_path("/mail/compose?draft=1") == "/mail/compose?draft=1"
    assert auth._normalize_mobile_web_next_path("https://evil.example/path") == "/dashboard"
    assert auth._normalize_mobile_web_next_path("//evil.example/path") == "/dashboard"
    assert auth._normalize_mobile_web_next_path("/api/v1/auth/me") == "/dashboard"
    assert auth._normalize_mobile_web_next_path("/login") == "/dashboard"


def test_create_mobile_web_session_requires_mobile_header(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.create_mobile_web_session(
                MobileWebSessionRequest(refresh_token="refresh-token"),
                _request(mobile=False),
                _user(),
                HTTPAuthorizationCredentials(scheme="Bearer", credentials="access-token"),
            )
        )

    assert exc.value.status_code == 403


def test_mobile_web_session_rejects_mismatched_refresh_proof(monkeypatch):
    def decode(token: str, expected_token_type: str | None = None):
        data = _token_data(token_type=str(expected_token_type or "access"))
        if expected_token_type == "refresh":
            data.session_id = "another-session"
        return data

    monkeypatch.setattr(auth, "decode_access_token", decode)

    with pytest.raises(HTTPException) as exc:
        auth._validate_mobile_web_refresh_proof(
            credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials="access-token"),
            refresh_token="refresh-token",
            current_user=_user(),
        )

    assert exc.value.status_code == 401
    assert "does not match" in str(exc.value.detail)


def test_create_mobile_web_session_stores_only_one_time_exchange(monkeypatch):
    saved: dict[str, object] = {}

    def decode(token: str, expected_token_type: str | None = None):
        return _token_data(token_type=str(expected_token_type or "access"))

    monkeypatch.setattr(auth, "decode_access_token", decode)
    monkeypatch.setattr(auth.auth_runtime_store_service, "is_jti_revoked", lambda jti: False)
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "get_json",
        lambda namespace, key: {
            "user_id": 7,
            "session_id": "session-mobile-7",
            "device_id": "session:session-mobile-7",
        },
    )
    monkeypatch.setattr(
        auth.auth_runtime_store_service,
        "set_json",
        lambda namespace, key, payload, ttl: saved.update(
            namespace=namespace,
            key=key,
            payload=payload,
            ttl=ttl,
        ),
    )
    monkeypatch.setattr(auth.session_service, "is_session_active", lambda session_id: True)
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)

    result = asyncio.run(
        auth.create_mobile_web_session(
            MobileWebSessionRequest(
                refresh_token="refresh-token",
                next_path="/chat?conversation=conversation-1",
            ),
            _request(mobile=True),
            _user(),
            HTTPAuthorizationCredentials(scheme="Bearer", credentials="access-token"),
        )
    )

    assert result.expires_in_seconds == auth._MOBILE_WEB_SESSION_TTL_SECONDS
    assert result.bootstrap_path.startswith("/api/v1/auth/mobile-web-session/bootstrap#code=")
    raw_code = result.bootstrap_path.split("#code=", 1)[1]
    assert raw_code not in str(saved)
    assert saved["namespace"] == auth._MOBILE_WEB_SESSION_NAMESPACE
    assert saved["key"] == auth._mobile_web_exchange_key(raw_code)
    assert saved["payload"] == {
        "user_id": 7,
        "session_id": "session-mobile-7",
        "device_id": "session:session-mobile-7",
        "next_path": "/chat?conversation=conversation-1",
    }


def test_mobile_web_bootstrap_does_not_cache_or_embed_exchange_code():
    response = asyncio.run(auth.mobile_web_session_bootstrap())
    body = bytes(response.body).decode("utf-8")

    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert "location.hash" in body
    assert "refresh_token" not in body
    assert "hubit-mobile-web-session-ready" in body
    assert "window.ReactNativeWebView" in body
    assert "AbortController" in body


def test_consume_mobile_web_session_issues_httponly_cookies(monkeypatch):
    code = "one-time-mobile-web-code-1234567890"
    popped: dict[str, str] = {}

    def pop_json(namespace: str, key: str):
        popped.update(namespace=namespace, key=key)
        return {
            "user_id": 7,
            "session_id": "session-mobile-7",
            "device_id": "session:session-mobile-7",
            "next_path": "/mail",
        }

    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
    monkeypatch.setattr(auth.auth_runtime_store_service, "pop_json", pop_json)
    monkeypatch.setattr(auth.session_service, "is_session_active", lambda session_id: True)
    monkeypatch.setattr(auth.session_service, "touch_session", lambda session_id: True)
    monkeypatch.setattr(
        auth.user_service,
        "get_by_id",
        lambda user_id: {"id": 7, "username": "mobile.viewer", "role": "viewer", "is_active": True},
    )
    monkeypatch.setattr(auth.trusted_device_service, "is_token_device_valid", lambda **kwargs: True)
    monkeypatch.setattr(
        auth.auth_security_service,
        "issue_tokens",
        lambda **kwargs: {
            "access_token": "web-access-token",
            "refresh_token": "web-refresh-token",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 604800,
        },
    )

    response = Response()
    result = asyncio.run(
        auth.consume_mobile_web_session(
            MobileWebSessionConsumeRequest(code=code),
            _request(mobile=False),
            response,
        )
    )

    cookies = "\n".join(response.headers.getlist("set-cookie"))
    assert result.next_path == "/mail"
    assert "web-access-token" in cookies
    assert "web-refresh-token" in cookies
    assert "HttpOnly" in cookies
    assert response.headers["cache-control"] == "no-store"
    assert popped == {
        "namespace": auth._MOBILE_WEB_SESSION_NAMESPACE,
        "key": auth._mobile_web_exchange_key(code),
    }
