"""Rate-limit helpers for authenticated my-files uploads."""
from __future__ import annotations

from fastapi import Request

from backend.config import config
from backend.utils.rate_limit_guard import enforce_rate_limit
from backend.utils.request_network import build_request_network_context


def _rate_ip_key(request: Request) -> str:
    context = build_request_network_context(request)
    client_ip = str(context.client_ip or "").strip().lower()
    return client_ip or "unknown"


def enforce_upload_limits(request: Request, *, user_id: int) -> None:
    limits = config.my_files_security
    enforce_rate_limit(
        namespace="my_files_upload:user",
        key=str(int(user_id or 0)),
        limit=limits.upload_limit_per_user,
        window_seconds=limits.upload_window_user_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
    enforce_rate_limit(
        namespace="my_files_upload:ip",
        key=_rate_ip_key(request),
        limit=limits.upload_limit_per_ip,
        window_seconds=limits.upload_window_ip_sec,
        request=request,
        include_retry_after=True,
        allow_internal_bypass=False,
    )
