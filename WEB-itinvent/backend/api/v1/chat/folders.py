"""Chat folder endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from fastapi import APIRouter, Depends

from backend.api.deps import require_permission
from backend.chat.schemas import (
    ChatFolderCreateRequest,
    ChatFolderListResponse,
    ChatFolderMembershipUpdateRequest,
    ChatFolderMutationResponse,
    ChatFolderSummary,
    ChatFolderUpdateRequest,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

router = APIRouter()


@router.get("/folders", response_model=ChatFolderListResponse)
async def list_chat_folders(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(chat_api().chat_service.list_chat_folders, current_user_id=int(current_user.id))
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/folders", response_model=ChatFolderMutationResponse)
async def create_chat_folder(
    payload: ChatFolderCreateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        item = await chat_api()._run_chat_call(
            chat_api().chat_service.create_chat_folder,
            current_user_id=int(current_user.id),
            name=payload.name,
        )
        return {"ok": True, "item": item}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/folders/{folder_id}", response_model=ChatFolderSummary)
async def get_chat_folder(
    folder_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_chat_folder,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/folders/{folder_id}", response_model=ChatFolderMutationResponse)
async def update_chat_folder(
    folder_id: str,
    payload: ChatFolderUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        item = await chat_api()._run_chat_call(
            chat_api().chat_service.update_chat_folder,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
            name=payload.name,
            sort_order=payload.sort_order,
        )
        return {"ok": True, "item": item}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/folders/{folder_id}")
async def delete_chat_folder(
    folder_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.delete_chat_folder,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.put("/folders/{folder_id}/conversations", response_model=ChatFolderMutationResponse)
async def set_chat_folder_conversations(
    folder_id: str,
    payload: ChatFolderMembershipUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        item = await chat_api()._run_chat_call(
            chat_api().chat_service.set_chat_folder_conversations,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
            conversation_ids=list(payload.conversation_ids or []),
        )
        return {"ok": True, "item": item}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/folders/{folder_id}/conversations/{conversation_id}", response_model=ChatFolderMutationResponse)
async def add_chat_folder_conversation(
    folder_id: str,
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        item = await chat_api()._run_chat_call(
            chat_api().chat_service.add_chat_folder_conversation,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
            conversation_id=conversation_id,
        )
        return {"ok": True, "item": item}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/folders/{folder_id}/conversations/{conversation_id}", response_model=ChatFolderMutationResponse)
async def remove_chat_folder_conversation(
    folder_id: str,
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        item = await chat_api()._run_chat_call(
            chat_api().chat_service.remove_chat_folder_conversation,
            current_user_id=int(current_user.id),
            folder_id=folder_id,
            conversation_id=conversation_id,
        )
        return {"ok": True, "item": item}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
