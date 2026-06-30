"""Link preview fetch with SSRF guards for chat."""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
import urllib.request
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


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, D401
        return None


_LINK_PREVIEW_OPENER = urllib.request.build_opener(_NoRedirectHandler)


def assert_public_http_url(raw_url: str) -> None:
    parts = urlsplit(raw_url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(parts.hostname, port, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise HTTPException(status_code=422, detail="Could not resolve URL") from exc
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise HTTPException(status_code=400, detail="URL host is not allowed")


def fetch_link_preview(url: str) -> dict:
    normalized = str(url or "").strip()
    if not normalized.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")
    assert_public_http_url(normalized)
    try:
        req = urllib.request.Request(
            normalized,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ItInventBot/1.0)",
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ru,en;q=0.9",
            },
        )
        with _LINK_PREVIEW_OPENER.open(req, timeout=5) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type:
                return {
                    "url": normalized,
                    "title": None,
                    "description": None,
                    "image": None,
                    "site_name": None,
                }
            raw = resp.read(65536)
            html = raw.decode("utf-8", errors="replace")
    except HTTPException:
        raise
    except Exception as exc:
        http_logger.debug("link-preview fetch failed for %s: %s", normalized, exc)
        raise HTTPException(status_code=422, detail="Could not fetch URL") from exc
    meta = extract_og_meta(html)
    return {
        "url": normalized,
        "title": meta.get("title"),
        "description": meta.get("description"),
        "image": meta.get("image"),
        "site_name": meta.get("site_name"),
    }
