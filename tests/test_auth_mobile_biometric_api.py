from __future__ import annotations

import asyncio
from pathlib import Path
import sys

from fastapi import Response
from starlette.requests import Request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import auth
from backend.models.auth import MobileBiometricEnrollRequest, MobileBiometricSessionRequest, User


def _request(*, mobile: bool = True, device_id: str = "mobile-api-device-1234567890") -> Request:
    headers = [(b"user-agent", b"HUB-IT Mobile Android")]
    if mobile:
        headers.extend([
            (b"x-auth-client", b"mobile"),
            (b"x-client-device-id", device_id.encode("ascii")),
        ])
    return Request({
        "type": "http",
        "method": "POST",
        "scheme": "https",
        "path": "/api/v1/auth/mobile-biometric/session",
        "headers": headers,
        "client": ("95.24.10.1", 43110),
        "server": ("hubit.zsgp.ru", 443),
    })


def _user() -> User:
    return User(
        id=7,
        username="mobile-user",
        role="viewer",
        permissions=[],
        is_active=True,
        is_2fa_enabled=True,
    )


def test_enroll_requires_real_mobile_header_and_returns_opaque_token(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **_kwargs: None)
    token = f"mb1.{'1' * 32}.{'a' * 48}"
    monkeypatch.setattr(
        auth.mobile_biometric_session_service,
        "enroll",
        lambda **_kwargs: token,
    )

    result = asyncio.run(auth.enroll_mobile_biometric_session(
        MobileBiometricEnrollRequest(enrollment_code="e" * 48),
        _request(),
        _user(),
    ))

    assert result.renewal_token == token


def test_biometric_renewal_issues_normal_finite_tokens(monkeypatch):
    monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **_kwargs: None)
    monkeypatch.setattr(auth, "_apply_default_database", lambda _user: None)
    monkeypatch.setattr(
        auth.mobile_biometric_session_service,
        "authenticate",
        lambda **_kwargs: {"credential_id": "1" * 32, "user_id": 7},
    )
    monkeypatch.setattr(
        auth.user_service,
        "get_by_id",
        lambda _user_id: {
            "id": 7,
            "username": "mobile-user",
            "role": "viewer",
            "is_active": True,
            "is_2fa_enabled": True,
            "permissions": [],
        },
    )
    monkeypatch.setattr(
        auth.auth_security_service,
        "complete_mobile_biometric_login",
        lambda **_kwargs: {
            "status": "authenticated",
            "access_token": "finite-access",
            "refresh_token": "finite-refresh",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 604800,
            "session_id": "mobile-session-7",
            "client_device_id": "mobile-api-device-1234567890",
            "user": {
                "id": 7,
                "username": "mobile-user",
                "role": "viewer",
                "is_active": True,
                "is_2fa_enabled": True,
                "permissions": [],
            },
        },
    )

    result = asyncio.run(auth.renew_mobile_biometric_session(
        MobileBiometricSessionRequest(
            renewal_token=f"mb1.{'1' * 32}.{'a' * 48}",
        ),
        _request(),
        Response(),
    ))

    assert result.access_token == "finite-access"
    assert result.refresh_token == "finite-refresh"
    assert result.biometric_enrollment_code is None


def test_login_response_never_exposes_enrollment_code_to_web():
    response = auth._build_login_response(
        _request(mobile=False),
        Response(),
        {
            "status": "authenticated",
            "access_token": "access",
            "refresh_token": "refresh",
            "access_ttl_seconds": 900,
            "refresh_ttl_seconds": 604800,
            "biometric_enrollment_code": "secret-enrollment-code",
            "user": {"id": 7, "username": "mobile-user", "role": "viewer"},
        },
    )
    assert response.biometric_enrollment_code is None
