"""Link preview URL validation must fail fast — never wait on OS DNS timeouts."""
from __future__ import annotations

import socket
import threading
import time

import pytest
from fastapi import HTTPException

from backend.chat import link_preview_service as svc
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
    release = threading.Event()

    def _hanging_getaddrinfo(*_args, **_kwargs):
        release.wait(10)
        raise AssertionError("must be abandoned by the timeout")

    monkeypatch.setattr("backend.chat.link_preview_service.socket.getaddrinfo", _hanging_getaddrinfo)
    started = time.monotonic()
    try:
        with pytest.raises(HTTPException) as excinfo:
            assert_public_http_url("https://unresolvable.invalid.example/")
        assert excinfo.value.status_code == 422
        assert time.monotonic() - started < 5.0
    finally:
        release.set()


def test_private_ip_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [(0, 0, 0, "", ("10.0.0.1", 443))],
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://internal.example/")
    assert excinfo.value.status_code == 400


@pytest.mark.parametrize("ip_str", ["127.0.0.1", "10.0.0.1", "169.254.1.1", "::1", "::ffff:127.0.0.1"])
def test_non_global_addresses_rejected(monkeypatch: pytest.MonkeyPatch, ip_str: str) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [(0, 0, 0, "", (ip_str, 443))],
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://internal.example/")
    assert excinfo.value.status_code == 400


def test_decimal_ip_literal_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [(0, 0, 0, "", ("127.0.0.1", 80))],
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("http://167772161/")
    assert excinfo.value.status_code == 400


def test_mixed_resolution_with_private_address_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [
            (0, 0, 0, "", ("93.184.216.34", 443)),
            (0, 0, 0, "", ("10.0.0.5", 443)),
        ],
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url("https://mixed.example/")
    assert excinfo.value.status_code == 400


@pytest.mark.parametrize(
    "url",
    [
        "http://user:pass@93.184.216.34/",
        "https://93.184.216.34:8080/",
        "http://93.184.216.34:8080/",
        "http://host:notaport/",
    ],
)
def test_credentials_and_non_default_ports_rejected_without_dns(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: pytest.fail("DNS resolution must not run for rejected URLs"),
    )
    with pytest.raises(HTTPException) as excinfo:
        assert_public_http_url(url)
    assert excinfo.value.status_code == 400


def test_resolution_returns_first_validated_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "backend.chat.link_preview_service.socket.getaddrinfo",
        lambda *_a, **_k: [
            (0, 0, 0, "", ("93.184.216.34", 80)),
            (0, 0, 0, "", ("93.184.216.35", 80)),
        ],
    )
    assert assert_public_http_url("http://public.example/") == "93.184.216.34"


class _FakeResponse:
    def __init__(self, body: bytes, content_type: str = "text/html") -> None:
        self.status = 200
        self.headers = {"Content-Type": content_type}
        self._body = body

    def read(self, _n):
        return self._body


def _stub_connection_class(connections: list):
    class FakeConnection:
        def __init__(self, host, port, timeout=None):
            self.host = host
            self.port = port
            self.timeout = timeout
            self.sock = None
            self.requests = []
            self.closed = False
            connections.append(self)

        def request(self, method, url, headers=None):
            self.requests.append((method, url, headers or {}))

        def getresponse(self):
            return _FakeResponse(b"<html><title>Pinned preview</title></html>")

        def close(self):
            self.closed = True

    return FakeConnection


def test_fetch_pins_connection_to_validated_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    resolver_calls: list[tuple] = []
    connect_calls: list[tuple] = []

    def getaddrinfo(host, port, **_kwargs):
        resolver_calls.append((host, port))
        address = "93.184.216.34" if len(resolver_calls) == 1 else "127.0.0.1"
        return [(socket.AF_INET, 0, 0, "", (address, port))]

    def create_connection(address, timeout=None):
        connect_calls.append((address, timeout))
        return object()

    connections: list = []
    monkeypatch.setattr(svc.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(svc.socket, "create_connection", create_connection)
    monkeypatch.setattr(svc.http.client, "HTTPConnection", _stub_connection_class(connections))

    result = svc._fetch_link_preview_uncached("http://rebind.test/")

    assert len(resolver_calls) == 1
    assert connect_calls == [(("93.184.216.34", 80), svc._PREVIEW_FETCH_TIMEOUT_SEC)]
    assert result["title"] == "Pinned preview"
    assert connections[0].sock is not None
    assert connections[0].requests[0][0] == "GET"
    assert connections[0].requests[0][1] == "/"
    assert connections[0].requests[0][2]["Host"] == "rebind.test"


def test_fetch_wraps_tls_against_original_hostname(monkeypatch: pytest.MonkeyPatch) -> None:
    connect_calls: list[tuple] = []
    raw_sock = object()

    monkeypatch.setattr(
        svc.socket,
        "getaddrinfo",
        lambda *_a, **_k: [(socket.AF_INET, 0, 0, "", ("93.184.216.34", 443))],
    )

    def create_connection(address, timeout=None):
        connect_calls.append((address, timeout))
        return raw_sock

    class FakeContext:
        def __init__(self):
            self.server_hostname = None

        def wrap_socket(self, sock, server_hostname=None):
            assert sock is raw_sock
            self.server_hostname = server_hostname
            return "tls-sock"

    context = FakeContext()
    connections: list = []
    monkeypatch.setattr(svc.socket, "create_connection", create_connection)
    monkeypatch.setattr(svc.ssl, "create_default_context", lambda: context)
    monkeypatch.setattr(svc.http.client, "HTTPSConnection", _stub_connection_class(connections))

    result = svc._fetch_link_preview_uncached("https://secure.test/page?a=1")

    assert connect_calls == [(("93.184.216.34", 443), svc._PREVIEW_FETCH_TIMEOUT_SEC)]
    assert context.server_hostname == "secure.test"
    assert connections[0].sock == "tls-sock"
    assert connections[0].requests[0][1] == "/page?a=1"
    assert connections[0].requests[0][2]["Host"] == "secure.test"
    assert result["title"] == "Pinned preview"
