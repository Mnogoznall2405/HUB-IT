"""LiveKit join token: the signature and claims must be accepted by an independent JWT implementation.

Why a unit test: a wrong signature, claim name or time claim only fails inside livekit-server (the user
sees "cannot join"), which no HTTP-level test of this repository can observe. python-jose is a different
implementation from the stdlib code under test, so a mistake in the encoding cannot cancel itself out.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from jose import JWTError, jwt

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.livekit_token import build_livekit_token  # noqa: E402

API_KEY = "APIkeyForTests"
API_SECRET = "s3cr3t-for-tests-0123456789abcdef0123"


def _token(**overrides):
    params = dict(
        api_key=API_KEY, api_secret=API_SECRET, identity="42", name="Иван Петров",
        room="3f2b8c64-0000-4000-8000-000000000001", ttl_sec=3600,
    )
    params.update(overrides)
    return build_livekit_token(**params)


def test_token_is_a_valid_hs256_jwt_with_the_livekit_room_grant():
    now = int(time.time())
    token = _token(now=now)
    assert jwt.get_unverified_header(token) == {"alg": "HS256", "typ": "JWT"}
    claims = jwt.decode(token, API_SECRET, algorithms=["HS256"], options={"verify_aud": False})
    assert claims["iss"] == API_KEY
    assert claims["sub"] == "42"
    assert claims["name"] == "Иван Петров"  # non-ASCII survives the encoding
    assert claims["nbf"] == now and claims["exp"] == now + 3600
    assert claims["video"] == {
        "roomJoin": True,
        "room": "3f2b8c64-0000-4000-8000-000000000001",
        "canPublish": True,
        "canSubscribe": True,
        "canPublishData": False,
    }


def test_token_expires_after_ttl():
    token = _token(now=time.time() - 7200, ttl_sec=3600)  # issued two hours ago, valid for one
    with pytest.raises(JWTError, match="expired"):
        jwt.decode(token, API_SECRET, algorithms=["HS256"], options={"verify_aud": False})


def test_token_signed_with_another_secret_or_tampered_is_rejected():
    token = _token()
    with pytest.raises(JWTError):
        jwt.decode(token, "another-secret-another-secret-0000", algorithms=["HS256"], options={"verify_aud": False})
    header, payload, signature = token.split(".")
    forged_payload = _token(room="someone-elses-room").split(".")[1]
    with pytest.raises(JWTError):
        jwt.decode(f"{header}.{forged_payload}.{signature}", API_SECRET, algorithms=["HS256"], options={"verify_aud": False})


@pytest.mark.parametrize(
    "override",
    [{"api_key": ""}, {"api_secret": ""}, {"identity": ""}, {"room": ""}, {"ttl_sec": 0}],
)
def test_token_refuses_incomplete_input(override):
    with pytest.raises(ValueError):
        _token(**override)
