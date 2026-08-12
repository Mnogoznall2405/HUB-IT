"""Authenticated HUB Desktop presence endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from backend.api.deps import get_current_active_user, get_current_session_id
from backend.models.auth import User
from backend.services.desktop_presence_service import (
    DesktopPresenceIdentityError,
    desktop_presence_service,
)
from backend.utils.rate_limit_guard import enforce_rate_limit


router = APIRouter()


class DesktopPresenceHeartbeatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DesktopPresenceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool = False
    expires_in_seconds: int = Field(default=0, ge=0, le=600)


def _require_session(session_id: str | None) -> str:
    normalized = str(session_id or "").strip()
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="An active HUB session is required",
        )
    return normalized


def _translate_identity_error(exc: DesktopPresenceIdentityError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Session identity conflict")


@router.post("/heartbeat", response_model=DesktopPresenceResponse)
async def heartbeat_desktop_presence(
    payload: DesktopPresenceHeartbeatRequest,
    request: Request,
    current_user: User = Depends(get_current_active_user),
    session_id: str | None = Depends(get_current_session_id),
):
    _ = payload
    normalized_session_id = _require_session(session_id)
    enforce_rate_limit(
        namespace="desktop_presence_heartbeat",
        key=f"user:{int(current_user.id)}",
        limit=120,
        window_seconds=60,
        request=request,
        include_retry_after=True,
    )
    try:
        data = await run_in_threadpool(
            desktop_presence_service.heartbeat,
            user_id=int(current_user.id),
            session_id=normalized_session_id,
        )
    except DesktopPresenceIdentityError as exc:
        raise _translate_identity_error(exc) from exc
    return DesktopPresenceResponse(**data)


@router.get("/status", response_model=DesktopPresenceResponse)
async def get_desktop_presence_status(
    current_user: User = Depends(get_current_active_user),
    session_id: str | None = Depends(get_current_session_id),
):
    normalized_session_id = _require_session(session_id)
    try:
        data = await run_in_threadpool(
            desktop_presence_service.get_current,
            user_id=int(current_user.id),
            session_id=normalized_session_id,
        )
    except DesktopPresenceIdentityError as exc:
        raise _translate_identity_error(exc) from exc
    return DesktopPresenceResponse(**data)


@router.delete("/current", response_model=DesktopPresenceResponse)
async def disconnect_desktop_presence(
    current_user: User = Depends(get_current_active_user),
    session_id: str | None = Depends(get_current_session_id),
):
    normalized_session_id = _require_session(session_id)
    try:
        await run_in_threadpool(
            desktop_presence_service.disconnect,
            user_id=int(current_user.id),
            session_id=normalized_session_id,
        )
    except DesktopPresenceIdentityError as exc:
        raise _translate_identity_error(exc) from exc
    return DesktopPresenceResponse(active=False, expires_in_seconds=0)
