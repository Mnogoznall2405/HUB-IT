"""Chat push notification subscription endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from fastapi import APIRouter, Depends

from backend.api.deps import require_permission
from backend.chat.schemas import (
    ChatPushConfigResponse,
    ChatPushSubscriptionDeleteRequest,
    ChatPushSubscriptionRequest,
    ChatPushSubscriptionStatusResponse,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()


@router.get("/push-config", response_model=ChatPushConfigResponse)
async def get_chat_push_config(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(chat_api().chat_service.get_push_config)
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.put("/push-subscription", response_model=ChatPushSubscriptionStatusResponse)
async def upsert_chat_push_subscription(
    payload: ChatPushSubscriptionRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.upsert_push_subscription,
            current_user_id=int(current_user.id),
            endpoint=payload.endpoint,
            p256dh_key=payload.keys.p256dh,
            auth_key=payload.keys.auth,
            expiration_time=payload.expiration_time,
            user_agent=payload.user_agent,
            platform=payload.platform,
            browser_family=payload.browser_family,
            install_mode=payload.install_mode,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/push-subscription", response_model=ChatPushSubscriptionStatusResponse)
async def delete_chat_push_subscription(
    payload: ChatPushSubscriptionDeleteRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.delete_push_subscription,
            current_user_id=int(current_user.id),
            endpoint=payload.endpoint,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
