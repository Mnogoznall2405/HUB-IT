"""Rate-limit helpers for one-time my-files owner download grants."""
from __future__ import annotations

import hashlib

from fastapi import Request

from backend.config import config
from backend.utils.rate_limit_guard import enforce_rate_limit
from backend.utils.request_network import build_request_network_context


def _hash_grant_token(token: str) -> str:
    normalized = str(token or "").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _rate_ip_key(request: Request) -> str:
    context = build_request_network_context(request)
    client_ip = str(context.client_ip or "").strip().lower()
    return client_ip or "unknown"


def enforce_download_grant_mint_limits(request: Request, *, user_id: int) -> None:
    limits = config.my_files_download_grant
    ip_key = _rate_ip_key(request)
    enforce_rate_limit(
        namespace="my_files_download_grant_mint:user",
        key=str(int(user_id or 0)),
        limit=limits.mint_limit_per_user,
        window_seconds=limits.mint_window_user_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
    enforce_rate_limit(
        namespace="my_files_download_grant_mint:ip",
        key=ip_key,
        limit=limits.mint_limit_per_ip,
        window_seconds=limits.mint_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )


def enforce_download_grant_consume_limits(request: Request, token: str) -> None:
    limits = config.my_files_download_grant
    enforce_rate_limit(
        namespace="my_files_download_grant_consume:ip",
        key=_rate_ip_key(request),
        limit=limits.consume_limit_per_ip,
        window_seconds=limits.consume_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
    enforce_rate_limit(
        namespace="my_files_download_grant_consume:token",
        key=_hash_grant_token(token),
        limit=1,
        window_seconds=max(30, int(limits.ttl_seconds or 120)),
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )


def enforce_download_grant_miss_limit(request: Request) -> None:
    limits = config.my_files_download_grant
    enforce_rate_limit(
        namespace="my_files_download_grant_miss:ip",
        key=_rate_ip_key(request),
        limit=limits.miss_limit_per_ip,
        window_seconds=limits.miss_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
