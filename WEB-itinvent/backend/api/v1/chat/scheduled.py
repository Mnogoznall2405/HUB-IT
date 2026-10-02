"""Scheduled ("Send later") messages of a conversation. See backend/chat/scheduled_messages.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import require_permission
from backend.chat.scheduled_messages import (
    ScheduledMessageDisabled,
    chat_scheduled_message_service,
)
from backend.chat.schemas import (
    ChatScheduledMessageCreateRequest,
    ChatScheduledMessageListResponse,
    ChatScheduledMessageResponse,
    ChatScheduledMessageUpdateRequest,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

router = APIRouter()


async def _call(function, **kwargs):
    try:
        return await run_in_threadpool(function, **kwargs)
    except ScheduledMessageDisabled as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/conversations/{conversation_id}/scheduled", response_model=ChatScheduledMessageListResponse)
async def list_scheduled_messages(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    items = await _call(
        chat_scheduled_message_service.list_for_conversation,
        current_user_id=int(current_user.id),
        conversation_id=conversation_id,
    )
    return {"items": items}


@router.post("/conversations/{conversation_id}/scheduled", response_model=ChatScheduledMessageResponse)
async def create_scheduled_message(
    conversation_id: str,
    payload: ChatScheduledMessageCreateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    return await _call(
        chat_scheduled_message_service.create,
        current_user_id=int(current_user.id),
        conversation_id=conversation_id,
        body=payload.body,
        body_format=payload.body_format,
        scheduled_for=payload.scheduled_for,
        reply_to_message_id=payload.reply_to_message_id,
    )


@router.patch("/scheduled/{scheduled_id}", response_model=ChatScheduledMessageResponse)
async def update_scheduled_message(
    scheduled_id: str,
    payload: ChatScheduledMessageUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    return await _call(
        chat_scheduled_message_service.update,
        current_user_id=int(current_user.id),
        scheduled_id=scheduled_id,
        body=payload.body,
        scheduled_for=payload.scheduled_for,
    )


@router.delete("/scheduled/{scheduled_id}")
async def cancel_scheduled_message(
    scheduled_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    return await _call(
        chat_scheduled_message_service.cancel,
        current_user_id=int(current_user.id),
        scheduled_id=scheduled_id,
    )
