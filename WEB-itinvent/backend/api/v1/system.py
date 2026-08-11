"""
System observability endpoints.
"""
from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from backend.api.deps import get_current_admin_user
from backend.models.auth import User
from backend.services.request_metrics_service import request_metrics_service


router = APIRouter()


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or "").strip().lower() in {"1", "true", "yes", "on"}


def _is_loopback_client(request: Request) -> bool:
    host = ""
    if request.client is not None:
        host = str(request.client.host or "").strip().lower()
    return host in {"127.0.0.1", "::1", "localhost", "testclient"}


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
