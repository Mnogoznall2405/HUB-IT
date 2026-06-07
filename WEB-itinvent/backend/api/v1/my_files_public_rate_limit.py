"""Rate-limit helpers for public my-files share endpoints."""
from __future__ import annotations

import hashlib

from fastapi import Request

from backend.config import config
from backend.utils.rate_limit_guard import enforce_rate_limit
from backend.utils.request_network import build_request_network_context


def _hash_share_token(token: str) -> str:
    normalized = str(token or "").strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _public_rate_ip_key(request: Request) -> str:
    context = build_request_network_context(request)
    client_ip = str(context.client_ip or "").strip().lower()
    return client_ip or "unknown"


def enforce_public_meta_limits(request: Request, token: str) -> None:
    limits = config.my_files_public_rate_limit
    token_key = _hash_share_token(token)
    ip_key = _public_rate_ip_key(request)
    enforce_rate_limit(
        namespace="my_files_public_meta:token",
        key=token_key,
        limit=limits.meta_limit_per_token,
        window_seconds=limits.meta_window_token_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
    enforce_rate_limit(
        namespace="my_files_public_meta:ip",
        key=ip_key,
        limit=limits.meta_limit_per_ip,
        window_seconds=limits.meta_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )


def enforce_public_preview_limits(request: Request, token: str) -> None:
    enforce_public_meta_limits(request, token)


def enforce_public_preview_content_limits(request: Request, token: str) -> None:
    enforce_public_download_limits(request, token)


def enforce_public_download_limits(request: Request, token: str) -> None:
    limits = config.my_files_public_rate_limit
    token_key = _hash_share_token(token)
    ip_key = _public_rate_ip_key(request)
    enforce_rate_limit(
        namespace="my_files_public_download:token",
        key=token_key,
        limit=limits.download_limit_per_token,
        window_seconds=limits.download_window_token_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
    enforce_rate_limit(
        namespace="my_files_public_download:ip",
        key=ip_key,
        limit=limits.download_limit_per_ip,
        window_seconds=limits.download_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )


def enforce_public_miss_limit(request: Request) -> None:
    limits = config.my_files_public_rate_limit
    enforce_rate_limit(
        namespace="my_files_public_miss:ip",
        key=_public_rate_ip_key(request),
        limit=limits.miss_limit_per_ip,
        window_seconds=limits.miss_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
