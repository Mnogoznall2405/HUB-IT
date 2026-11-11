"""
System observability endpoints.
"""
from __future__ import annotations

import ipaddress
import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from backend.api.deps import get_current_admin_user
from backend.models.auth import User
from backend.services.request_metrics_service import request_metrics_service
from backend.utils.request_network import build_request_network_context


router = APIRouter()


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_loopback_client(request: Request) -> bool:
    """True only for a genuinely local caller.

    Behind IIS every request reaches the backend from 127.0.0.1, so the raw socket peer proves nothing:
    the real client is resolved through the trusted-proxy chain (same rule as the 2FA zone check).
    """
    context = build_request_network_context(request)
    candidate = context.client_ip
    if not candidate and request.client is not None:
        candidate = str(request.client.host or "").strip().lower()
    if candidate == "testclient":
        return True
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


def _ensure_local_metrics_access(request: Request) -> None:
    """Allow unauthenticated metrics only from loopback when explicitly enabled."""
    if not _env_flag("REQUEST_METRICS_LOCALHOST_OPEN", "0"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local request-metrics endpoint is disabled (REQUEST_METRICS_LOCALHOST_OPEN=0)",
        )
    if not _is_loopback_client(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local request-metrics endpoint is only available from loopback",
        )


@router.get("/request-metrics")
async def get_request_metrics(
    limit: int = Query(default=50, ge=1, le=200),
    sort_by: Literal["count", "mean_ms", "p95_ms", "p99_ms", "max_ms", "server_error_count"] = "p95_ms",
    _: User = Depends(get_current_admin_user),
):
    return request_metrics_service.snapshot(limit=limit, sort_by=sort_by)


@router.post("/request-metrics/reset")
async def reset_request_metrics(
    _: User = Depends(get_current_admin_user),
):
    request_metrics_service.reset()
    return {"ok": True}


@router.get("/request-metrics/local")
async def get_request_metrics_local(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    sort_by: Literal["count", "mean_ms", "p95_ms", "p99_ms", "max_ms", "server_error_count"] = "p95_ms",
):
    """Loopback-only metrics snapshot for load-test diagnosis (no admin JWT)."""
    _ensure_local_metrics_access(request)
    return request_metrics_service.snapshot(limit=limit, sort_by=sort_by)


@router.post("/request-metrics/local/reset")
async def reset_request_metrics_local(request: Request):
    """Loopback-only metrics reset before a load-test run."""
    _ensure_local_metrics_access(request)
    request_metrics_service.reset()
    return {"ok": True}
