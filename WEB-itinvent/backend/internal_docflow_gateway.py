"""Loopback-only singleton gateway for personal 1C COM sessions."""
from __future__ import annotations

import asyncio
import hmac
import os
import uuid
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.services.docflow_service import DocflowServiceError, docflow_service
from backend.services.docflow_gateway_security import docflow_gateway_token


class GatewayCallRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: int = Field(..., ge=1)
    operation: Literal[
        "metadata",
        "tasks",
        "task_detail",
        "task_state",
        "task_action",
        "assignment_documents",
        "assignment_assignees",
        "assignment_state",
        "assignment_create",
        "file_export",
    ]
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: str = Field(default="", max_length=64)


app = FastAPI(
    title="HUB-IT internal docflow gateway",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_warmup_task: asyncio.Task | None = None
_warmup_status: dict[str, Any] = {
    "enabled": False,
    "running": False,
    "profiles": 0,
    "succeeded": 0,
    "failed": 0,
}


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in {"1", "true", "yes", "on"}


def _bounded_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)) or default)))
    except (TypeError, ValueError):
        return default


async def _warmup_loop() -> None:
    initial_delay = _bounded_int("DOCFLOW_GATEWAY_WARMUP_INITIAL_DELAY_SECONDS", 15, minimum=0, maximum=600)
    interval = _bounded_int("DOCFLOW_GATEWAY_WARMUP_INTERVAL_SECONDS", 600, minimum=60, maximum=86_400)
    concurrency = _bounded_int("DOCFLOW_GATEWAY_WARMUP_CONCURRENCY", 2, minimum=1, maximum=8)
    profile_limit = _bounded_int("DOCFLOW_GATEWAY_WARMUP_PROFILE_LIMIT", 200, minimum=1, maximum=500)
    await asyncio.sleep(initial_delay)
    while True:
        user_ids = await docflow_service.warmup_user_ids(limit=profile_limit)
        _warmup_status.update({
            "enabled": True,
            "running": True,
            "profiles": len(user_ids),
            "succeeded": 0,
            "failed": 0,
        })
        semaphore = asyncio.Semaphore(concurrency)

        async def warm_one(user_id: int) -> None:
            async with semaphore:
                succeeded = await docflow_service.warmup_user(user_id=int(user_id))
                key = "succeeded" if succeeded else "failed"
                _warmup_status[key] = int(_warmup_status.get(key) or 0) + 1

        await asyncio.gather(*(warm_one(user_id) for user_id in user_ids))
        _warmup_status["running"] = False
        await asyncio.sleep(interval)


@app.on_event("startup")
async def startup_gateway() -> None:
    global _warmup_task
    enabled = _env_flag("DOCFLOW_GATEWAY_WARMUP_ENABLED")
    _warmup_status["enabled"] = enabled
    if enabled:
        _warmup_task = asyncio.create_task(_warmup_loop(), name="docflow-gateway-warmup")


def _correlation(value: str) -> str:
    normalized = str(value or "").strip()[:64]
    return normalized or uuid.uuid4().hex


def _authorize(request: Request, provided_token: str) -> None:
    client_host = str(request.client.host if request.client else "")
    if client_host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(status_code=403, detail="Loopback access only")
    expected = docflow_gateway_token()
    if len(expected) < 32 or not hmac.compare_digest(expected, str(provided_token or "")):
        raise HTTPException(status_code=403, detail="Invalid gateway token")


@app.get("/health")
async def health(request: Request, x_docflow_gateway_token: str = Header("")) -> dict[str, Any]:
    _authorize(request, x_docflow_gateway_token)
    return {
        "status": "ok",
        "service": "docflow-gateway",
        "runtime": docflow_service.gateway_status(),
        "warmup": dict(_warmup_status),
    }


@app.post("/internal/v1/call")
async def call(
    payload: GatewayCallRequest,
    request: Request,
    x_docflow_gateway_token: str = Header(""),
) -> dict[str, Any]:
    _authorize(request, x_docflow_gateway_token)
    correlation = _correlation(payload.correlation_id)
    try:
        result = await docflow_service.gateway_call(
            user_id=int(payload.user_id),
            operation=payload.operation,
            payload=payload.payload,
        )
    except DocflowServiceError as exc:
        # Use an error HTTP code even for an outcome-unknown command so the
        # backend client cannot mistake a detail envelope for a successful result.
        raise HTTPException(
            status_code=max(400, int(getattr(exc, "status_code", 503) or 503)),
            detail={
                "code": str(getattr(exc, "code", "DOCFLOW_ERROR")),
                "message": str(exc),
                "correlation_id": correlation,
            },
        ) from exc
    return {"result": result, "correlation_id": correlation}


@app.on_event("shutdown")
async def shutdown_gateway() -> None:
    global _warmup_task
    if _warmup_task is not None:
        _warmup_task.cancel()
        try:
            await _warmup_task
        except asyncio.CancelledError:
            pass
        _warmup_task = None
    docflow_service.shutdown()
