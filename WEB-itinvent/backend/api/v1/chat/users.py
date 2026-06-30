"""Chat user lookup endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import require_permission
from backend.chat.schemas import ChatUserSummary, ChatUsersResponse
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()


@router.get("/users", response_model=ChatUsersResponse)
async def get_chat_users(
    q: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        items = await chat_api()._run_chat_call(
            chat_api().chat_service.list_available_users,
            current_user_id=int(current_user.id),
            q=q,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/users/resolve", response_model=ChatUserSummary)
async def resolve_chat_user_for_address_book(
    email: str = Query("", min_length=0),
    full_name: str = Query("", min_length=0),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    if not str(email or "").strip() and not str(full_name or "").strip():
        raise HTTPException(status_code=400, detail="email or full_name is required")
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.resolve_user_for_address_book,
            current_user_id=int(current_user.id),
            email=email,
            full_name=full_name,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
