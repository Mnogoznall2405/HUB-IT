import socket

import pytest

from bot.telegram_dns import build_telegram_dns_fallback_resolver


def test_telegram_dns_fallback_uses_configured_ip_after_dns_error():
    calls = []

    def delegate(host, port, *args, **kwargs):
        calls.append(host)
        if host == "api.telegram.org":
            raise socket.gaierror(socket.EAI_NONAME, "DNS unavailable")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, port))]

    resolver = build_telegram_dns_fallback_resolver(
        delegate,
        fallback_ip="149.154.167.220",
    )

    result = resolver("api.telegram.org", 443, socket.AF_UNSPEC, socket.SOCK_STREAM)

    assert calls == ["api.telegram.org", "149.154.167.220"]
    assert result[0][4] == ("149.154.167.220", 443)


def test_telegram_dns_fallback_does_not_mask_other_host_failures():
    error = socket.gaierror(socket.EAI_NONAME, "DNS unavailable")

    def delegate(*_args, **_kwargs):
        raise error

    resolver = build_telegram_dns_fallback_resolver(
        delegate,
        fallback_ip="149.154.167.220",
    )

    with pytest.raises(socket.gaierror) as raised:
        resolver("example.com", 443)

    assert raised.value is error


def test_telegram_dns_fallback_rejects_non_ip_configuration():
    with pytest.raises(ValueError, match="valid IP address"):
        build_telegram_dns_fallback_resolver(socket.getaddrinfo, fallback_ip="bad-host")


def test_telegram_preferred_ip_skips_slow_system_dns():
    calls = []

    def delegate(host, port, *args, **kwargs):
        calls.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (host, port))]

    resolver = build_telegram_dns_fallback_resolver(
        delegate,
        fallback_ip="149.154.167.220",
        prefer_fallback=True,
    )

    result = resolver("api.telegram.org", 443, socket.AF_UNSPEC, socket.SOCK_STREAM)

    assert calls == ["149.154.167.220"]
    assert result[0][4] == ("149.154.167.220", 443)
