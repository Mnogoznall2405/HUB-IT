"""Link preview URL validation must fail fast — never wait on OS DNS timeouts."""
from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from backend.chat.link_preview_service import assert_public_http_url


def test_rejects_non_http_scheme_fast() -> None:
    started = time.monotonic()
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("ftp://example.com/x")
    assert excinfo.value.status_code == 400
    assert time.monotonic() - started < 0.5


def test_rejects_missing_host_fast() -> None:
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://")
    assert excinfo.value.status_code == 400


def test_unresolvable_host_fails_within_dns_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    # An OS-level getaddrinfo that hangs forever used to stall the endpoint for
    # 5-19s before returning 422 (plan P1). The bounded executor caps it.
    def _hanging_getaddrinfo(*_args, **_kwargs):
        time.sleep(30)
        raise AssertionError("must be abandoned by the timeout")

    monkeypatch.setattr("backend.chat.link_preview_service.socket.getaddrinfo", _hanging_getaddrinfo)
    started = time.monotonic()
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://unresolvable.invalid.example/")
    assert excinfo.value.status_code == 422
    assert time.monotonic() - started < 5.0


def test_private_ip_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [(0, 0, 0, "", ("10.0.0.1", 443))],
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://internal.example/")
    assert excinfo.value.status_code == 400
