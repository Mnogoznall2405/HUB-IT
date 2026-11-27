"""Telegram sticker-pack endpoints for Chat."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.api.deps import get_current_database_id, require_permission
from backend.api.v1.chat._shim import chat_api
from backend.api.v1.chat.sticker_import_rate_limit import enforce_sticker_import_limits
from backend.chat.schemas import (
    ChatMessageResponse,
    ChatStickerListResponse,
    ChatStickerPackImportRequest,
    ChatStickerPackListResponse,
    ChatStickerPackOrderRequest,
    ChatStickerPackResponse,
    ChatStickerRecentListResponse,
    ChatStickerRecentUpdateRequest,
    ChatStickerSendRequest,
)
from backend.chat.telegram_sticker_service import (
    TelegramStickerConfigurationError,
    TelegramStickerImportError,
    telegram_sticker_service,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE


router = APIRouter()
_IMMUTABLE_STICKER_CACHE_HEADERS = {
    "Cache-Control": "private, max-age=31536000, immutable",
}


def _raise_sticker_error(exc: Exception) -> None:
    if isinstance(exc, TelegramStickerConfigurationError):
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if isinstance(exc, TelegramStickerImportError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    chat_api()._raise_chat_http_error(exc)


@router.get("/sticker-packs", response_model=ChatStickerPackListResponse)
async def list_chat_sticker_packs(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_read_call(
            telegram_sticker_service.list_packs,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.post("/sticker-packs/import", response_model=ChatStickerPackListResponse)
async def import_chat_sticker_pack(
    payload: ChatStickerPackImportRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    # Per-user throttle before any work: even a rejected pack name costs a
    # Telegram getStickerSet call, and an uncached import is the most expensive
    # fan-out in the chat API. Runs in the threadpool — the counter store does
    # synchronous DB I/O. The permission dependency above already rejected
    # write-less users, so their attempts never consume quota.
    await run_in_threadpool(
        enforce_sticker_import_limits,
        request,
        user_id=int(current_user.id),
    )
    try:
        return await telegram_sticker_service.import_pack(
            current_user_id=int(current_user.id),
            source=payload.source,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.get(
    "/sticker-packs/preview/{short_name}",
    response_model=ChatStickerPackResponse,
)
async def preview_chat_sticker_pack(
    short_name: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_read_call(
            telegram_sticker_service.preview_pack,
            current_user_id=int(current_user.id),
            short_name=short_name,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.get("/sticker-packs/preview/{short_name}/stickers/{sticker_id}/file")
async def serve_shared_chat_sticker_file(
    short_name: str,
    sticker_id: str,
    _current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        item = await chat_api()._run_chat_read_call(
            telegram_sticker_service.get_pack_sticker_file,
            short_name=short_name,
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)
    return FileResponse(
        path=item["path"],
        filename=item["file_name"],
        media_type=item["mime_type"],
        content_disposition_type="inline",
        headers=_IMMUTABLE_STICKER_CACHE_HEADERS,
    )


@router.get("/sticker-packs/preview/{short_name}/stickers/{sticker_id}/preview")
async def serve_shared_chat_sticker_preview(
    short_name: str,
    sticker_id: str,
    _current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        item = await chat_api()._run_chat_read_call(
            telegram_sticker_service.get_pack_sticker_preview,
            short_name=short_name,
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)
    return FileResponse(
        path=item["path"],
        filename=item["file_name"],
        media_type=item["mime_type"],
        content_disposition_type="inline",
        headers=_IMMUTABLE_STICKER_CACHE_HEADERS,
    )


@router.delete("/sticker-packs/{pack_id}")
async def remove_chat_sticker_pack(
    pack_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_write_call(
            telegram_sticker_service.remove_pack,
            current_user_id=int(current_user.id),
            pack_id=pack_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.post("/sticker-packs/order", response_model=ChatStickerPackListResponse)
async def reorder_chat_sticker_packs(
    payload: ChatStickerPackOrderRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_write_call(
            telegram_sticker_service.reorder_sticker_packs,
            current_user_id=int(current_user.id),
            pack_ids=payload.pack_ids,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.get("/stickers/favorites", response_model=ChatStickerListResponse)
async def list_chat_favorite_stickers(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_read_call(
            telegram_sticker_service.list_favorite_stickers,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.put("/stickers/favorites/{sticker_id}", response_model=ChatStickerListResponse)
async def add_chat_favorite_sticker(
    sticker_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_write_call(
            telegram_sticker_service.add_favorite_sticker,
            current_user_id=int(current_user.id),
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.delete("/stickers/favorites/{sticker_id}", response_model=ChatStickerListResponse)
async def remove_chat_favorite_sticker(
    sticker_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_write_call(
            telegram_sticker_service.remove_favorite_sticker,
            current_user_id=int(current_user.id),
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.get("/stickers/recent", response_model=ChatStickerRecentListResponse)
async def list_chat_recent_stickers(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_read_call(
            telegram_sticker_service.list_recent_stickers,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.put("/stickers/recent", response_model=ChatStickerRecentListResponse)
async def replace_chat_recent_stickers(
    payload: ChatStickerRecentUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_write_call(
            telegram_sticker_service.replace_recent_stickers,
            current_user_id=int(current_user.id),
            sticker_ids=payload.sticker_ids,
            base_version=payload.base_version,
            clear=payload.clear,
            ops=[{"op": entry.op, "sticker_id": entry.sticker_id} for entry in payload.ops],
            op_batch_id=payload.op_batch_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)


@router.get("/stickers/{sticker_id}/file")
async def serve_chat_sticker_file(
    sticker_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        item = await chat_api()._run_chat_read_call(
            telegram_sticker_service.get_sticker_file,
            current_user_id=int(current_user.id),
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)
    return FileResponse(
        path=item["path"],
        filename=item["file_name"],
        media_type=item["mime_type"],
        content_disposition_type="inline",
        headers=_IMMUTABLE_STICKER_CACHE_HEADERS,
    )


@router.get("/stickers/{sticker_id}/preview")
async def serve_chat_sticker_preview(
    sticker_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        item = await chat_api()._run_chat_read_call(
            telegram_sticker_service.get_sticker_preview,
            current_user_id=int(current_user.id),
            sticker_id=sticker_id,
        )
    except Exception as exc:
        _raise_sticker_error(exc)
    return FileResponse(
        path=item["path"],
        filename=item["file_name"],
        media_type=item["mime_type"],
        content_disposition_type="inline",
        headers=_IMMUTABLE_STICKER_CACHE_HEADERS,
    )


@router.post(
    "/conversations/{conversation_id}/messages/sticker",
    response_model=ChatMessageResponse,
)
async def send_chat_sticker(
    conversation_id: str,
    payload: ChatStickerSendRequest,
    db_id: str | None = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message, write_meta = await chat_api()._run_chat_write_call_with_meta(
            telegram_sticker_service.send_sticker,
            chat_service=chat_api().chat_service,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            sticker_id=payload.sticker_id,
            client_message_id=payload.client_message_id,
            reply_to_message_id=payload.reply_to_message_id,
            defer_push_notifications=True,
        )
        deferred_notifications = chat_api()._pop_deferred_chat_notifications(message)
        deferred_realtime_publish = chat_api()._pop_deferred_realtime_publish(message)
        chat_api()._schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
            deferred_notifications=deferred_notifications,
            deferred_realtime_publish=deferred_realtime_publish,
        )
        chat_api()._schedule_ai_run_for_message(
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message["id"],
            effective_database_id=db_id,
            conversation_kind=str((write_meta or {}).get("conversation_kind") or ""),
        )
        return message
    except Exception as exc:
        _raise_sticker_error(exc)
