"""
System observability endpoints.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query

from backend.api.deps import get_current_admin_user
from backend.models.auth import User
from backend.services.request_metrics_service import request_metrics_service


router = APIRouter()


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
