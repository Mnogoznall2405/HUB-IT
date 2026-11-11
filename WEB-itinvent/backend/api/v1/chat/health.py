"""Chat health endpoint."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from fastapi import APIRouter, Depends

from backend.api.deps import require_permission
from backend.chat.schemas import ChatHealthResponse
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()

@router.get("/health", response_model=ChatHealthResponse)
async def get_chat_health(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    return await chat_api()._run_chat_call(chat_api().chat_service.get_health)


