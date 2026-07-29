"""Resolve approximate client country for login UX hints (e.g. VPN abroad)."""
from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from typing import Any

from fastapi import Request

logger = logging.getLogger(__name__)

_COUNTRY_HEADER_NAMES = (
    "cf-ipcountry",
    "x-country-code",
    "x-app-client-country",
    "cloudfront-viewer-country",
)
_CACHE_LOCK = threading.Lock()
_COUNTRY_CACHE: dict[str, tuple[float, str]] = {}
_CACHE_TTL_SECONDS = 6 * 60 * 60
_LOOKUP_TIMEOUT_SECONDS = 1.2


@dataclass(frozen=True)
class ClientGeoContext:
    country_code: str | None
    show_vpn_hint: bool
    source: str = "unknown"


def _env_flag(name: str, default: bool = True) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def normalize_country_code(value: Any) -> str | None:
    code = str(value or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        return None
    if code in {"XX", "T1", "A1", "A2"}:
        # Cloudflare / proxy placeholders (unknown / tor / satellite).
        return None
    return code


def is_non_public_ip(ip_value: object) -> bool:
    raw = str(ip_value or "").strip()
    if not raw:
        return True
    try:
        parsed = ipaddress.ip_address(raw)
    except ValueError:
        return True
    return bool(
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_link_local
        or parsed.is_reserved
        or parsed.is_multicast
        or parsed.is_unspecified
    )


def country_from_request_headers(request: Request | None) -> str | None:
    if request is None:
        return None
    for header_name in _COUNTRY_HEADER_NAMES:
        code = normalize_country_code(request.headers.get(header_name))
        if code:
            return code
    return None


def _cache_get(ip_value: str) -> str | None:
    now = time.time()
    with _CACHE_LOCK:
        cached = _COUNTRY_CACHE.get(ip_value)
        if not cached:
            return None
        expires_at, code = cached
        if expires_at <= now:
            _COUNTRY_CACHE.pop(ip_value, None)
            return None
        return code


def _cache_set(ip_value: str, code: str) -> None:
    with _CACHE_LOCK:
        _COUNTRY_CACHE[ip_value] = (time.time() + _CACHE_TTL_SECONDS, code)


def lookup_country_code(ip_value: object, *, timeout_seconds: float = _LOOKUP_TIMEOUT_SECONDS) -> str | None:
    """Best-effort public GeoIP lookup. Failures are silent."""
    if not _env_flag("AUTH_GEOIP_LOOKUP_ENABLED", True):
        return None
    ip_text = str(ip_value or "").strip()
    if not ip_text or is_non_public_ip(ip_text):
        return None
    cached = _cache_get(ip_text)
    if cached:
        return cached
    url = f"http://ip-api.com/json/{ip_text}?fields=status,countryCode"
    try:
        with urllib.request.urlopen(url, timeout=max(0.2, float(timeout_seconds))) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        logger.debug("GeoIP lookup failed for ip=%s error=%s", ip_text, exc)
        return None
    if str((payload or {}).get("status") or "").strip().lower() != "success":
        return None
    code = normalize_country_code((payload or {}).get("countryCode"))
    if code:
        _cache_set(ip_text, code)
    return code


def should_show_vpn_hint(*, network_zone: str, country_code: str | None) -> bool:
    zone = str(network_zone or "").strip().lower()
    if zone == "internal":
        return False
    code = normalize_country_code(country_code)
    if not code:
        return False
    return code != "RU"


def resolve_client_geo(
    *,
    request: Request | None,
    client_ip: str,
    network_zone: str,
    lookup_country: Any = lookup_country_code,
) -> ClientGeoContext:
    zone = str(network_zone or "").strip().lower() or "external"
    if zone == "internal" or is_non_public_ip(client_ip):
        return ClientGeoContext(country_code="RU" if zone == "internal" else None, show_vpn_hint=False, source="internal")

    header_code = country_from_request_headers(request)
    if header_code:
        return ClientGeoContext(
            country_code=header_code,
            show_vpn_hint=should_show_vpn_hint(network_zone=zone, country_code=header_code),
            source="header",
        )

    looked_up = normalize_country_code(lookup_country(client_ip) if callable(lookup_country) else None)
    if looked_up:
        return ClientGeoContext(
            country_code=looked_up,
            show_vpn_hint=should_show_vpn_hint(network_zone=zone, country_code=looked_up),
            source="lookup",
        )
    return ClientGeoContext(country_code=None, show_vpn_hint=False, source="unknown")
