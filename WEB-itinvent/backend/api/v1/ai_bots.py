from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.ai_chat.schemas import (
    AiBotAdminResponse,
    AiBotCreateRequest,
    AiBotRunListResponse,
    AiBotUpdateRequest,
)
from backend.api.deps import require_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_SETTINGS_AI_MANAGE


router = APIRouter()


@router.get("", response_model=list[AiBotAdminResponse])
async def list_ai_bots_admin(
    current_user: User = Depends(require_permission(PERM_SETTINGS_AI_MANAGE)),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.list_admin_bots()


@router.post("", response_model=AiBotAdminResponse)
async def create_ai_bot_admin(
    payload: AiBotCreateRequest,
    current_user: User = Depends(require_permission(PERM_SETTINGS_AI_MANAGE)),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.create_bot(payload.model_dump())


@router.patch("/{bot_id}", response_model=AiBotAdminResponse)
async def update_ai_bot_admin(
    bot_id: str,
    payload: AiBotUpdateRequest,
    current_user: User = Depends(require_permission(PERM_SETTINGS_AI_MANAGE)),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.update_bot(bot_id, payload.model_dump(exclude_unset=True))


@router.get("/{bot_id}/runs", response_model=AiBotRunListResponse)
async def list_ai_bot_runs_admin(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_SETTINGS_AI_MANAGE)),
):
    from backend.ai_chat.service import ai_chat_service

    return {"items": ai_chat_service.list_recent_runs(bot_id=bot_id)}
