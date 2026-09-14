from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, StrictBool

from backend.ai_chat.schemas import (
    AiBotAdminResponse,
    AiBotCreateRequest,
    AiBotRunListResponse,
    AiBotUpdateRequest,
)
from backend.api.deps import get_current_active_user, ensure_user_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_SETTINGS_AI_MANAGE


router = APIRouter()


async def require_agent_manager(current_user: User = Depends(get_current_active_user)):
    if current_user.role != 'admin':
        ensure_user_permission(current_user, PERM_SETTINGS_AI_MANAGE)
    return current_user


class AgentAccessRequest(BaseModel):
    allowed: StrictBool


async def _access_call(function, **kwargs):
    try:
        return await run_in_threadpool(function, **kwargs)
    except LookupError as exc:
        raise HTTPException(404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.get('/access/users/{user_id}')
async def get_user_agent_access(user_id: int, current_user: User = Depends(require_agent_manager)):
    from backend.ai_chat.access import list_user_access
    return await _access_call(list_user_access, user_id=user_id)


@router.get('/{bot_id}/access')
async def get_agent_access(bot_id: str, q: str = Query('', max_length=100),
                           offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                           current_user: User = Depends(require_agent_manager)):
    from backend.ai_chat.access import list_bot_access
    return await _access_call(list_bot_access, bot_id=bot_id, query=q, offset=offset, limit=limit)


@router.put('/{bot_id}/access/{user_id}')
async def update_agent_access(bot_id: str, user_id: int, payload: AgentAccessRequest,
                              current_user: User = Depends(require_agent_manager)):
    from backend.ai_chat.access import set_access
    return await _access_call(set_access, bot_id=bot_id, user_id=user_id,
                              allowed=payload.allowed, actor_id=int(current_user.id))


@router.get("", response_model=list[AiBotAdminResponse])
async def list_ai_bots_admin(
    current_user: User = Depends(require_agent_manager),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.list_admin_bots()


@router.post("", response_model=AiBotAdminResponse)
async def create_ai_bot_admin(
    payload: AiBotCreateRequest,
    current_user: User = Depends(require_agent_manager),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.create_bot(payload.model_dump())


@router.patch("/{bot_id}", response_model=AiBotAdminResponse)
async def update_ai_bot_admin(
    bot_id: str,
    payload: AiBotUpdateRequest,
    current_user: User = Depends(require_agent_manager),
):
    from backend.ai_chat.service import ai_chat_service

    return ai_chat_service.update_bot(bot_id, payload.model_dump(exclude_unset=True))


@router.get("/{bot_id}/runs", response_model=AiBotRunListResponse)
async def list_ai_bot_runs_admin(
    bot_id: str,
    current_user: User = Depends(require_agent_manager),
):
    from backend.ai_chat.service import ai_chat_service

    return {"items": ai_chat_service.list_recent_runs(bot_id=bot_id)}
