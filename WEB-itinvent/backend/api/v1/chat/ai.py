"""AI chat endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from backend.api.deps import ensure_user_permission, require_permission
from backend.ai_chat.schemas import AiBotListResponse, AiConversationStatusResponse
from backend.chat.schemas import ChatConversationSummary
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ

router = APIRouter()

@router.get("/ai/bots", response_model=AiBotListResponse)
async def list_ai_bots(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.list_bots,
        current_user_id=int(current_user.id),
    )


@router.post("/ai/bots/{bot_id}/open", response_model=ChatConversationSummary)
async def open_ai_bot_conversation(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.open_bot_conversation,
        bot_id=bot_id,
        current_user_id=int(current_user.id),
    )


@router.get("/conversations/{conversation_id}/ai-status", response_model=AiConversationStatusResponse)
async def get_conversation_ai_status(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    ensure_user_permission(current_user, PERM_CHAT_AI_USE)
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.get_conversation_status,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/confirm")
async def confirm_ai_action(
    action_id: str,
    payload: dict[str, Any] | None = Body(default=None),
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import confirm_action

    try:
        return await chat_api()._run_chat_call(
            confirm_action,
            action_id=action_id,
            current_user=current_user,
            payload_overrides=payload,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/cancel")
async def cancel_ai_action(
    action_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import cancel_action

    try:
        return await chat_api()._run_chat_call(
            cancel_action,
            action_id=action_id,
            current_user=current_user,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


