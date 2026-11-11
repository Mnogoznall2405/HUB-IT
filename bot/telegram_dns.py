"""Process-local DNS fallback for the Telegram Bot API.

The request URL keeps ``api.telegram.org`` so certificate validation and TLS
SNI remain correct. Only the failed DNS lookup is replaced with a configured
IP address, and only inside the bot process.
"""

from __future__ import annotations

import ipaddress
import os
import socket
from collections.abc import Callable
from typing import Any


_TELEGRAM_API_HOST = "api.telegram.org"
_FALLBACK_MARKER = "_hubit_telegram_dns_fallback"


def _normalize_host(host: Any) -> str:
    if isinstance(host, bytes):
        return host.decode("ascii", errors="ignore").rstrip(".").lower()
    return str(host).rstrip(".").lower()


def build_telegram_dns_fallback_resolver(
    delegate: Callable[..., list],
    *,
    fallback_ip: str,
    prefer_fallback: bool = False,
) -> Callable[..., list]:
    """Wrap ``getaddrinfo`` with an exact-host fallback for Telegram."""

    try:
        resolved_fallback_ip = str(ipaddress.ip_address(fallback_ip.strip()))
    except ValueError as exc:
        raise ValueError(
            "TELEGRAM_BOT_API_FALLBACK_IP must be a valid IP address"
        ) from exc

    def resolve(host: Any, port: Any, *args: Any, **kwargs: Any) -> list:
        if prefer_fallback and _normalize_host(host) == _TELEGRAM_API_HOST:
            return delegate(resolved_fallback_ip, port, *args, **kwargs)
        try:
            return delegate(host, port, *args, **kwargs)
        except socket.gaierror:
            if _normalize_host(host) != _TELEGRAM_API_HOST:
                raise
            return delegate(resolved_fallback_ip, port, *args, **kwargs)

    setattr(resolve, _FALLBACK_MARKER, True)
    return resolve


def install_telegram_dns_fallback(fallback_ip: str | None) -> bool:
    """Install the resolver once in the current process when configured."""

    if not fallback_ip or not fallback_ip.strip():
        return False
    if getattr(socket.getaddrinfo, _FALLBACK_MARKER, False):
        return True
    socket.getaddrinfo = build_telegram_dns_fallback_resolver(
        socket.getaddrinfo,
        fallback_ip=fallback_ip,
        prefer_fallback=str(
            os.getenv("TELEGRAM_BOT_API_PREFER_FALLBACK_IP", "1") or "1"
        ).strip().lower() not in {"0", "false", "no", "off"},
    )
    return True
