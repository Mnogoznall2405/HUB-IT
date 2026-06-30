"""Chat upload session endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from backend.api.deps import get_current_database_id, require_permission
from backend.chat.schemas import (
    ChatMessageResponse,
    ChatUploadSessionCancelResponse,
    ChatUploadSessionChunkResponse,
    ChatUploadSessionCreateRequest,
    ChatUploadSessionResponse,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_WRITE

router = APIRouter()


@router.post("/conversations/{conversation_id}/upload-sessions", response_model=ChatUploadSessionResponse)
async def create_chat_upload_session(
    conversation_id: str,
    payload: ChatUploadSessionCreateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.create_upload_session,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=payload.body,
            reply_to_message_id=payload.reply_to_message_id,
            files=[item.model_dump() for item in list(payload.files or [])],
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.put("/upload-sessions/{session_id}/files/{file_id}/chunks/{chunk_index}", response_model=ChatUploadSessionChunkResponse)
async def upload_chat_upload_session_chunk(
    session_id: str,
    file_id: str,
    chunk_index: int,
    offset: int = Query(..., ge=0),
    payload: bytes = Body(default=b"", media_type="application/octet-stream"),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.upload_session_chunk,
            current_user_id=int(current_user.id),
            session_id=session_id,
            file_id=file_id,
            chunk_index=int(chunk_index),
            offset=int(offset),
            payload=bytes(payload or b""),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/upload-sessions/{session_id}", response_model=ChatUploadSessionResponse)
async def get_chat_upload_session(
    session_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/upload-sessions/{session_id}/complete", response_model=ChatMessageResponse)
async def complete_chat_upload_session(
    session_id: str,
    db_id: Optional[str] = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message, meta = await chat_api()._run_chat_call_with_meta(
            chat_api().chat_service.complete_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
            defer_push_notifications=True,
        )
        if bool(meta.get("upload_session_completed_now")):
            chat_api()._schedule_chat_message_side_effects(
                conversation_id=message["conversation_id"],
                message_id=message["id"],
            )
            chat_api()._schedule_ai_run_for_message(
                current_user_id=int(current_user.id),
                conversation_id=message["conversation_id"],
                message_id=message["id"],
                effective_database_id=db_id,
            )
        return message
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/upload-sessions/{session_id}", response_model=ChatUploadSessionCancelResponse)
async def cancel_chat_upload_session(
    session_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.cancel_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
