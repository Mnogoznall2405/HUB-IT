from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import asyncio
import io
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.api.deps import require_permission
from backend.chat.schemas import (
    ChatConversationDetailResponse,
    ChatConversationListResponse,
    ChatConversationMembersRequest,
    ChatConversationSummary,
    ChatMemberRoleUpdateRequest,
    ChatOwnershipTransferRequest,
    ChatUnreadSummaryResponse,
    DirectConversationRequest,
    GroupConversationRequest,
    UpdateConversationProfileRequest,
    UpdateConversationSettingsRequest,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

router = APIRouter()

@router.get("/conversations", response_model=ChatConversationListResponse)
async def get_chat_conversations(
    request: Request,
    q: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    cursor: str = Query("", max_length=512),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        payload, meta = await chat_api()._run_chat_call_with_meta(
            chat_api().chat_service.list_conversations,
            current_user_id=int(current_user.id),
            q=q,
            limit=int(limit),
            cursor=cursor,
        )
        return payload
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "conversations",
            request_id,
            started_at,
            user_id=int(current_user.id),
            q_len=len(str(q or "")),
            limit=int(limit),
            cursor_len=len(str(cursor or "")),
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
        )


@router.get("/unread-summary", response_model=ChatUnreadSummaryResponse)
async def get_chat_unread_summary(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_unread_summary,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/conversations/{conversation_id}/settings", response_model=ChatConversationSummary)
async def update_chat_conversation_settings(
    conversation_id: str,
    payload: UpdateConversationSettingsRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_conversation_settings,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            is_pinned=payload.is_pinned,
            is_muted=payload.is_muted,
            is_archived=payload.is_archived,
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="settings",
        )
        await chat_api()._publish_unread_summary(int(current_user.id))
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/conversations/{conversation_id}")
async def delete_chat_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        deleted = await chat_api()._run_chat_call(
            chat_api().chat_service.delete_conversation,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
        await chat_api()._publish_deleted_conversation(
            conversation_id=deleted["conversation_id"],
            member_user_ids=deleted["member_user_ids"],
            reason="deleted",
        )
        return {
            "ok": True,
            "conversation_id": deleted["conversation_id"],
        }
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/direct", response_model=ChatConversationSummary)
async def create_direct_conversation(
    payload: DirectConversationRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.create_direct_conversation,
            current_user_id=int(current_user.id),
            peer_user_id=int(payload.peer_user_id),
        )
        member_user_ids = await chat_api()._run_chat_call(
            chat_api().chat_service.get_conversation_member_ids,
            conversation_id=conversation["id"],
        )
        for member_user_id in member_user_ids:
            await chat_api()._publish_conversation_updated(
                conversation_id=conversation["id"],
                user_id=int(member_user_id),
                reason="created",
            )
            await chat_api()._publish_unread_summary(int(member_user_id))
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/notes", response_model=ChatConversationSummary)
async def ensure_notes_conversation(
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.get_or_create_notes_conversation,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="created",
        )
        await chat_api()._publish_unread_summary(int(current_user.id))
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/group", response_model=ChatConversationSummary)
async def create_group_conversation(
    payload: GroupConversationRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.create_group_conversation,
            current_user_id=int(current_user.id),
            title=payload.title,
            member_user_ids=payload.member_user_ids,
        )
        member_user_ids = await chat_api()._run_chat_call(
            chat_api().chat_service.get_conversation_member_ids,
            conversation_id=conversation["id"],
        )
        for member_user_id in member_user_ids:
            await chat_api()._publish_conversation_updated(
                conversation_id=conversation["id"],
                user_id=int(member_user_id),
                reason="created",
            )
            await chat_api()._publish_unread_summary(int(member_user_id))
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/members", response_model=ChatConversationDetailResponse)
async def add_chat_group_members(
    conversation_id: str,
    payload: ChatConversationMembersRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.add_group_members,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            member_user_ids=payload.member_user_ids,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_added",
            ),
            label="publish_group_members_added",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/conversations/{conversation_id}/members/{user_id}", response_model=ChatConversationDetailResponse)
async def remove_chat_group_member(
    conversation_id: str,
    user_id: int,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.remove_group_member,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            target_user_id=int(user_id),
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_removed",
                removed_user_ids=[int(user_id)],
            ),
            label="publish_group_member_removed",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/conversations/{conversation_id}/members/{user_id}/role", response_model=ChatConversationDetailResponse)
async def update_chat_group_member_role(
    conversation_id: str,
    user_id: int,
    payload: ChatMemberRoleUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_group_member_role,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            target_user_id=int(user_id),
            member_role=payload.member_role,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_role_updated",
            ),
            label="publish_group_member_role_updated",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/ownership", response_model=ChatConversationDetailResponse)
async def transfer_chat_group_ownership(
    conversation_id: str,
    payload: ChatOwnershipTransferRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.transfer_group_ownership,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            owner_user_id=int(payload.owner_user_id),
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="ownership_transferred",
            ),
            label="publish_group_ownership_transferred",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/leave")
async def leave_chat_group(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        payload = await chat_api()._run_chat_call(
            chat_api().chat_service.leave_group,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_left",
                removed_user_ids=[int(current_user.id)],
            ),
            label="publish_group_member_left",
        )
        return payload
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/conversations/{conversation_id}/profile", response_model=ChatConversationDetailResponse)
async def update_chat_group_profile(
    conversation_id: str,
    payload: UpdateConversationProfileRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_group_profile,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            title=payload.title,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="profile_updated",
            ),
            label="publish_group_profile_updated",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/avatar", response_model=ChatConversationDetailResponse)
async def upload_chat_group_avatar(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    from PIL import Image as PilImage
    import io
    from pathlib import Path

    content_type = str(file.content_type or "").strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be smaller than 5 MB")

    def _save_avatar() -> str:
        from backend.services.hub_service import hub_service
        avatars_dir = Path(hub_service.data_dir) / "group_avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in conversation_id)
        dest_path = avatars_dir / f"{safe_id}.jpg"
        with PilImage.open(io.BytesIO(raw)) as img:
            img = img.convert("RGB")
            w, h = img.size
            min_dim = min(w, h)
            left = (w - min_dim) // 2
            top = (h - min_dim) // 2
            img = img.crop((left, top, left + min_dim, top + min_dim))
            img = img.resize((256, 256), PilImage.LANCZOS)
            img.save(str(dest_path), format="JPEG", quality=88, optimize=True)
        return f"/api/v1/chat/group-avatars/{safe_id}.jpg?v={int(time.time())}"

    try:
        avatar_url = await run_in_threadpool(_save_avatar)
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_group_avatar,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            avatar_url=avatar_url,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="profile_updated",
            ),
            label="publish_group_avatar_updated",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/group-avatars/{filename}")
async def serve_group_avatar(
    filename: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        avatar_path = await chat_api()._run_chat_call(
            chat_api().chat_service.get_group_avatar_file_path,
            current_user_id=int(current_user.id),
            filename=filename,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    return FileResponse(avatar_path, media_type="image/jpeg")


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetailResponse)
async def get_chat_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_conversation,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


