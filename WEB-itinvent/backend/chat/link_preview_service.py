"""Link preview fetch with SSRF guards for chat."""
from __future__ import annotations

import concurrent.futures
import http.client
import ipaddress
import logging
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

from fastapi import HTTPException

http_logger = logging.getLogger("backend.chat.api")


def extract_og_meta(html: str) -> dict:
    """Extract Open Graph and basic meta tags from HTML."""
    result: dict[str, str] = {}
    patterns = {
        "title": [
            r'<meta\s+(?:property|name)=["\']og:title["\']\s+content=["\'](.*?)["\']',
            r'<meta\s+content=["\'](.*?)["\']\s+(?:property|name)=["\']og:title["\']',
            r"<title[^>]*>(.*?)</title>",
        ],
        "description": [
            r'<meta\s+(?:property|name)=["\']og:description["\']\s+content=["\'](.*?)["\']',
            r'<meta\s+content=["\'](.*?)["\']\s+(?:property|name)=["\']og:description["\']',
            r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']',
        ],
        "image": [
            r'<meta\s+(?:property|name)=["\']og:image["\']\s+content=["\'](.*?)["\']',
            r'<meta\s+content=["\'](.*?)["\']\s+(?:property|name)=["\']og:image["\']',
        ],
        "site_name": [
            r'<meta\s+(?:property|name)=["\']og:site_name["\']\s+content=["\'](.*?)["\']',
            r'<meta\s+content=["\'](.*?)["\']\s+(?:property|name)=["\']og:site_name["\']',
        ],
    }
    for key, pats in patterns.items():
        for pat in pats:
            match = re.search(pat, html, re.IGNORECASE | re.DOTALL)
            if match:
                value = match.group(1).strip()
                if value:
                    result[key] = value
                    break
    return result


_DNS_RESOLVE_TIMEOUT_SEC = 1.5
# Shared pool so a hung getaddrinfo does not tie the endpoint to OS DNS timeouts
# (unresolvable names took 5-19s to return 422 — see plan P1).
_DNS_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=4,
    thread_name_prefix="link-preview-dns",
)


def assert_public_http_url(raw_url: str) -> str:
    parts = urlsplit(raw_url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    if parts.username is not None or parts.password is not None:
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        port = parts.port
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid URL") from exc
    if port is not None and port != (443 if parts.scheme == "https" else 80):
        raise HTTPException(status_code=400, detail="Invalid URL")
    port = port or (443 if parts.scheme == "https" else 80)
    future = _DNS_EXECUTOR.submit(
        socket.getaddrinfo, parts.hostname, port, proto=socket.IPPROTO_TCP,
    )
    try:
        infos = future.result(timeout=_DNS_RESOLVE_TIMEOUT_SEC)
    except concurrent.futures.TimeoutError as exc:
        raise HTTPException(status_code=422, detail="Could not resolve URL") from exc
    except OSError as exc:
        raise HTTPException(status_code=422, detail="Could not resolve URL") from exc
    if not infos:
        raise HTTPException(status_code=422, detail="Could not resolve URL")
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="URL host is not allowed") from exc
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="URL host is not allowed")
    return infos[0][4][0]


# Every client asked again on each app start / thread open, and an unreachable site cost a full
# 5 s fetch each time (83 slow requests in the logs). Results — including failures — are kept.
_PREVIEW_OK_TTL_SEC = 3600.0
_PREVIEW_FAILURE_TTL_SEC = 600.0
_PREVIEW_CACHE_MAX = 512
_PREVIEW_FETCH_TIMEOUT_SEC = 3
_preview_cache: dict[str, tuple[float, dict | None, tuple[int, str] | None]] = {}
_preview_cache_lock = threading.Lock()


def _cache_lookup(url: str) -> tuple[bool, dict | None, tuple[int, str] | None]:
    with _preview_cache_lock:
        entry = _preview_cache.get(url)
        if entry is None:
            return False, None, None
        if entry[0] <= time.monotonic():
            _preview_cache.pop(url, None)
            return False, None, None
        return True, entry[1], entry[2]


def _cache_store(url: str, ttl: float, result: dict | None, failure: tuple[int, str] | None) -> None:
    with _preview_cache_lock:
        if len(_preview_cache) >= _PREVIEW_CACHE_MAX:
            now = time.monotonic()
            for key in [k for k, v in _preview_cache.items() if v[0] <= now]:
                _preview_cache.pop(key, None)
            if len(_preview_cache) >= _PREVIEW_CACHE_MAX:
                _preview_cache.clear()
        _preview_cache[url] = (time.monotonic() + ttl, result, failure)


def fetch_link_preview(url: str) -> dict:
    normalized = str(url or "").strip()
    if not normalized.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")
    hit, cached_result, cached_failure = _cache_lookup(normalized)
    if hit:
        if cached_failure is not None:
            raise HTTPException(status_code=cached_failure[0], detail=cached_failure[1])
        return dict(cached_result or {})
    try:
        result = _fetch_link_preview_uncached(normalized)
    except HTTPException as exc:
        if exc.status_code in (400, 422):
            _cache_store(normalized, _PREVIEW_FAILURE_TTL_SEC, None, (exc.status_code, str(exc.detail)))
        raise
    _cache_store(normalized, _PREVIEW_OK_TTL_SEC, result, None)
    return dict(result)


def _open_pinned_url(parts, ip: str):
    port = 443 if parts.scheme == "https" else 80
    connection = (
        http.client.HTTPSConnection(parts.hostname, port, timeout=_PREVIEW_FETCH_TIMEOUT_SEC)
        if parts.scheme == "https"
        else http.client.HTTPConnection(parts.hostname, port, timeout=_PREVIEW_FETCH_TIMEOUT_SEC)
    )
    sock = socket.create_connection((ip, port), timeout=_PREVIEW_FETCH_TIMEOUT_SEC)
    try:
        connection.sock = (
            ssl.create_default_context().wrap_socket(sock, server_hostname=parts.hostname)
            if parts.scheme == "https"
            else sock
        )
    except Exception:
        sock.close()
        raise
    try:
        connection.request(
            "GET",
            (parts.path or "/") + (f"?{parts.query}" if parts.query else ""),
            headers={
                "Host": parts.netloc,
                "User-Agent": "Mozilla/5.0 (compatible; ItInventBot/1.0)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ru,en;q=0.9",
            },
        )
        response = connection.getresponse()
        if not 200 <= response.status < 300:
            raise OSError("Unexpected HTTP status")
        return response.headers.get("Content-Type", ""), response.read(65536)
    finally:
        connection.close()


def _fetch_link_preview_uncached(normalized: str) -> dict:
    ip = assert_public_http_url(normalized)
    parts = urlsplit(normalized)
    try:
        content_type, raw = _open_pinned_url(parts, ip)
    except HTTPException:
        raise
    except Exception as exc:
        http_logger.debug("link-preview fetch failed for %s: %s", normalized, exc)
        raise HTTPException(status_code=422, detail="Could not fetch URL") from exc
    if "text/html" not in content_type:
        return {
            "url": normalized,
            "title": None,
            "description": None,
            "image": None,
            "site_name": None,
        }
    html = raw.decode("utf-8", errors="replace")
    meta = extract_og_meta(html)
    return {
        "url": normalized,
        "title": meta.get("title"),
        "description": meta.get("description"),
        "image": meta.get("image"),
        "site_name": meta.get("site_name"),
    }
