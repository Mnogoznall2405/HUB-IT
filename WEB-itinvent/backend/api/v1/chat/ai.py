"""AI chat endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from backend.api.deps import ensure_user_permission, require_permission
from backend.ai_chat.schemas import (
    AiBotListResponse,
    AiConversationStatusResponse,
    AiConversationUpdateRequest,
    AiMemoryItemResponse,
    AiMemoryListResponse,
    AiMemorySettingsRequest,
    AiMemoryUpdateRequest,
)
from backend.chat.schemas import ChatConversationSummary
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ

router = APIRouter()


@router.post("/ai/conversations", response_model=ChatConversationSummary)
async def create_general_ai_conversation(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.create_general_conversation,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_created",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/ai/memory", response_model=AiMemoryListResponse)
async def get_ai_personal_memory(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.list_personal_memory,
        current_user_id=int(current_user.id),
    )


@router.patch("/ai/memory/settings", response_model=AiMemoryListResponse)
async def update_ai_personal_memory_settings(
    payload: AiMemorySettingsRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.set_personal_memory_enabled,
        current_user_id=int(current_user.id),
        enabled=payload.enabled,
    )


@router.patch("/ai/memory/{memory_id}", response_model=AiMemoryItemResponse)
async def update_ai_personal_memory_item(
    memory_id: str,
    payload: AiMemoryUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.update_personal_memory,
            memory_id=memory_id,
            current_user_id=int(current_user.id),
            content=payload.content,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/memory/{memory_id}")
async def delete_ai_personal_memory_item(
    memory_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.delete_personal_memory,
            memory_id=memory_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/memory")
async def clear_ai_personal_memory(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.clear_personal_memory,
        current_user_id=int(current_user.id),
    )

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


@router.post("/ai/bots/{bot_id}/conversations", response_model=ChatConversationSummary)
async def create_ai_bot_conversation(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.create_bot_conversation,
            bot_id=bot_id,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_created",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/ai/conversations/{conversation_id}", response_model=ChatConversationSummary)
async def update_ai_conversation(
    conversation_id: str,
    payload: AiConversationUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.rename_conversation,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
            title=payload.title,
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_renamed",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/conversations/{conversation_id}")
async def delete_ai_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        deleted = await chat_api()._run_chat_call(
            ai_chat_service.delete_conversation,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_deleted_conversation(
            conversation_id=deleted["conversation_id"],
            member_user_ids=deleted["member_user_ids"],
            reason="ai_deleted",
        )
        return {"ok": True, "conversation_id": deleted["conversation_id"]}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations/{conversation_id}/stop", response_model=AiConversationStatusResponse)
async def stop_ai_conversation_run(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.cancel_active_run,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations/{conversation_id}/reset-context")
async def reset_ai_conversation_context(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.reset_conversation_context,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


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


