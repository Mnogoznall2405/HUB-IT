"""Owner-scoped OpenCode sandbox panel and permission endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.ai_sandbox.schemas import (
    SandboxConversationView,
    SandboxJobAccepted,
    SandboxPermissionResponseRequest,
    SandboxPermissionResponseResult,
)
from backend.ai_sandbox.service import SandboxDisabledError
from backend.api.deps import require_permission
from backend.api.v1.chat._shim import chat_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_AI_SANDBOX


router = APIRouter()


def _sandbox_service():
    from backend.ai_sandbox.app_service import ai_sandbox_app_service

    return ai_sandbox_app_service


def _raise_sandbox_error(exc: Exception) -> None:
    if isinstance(exc, SandboxDisabledError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OpenCode sandbox is disabled")
    chat_api()._raise_chat_http_error(exc)


@router.get(
    "/ai/sandbox/conversations/{conversation_id}",
    response_model=SandboxConversationView,
)
async def get_ai_sandbox_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_SANDBOX)),
):
    try:
        return await chat_api()._run_chat_call(
            _sandbox_service().conversation_snapshot,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sandbox_error(exc)


@router.post(
    "/ai/sandbox/permissions/{permission_id}/respond",
    response_model=SandboxPermissionResponseResult,
)
async def respond_ai_sandbox_permission(
    permission_id: str,
    payload: SandboxPermissionResponseRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_SANDBOX)),
):
    try:
        return await chat_api()._run_chat_call(
            _sandbox_service().respond_permission,
            permission_id=permission_id,
            current_user_id=int(current_user.id),
            decision=payload.decision,
            scope=payload.scope,
        )
    except Exception as exc:
        _raise_sandbox_error(exc)


@router.post(
    "/ai/sandbox/conversations/{conversation_id}/archive/attach",
    response_model=SandboxJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def attach_ai_sandbox_archive(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_SANDBOX)),
):
    try:
        return await chat_api()._run_chat_call(
            _sandbox_service().request_archive,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sandbox_error(exc)


@router.post(
    "/ai/sandbox/files/{file_id}/attach",
    response_model=SandboxJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def attach_ai_sandbox_file(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_SANDBOX)),
):
    try:
        return await chat_api()._run_chat_call(
            _sandbox_service().request_file_attach,
            file_id=file_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sandbox_error(exc)

