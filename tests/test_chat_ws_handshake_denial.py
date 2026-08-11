from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.api.v1.chat._common import (
    ChatReadConcurrencyTimeout,
    _classify_ws_handshake_denial,
    _deny_ws_handshake,
    _ws_denial_extension_available,
)
from backend.chat.db import ChatConfigurationError


@pytest.mark.parametrize(
    "exc,status,reason",
    [
        (HTTPException(status_code=401, detail="Not authenticated"), 401, "auth_session"),
        (HTTPException(status_code=403, detail="Forbidden"), 403, "access_denied"),
        (HTTPException(status_code=400, detail="Inactive user"), 400, "malformed_request"),
        (HTTPException(status_code=429, detail="slow down"), 429, "rate_limited"),
        (HTTPException(status_code=503, detail="busy"), 503, "overloaded"),
        (HTTPException(status_code=404, detail="missing"), 401, "auth_session"),
        (PermissionError("no chat.read"), 403, "access_denied"),
        (ValueError("bad"), 400, "malformed_request"),
        (LookupError("gone"), 401, "auth_session"),
        (ChatConfigurationError("no db"), 503, "overloaded"),
        (ChatReadConcurrencyTimeout("full"), 503, "overloaded"),
    ],
)
def test_classify_ws_handshake_denial(exc, status, reason):
    got_status, got_reason, detail = _classify_ws_handshake_denial(exc)
    assert got_status == status
    assert got_reason == reason
    assert detail


@pytest.mark.asyncio
async def test_deny_ws_handshake_uses_http_denial_when_extension_present():
    sent = {}

    class FakeWs:
        scope = {"extensions": {"websocket.http.response": {}}}

        async def send_denial_response(self, response):
            sent["response"] = response

        async def close(self, code=1000):
            sent["close"] = code

    result = await _deny_ws_handshake(FakeWs(), HTTPException(status_code=401, detail="race"))
    assert result["status"] == 401
    assert result["reason_code"] == "auth_session"
    assert result["denial_mode"] == "http_denial"
    assert "response" in sent
    assert sent["response"].status_code == 401


@pytest.mark.asyncio
async def test_deny_ws_handshake_falls_back_when_extension_missing():
    sent = {}

    class FakeWs:
        scope = {"extensions": {}}

        async def send_denial_response(self, response):
            raise AssertionError("should not be called")

        async def close(self, code=1000):
            sent["close"] = code

    result = await _deny_ws_handshake(FakeWs(), HTTPException(status_code=403, detail="nope"))
    assert result["denial_mode"] == "close_fallback"
    assert sent["close"] == 4403


def test_ws_denial_extension_available_helper():
    assert _ws_denial_extension_available(
        SimpleNamespace(scope={"extensions": {"websocket.http.response": {}}})
    )
    assert not _ws_denial_extension_available(SimpleNamespace(scope={"extensions": {}}))
    assert not _ws_denial_extension_available(SimpleNamespace(scope=None))
