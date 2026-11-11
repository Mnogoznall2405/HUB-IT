"""Web-session authentication for the voice server.

Mirrors scan_server/app.py: the hub session token is validated by calling the
main backend ``/api/v1/auth/me`` with the user's Bearer/cookie token, then the
``permissions`` list in the payload is checked. No local user database.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import config

logger = logging.getLogger("voice-server")

AUTH_COOKIE_NAME = "itinvent_access_token"

security_optional = HTTPBearer(auto_error=False)

web_auth_cache_lock = threading.Lock()
web_auth_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}

PERM_READ = "voice.read"
PERM_UPLOAD = "voice.upload"
PERM_MANAGE = "voice.manage"


def _credentials_exception() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden_exception(permission: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Insufficient permissions: {permission}",
    )


def _resolve_access_token(
    credentials: Optional[HTTPAuthorizationCredentials],
    access_token_cookie: Optional[str],
) -> Optional[str]:
    if credentials and credentials.credentials:
        return str(credentials.credentials).strip() or None
    if access_token_cookie:
        return str(access_token_cookie).strip() or None
    return None


def _extract_forwarded_client_ip(request: Request) -> str:
    forwarded = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = str(request.headers.get("x-real-ip") or "").strip()
    if real_ip:
        return real_ip
    client = getattr(request, "client", None)
    return str(getattr(client, "host", "") or "").strip()


def _fetch_web_user(
    token: str,
    *,
    client_ip: Optional[str] = None,
    forwarded_proto: Optional[str] = None,
    forwarded_host: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_client_ip = str(client_ip or "").strip()
    cache_seed = f"{token}\0{normalized_client_ip}"
    cache_key = hashlib.sha256(cache_seed.encode("utf-8", errors="ignore")).hexdigest()
    now_value = time.monotonic()
    with web_auth_cache_lock:
        cached = web_auth_cache.get(cache_key)
        if cached is not None and cached[0] > now_value:
            return dict(cached[1])

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    # Backend admin IP allowlist evaluates the caller of /auth/me. Voice must
    # forward the browser IP, otherwise loopback 127.0.0.1 is rejected for admins.
    if normalized_client_ip:
        headers["X-Forwarded-For"] = normalized_client_ip
        headers["X-Real-IP"] = normalized_client_ip
    proto = str(forwarded_proto or "").strip()
    if proto:
        headers["X-Forwarded-Proto"] = proto
    host = str(forwarded_host or "").strip()
    if host:
        headers["X-Forwarded-Host"] = host

    request = UrlRequest(config.web_auth_me_url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=config.web_auth_timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN}:
            raise _credentials_exception() from exc
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web auth service unavailable",
        ) from exc
    except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Web auth request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web auth service unavailable",
        ) from exc

    if not isinstance(payload, dict) or not payload.get("id") or not bool(payload.get("is_active", True)):
        raise _credentials_exception()
    ttl = int(config.web_auth_cache_ttl_sec)
    if ttl > 0:
        with web_auth_cache_lock:
            if len(web_auth_cache) >= 512:
                expired = [key for key, value in web_auth_cache.items() if value[0] <= now_value]
                for key in expired:
                    web_auth_cache.pop(key, None)
                if len(web_auth_cache) >= 512:
                    web_auth_cache.pop(next(iter(web_auth_cache)), None)
            web_auth_cache[cache_key] = (now_value + ttl, dict(payload))
    return payload


def require_web_permission(permission: str):
    def _dependency(
        request: Request,
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional),
        access_token_cookie: Optional[str] = Cookie(None, alias=AUTH_COOKIE_NAME),
    ) -> Dict[str, Any]:
        token = _resolve_access_token(credentials, access_token_cookie)
        if not token:
            raise _credentials_exception()
        user_raw = _fetch_web_user(
            token,
            client_ip=_extract_forwarded_client_ip(request),
            forwarded_proto=str(request.headers.get("x-forwarded-proto") or "").strip() or None,
            forwarded_host=str(
                request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
            ).strip() or None,
        )
        role = str(user_raw.get("role") or "").strip().lower()
        if role == "admin":
            return user_raw
        permissions = {
            str(item or "").strip()
            for item in (user_raw.get("permissions") if isinstance(user_raw.get("permissions"), list) else [])
            if str(item or "").strip()
        }
        if permission not in permissions:
            raise _forbidden_exception(permission)
        return user_raw

    return _dependency


def user_has_permission(user: Dict[str, Any], permission: str) -> bool:
    role = str(user.get("role") or "").strip().lower()
    if role == "admin":
        return True
    permissions = {
        str(item or "").strip()
        for item in (user.get("permissions") if isinstance(user.get("permissions"), list) else [])
        if str(item or "").strip()
    }
    return permission in permissions


def web_actor(user: Dict[str, Any]) -> str:
    for key in ("username", "login", "email", "full_name", "id"):
        value = str(user.get(key) or "").strip()
        if value:
            return value
    return "authenticated-user"
