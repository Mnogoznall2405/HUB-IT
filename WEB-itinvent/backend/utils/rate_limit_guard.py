"""Shared HTTP rate-limit enforcement for API routes."""
from __future__ import annotations

import time
from typing import Optional

from fastapi import HTTPException, Request

from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.utils.request_network import build_request_network_context


def request_is_internal(request: Optional[Request]) -> bool:
    if request is None:
        return False
    try:
        return str(build_request_network_context(request).network_zone or "").strip().lower() == "internal"
    except Exception:
        return False


def _retry_after_seconds(counter: dict, window_seconds: int) -> int:
    expires_at = int(counter.get("expires_at", 0) or 0)
    now_ts = int(time.time())
    if expires_at > now_ts:
        return max(1, expires_at - now_ts)
    window_started_at = int(counter.get("window_started_at", 0) or 0)
    if window_started_at > 0:
        return max(1, window_started_at + max(1, int(window_seconds)) - now_ts)
    return max(1, int(window_seconds))


def enforce_rate_limit(
    *,
    namespace: str,
    key: str,
    limit: int,
    window_seconds: int,
    request: Optional[Request] = None,
    include_retry_after: bool = False,
    allow_internal_bypass: bool = True,
) -> None:
    if allow_internal_bypass and request_is_internal(request):
        return
    normalized_key = str(key or "").strip().lower()
    if not normalized_key:
        normalized_key = "anonymous"
    network_zone = "unknown"
    if request is not None:
        try:
            network_zone = str(build_request_network_context(request).network_zone or "unknown").strip().lower()
        except Exception:
            network_zone = "unknown"
    storage_key = f"{namespace}:{network_zone}:{normalized_key}"
    window = max(1, int(window_seconds))
    counter = auth_runtime_store_service.increment_counter(
        "rate_limit",
        storage_key,
        window_seconds=window,
    )
    if int(counter.get("count", 0) or 0) > int(limit):
        headers = {}
        if include_retry_after:
            headers["Retry-After"] = str(_retry_after_seconds(counter, window))
        raise HTTPException(
            status_code=429,
            detail="Too many requests, try again later",
            headers=headers,
        )
