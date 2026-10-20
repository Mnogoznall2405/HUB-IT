from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import asyncio
import io
import os
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.api.deps import get_current_admin_user, require_permission
from backend.chat.schemas import (
    ChatConfigResponse,
    ChatConversationDetailResponse,
    ChatConversationListResponse,
    ChatConversationMembersRequest,
    ChatConversationSummary,
    ChatLeaveGroupRequest,
    ChatMemberRestrictionRequest,
    ChatMemberRoleUpdateRequest,
    ChatAutoOwnerRequest,
    ChatOwnershipTransferRequest,
    ChatUnreadSummaryResponse,
    DirectConversationRequest,
    GroupConversationRequest,
    ChatPinnedMessageRequest,
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
        from backend.chat.latency_profile import set_active_endpoint

        set_active_endpoint("GET /chat/conversations")
        payload, meta = await chat_api()._run_chat_read_call_with_meta(
            chat_api().chat_service.list_conversations,
            current_user_id=int(current_user.id),
            q=q,
            limit=int(limit),
            cursor=cursor,
        )
        try:
            from backend.chat.response_profile import maybe_profile_read_response

            maybe_profile_read_response(
                route="conversations",
                request_id=request_id,
                db_ms=float(meta.get("db_ms") or 0.0),
                handler_ms=(time.perf_counter() - started_at) * 1000.0,
                payload=payload,
                items_hint=meta.get("items_count"),
            )
        except Exception:
            pass
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
            db_ms=meta.get("db_ms"),
            executor_wait_ms=meta.get("executor_wait_ms"),
        )


@router.get("/config", response_model=ChatConfigResponse)
async def get_chat_config(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    from backend.chat.scheduled_messages import scheduled_messages_enabled

    return {
        "group_max_members": int(chat_api().chat_service.group_max_members),
        "scheduled_messages_enabled": bool(scheduled_messages_enabled()),
    }


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
            muted_until=payload.muted_until,
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


@router.put("/conversations/{conversation_id}/pinned-message", response_model=ChatConversationSummary)
async def set_chat_pinned_message(
    conversation_id: str,
    payload: ChatPinnedMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.set_pinned_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=payload.message_id,
        )
        if str(conversation.get("kind") or "").strip().lower() == "group":
            # Every member sees the pin change, not only the actor.
            await chat_api()._publish_group_conversation_change(
                conversation_id=conversation["id"],
                reason="pinned_message",
            )
        else:
            await chat_api()._publish_conversation_updated(
                conversation_id=conversation["id"],
                user_id=int(current_user.id),
                reason="pinned_message",
            )
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


@router.put("/conversations/{conversation_id}/members/{user_id}/restriction", response_model=ChatConversationDetailResponse)
async def restrict_chat_group_member(
    conversation_id: str,
    user_id: int,
    payload: ChatMemberRestrictionRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.restrict_group_member,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            target_user_id=int(user_id),
            duration_seconds=payload.duration_seconds,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_restricted",
            ),
            label="publish_group_member_restricted",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/conversations/{conversation_id}/members/{user_id}/restriction", response_model=ChatConversationDetailResponse)
async def lift_chat_group_member_restriction(
    conversation_id: str,
    user_id: int,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.lift_group_member_restriction,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            target_user_id=int(user_id),
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="member_restriction_lifted",
            ),
            label="publish_group_member_restriction_lifted",
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
    request_payload: Optional[ChatLeaveGroupRequest] = None,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        payload = await chat_api()._run_chat_call(
            chat_api().chat_service.leave_group,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            successor_user_id=getattr(request_payload, "successor_user_id", None),
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


@router.post("/conversations/{conversation_id}/invite-link")
async def create_chat_group_invite_link(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    """Create (and thereby replace) the group's invite link; the token is shown only here."""
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.create_group_invite,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/conversations/{conversation_id}/invite-link")
async def revoke_chat_group_invite_link(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.revoke_group_invites,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/activity")
async def list_chat_group_activity(
    conversation_id: str,
    limit: int = 50,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    """Journal of owner and moderator actions; visible to the group's managers only."""
    try:
        items = await chat_api()._run_chat_call(
            chat_api().chat_service.list_group_activity,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/invite-links/{token}")
async def preview_chat_group_invite_link(
    token: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.preview_group_invite,
            current_user_id=int(current_user.id),
            token=token,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/invite-links/{token}/join")
async def join_chat_group_by_invite_link(
    token: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        result = await chat_api()._run_chat_call(
            chat_api().chat_service.join_group_by_invite,
            current_user_id=int(current_user.id),
            token=token,
        )
        if result.get("joined"):
            chat_api()._schedule_chat_background_task(
                chat_api()._publish_group_conversation_change(
                    conversation_id=str((result.get("conversation") or {}).get("id") or ""),
                    reason="member_added",
                ),
                label="publish_group_member_joined_by_link",
            )
        return result
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/admin/groups/ownerless")
async def admin_list_ownerless_groups(
    limit: int = Query(100, ge=1, le=200),
    admin_user: User = Depends(get_current_admin_user),
):
    """Groups whose owner is deactivated or missing (portal administrators only; no content)."""
    try:
        items = await chat_api()._run_chat_call(
            chat_api().chat_service.admin_list_ownerless_groups,
            actor_user_id=int(admin_user.id),
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/admin/groups/{conversation_id}")
async def admin_get_group_structure(
    conversation_id: str,
    admin_user: User = Depends(get_current_admin_user),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.admin_get_group_structure,
            actor_user_id=int(admin_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/admin/groups/{conversation_id}/audit")
async def admin_list_group_audit(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=200),
    admin_user: User = Depends(get_current_admin_user),
):
    try:
        items = await chat_api()._run_chat_call(
            chat_api().chat_service.admin_list_group_audit,
            actor_user_id=int(admin_user.id),
            conversation_id=conversation_id,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/admin/groups/auto-owner")
async def admin_auto_assign_group_owners(
    payload: ChatAutoOwnerRequest,
    admin_user: User = Depends(get_current_admin_user),
):
    try:
        result = await chat_api()._run_chat_call(
            chat_api().chat_service.admin_auto_assign_group_owners,
            actor_user_id=int(admin_user.id),
            dry_run=bool(payload.dry_run),
            limit=int(payload.limit),
        )
        if not payload.dry_run:
            for plan in result.get("planned") or []:
                chat_api()._schedule_chat_background_task(
                    chat_api()._publish_group_conversation_change(
                        conversation_id=str(plan["conversation_id"]),
                        reason="ownership_transferred",
                    ),
                    label="publish_group_admin_auto_owner",
                )
        return result
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/admin/groups/{conversation_id}/owner")
async def admin_assign_group_owner(
    conversation_id: str,
    payload: ChatOwnershipTransferRequest,
    admin_user: User = Depends(get_current_admin_user),
):
    try:
        result = await chat_api()._run_chat_call(
            chat_api().chat_service.admin_assign_group_owner,
            actor_user_id=int(admin_user.id),
            conversation_id=conversation_id,
            owner_user_id=int(payload.owner_user_id),
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="ownership_transferred",
            ),
            label="publish_group_admin_owner_assigned",
        )
        return result
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/admin/groups/{conversation_id}/members/{target_user_id}")
async def admin_remove_group_member(
    conversation_id: str,
    target_user_id: int,
    admin_user: User = Depends(get_current_admin_user),
):
    try:
        result = await chat_api()._run_chat_call(
            chat_api().chat_service.admin_remove_group_member,
            actor_user_id=int(admin_user.id),
            conversation_id=conversation_id,
            target_user_id=int(target_user_id),
        )
        if result.get("removed"):
            chat_api()._schedule_chat_background_task(
                chat_api()._publish_group_conversation_change(
                    conversation_id=conversation_id,
                    reason="member_removed",
                    removed_user_ids=[int(target_user_id)],
                ),
                label="publish_group_admin_member_removed",
            )
        return result
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
            description=payload.description,
            posting_policy=payload.posting_policy,
            slow_mode_seconds=payload.slow_mode_seconds,
            members_send_files=payload.members_send_files,
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


def _group_avatar_stem(conversation_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(conversation_id or ""))


@router.post("/conversations/{conversation_id}/avatar", response_model=ChatConversationDetailResponse)
async def upload_chat_group_avatar(
    conversation_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    from pathlib import Path

    from PIL import Image as PilImage

    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be smaller than 5 MB")

    def _encode_avatar() -> Optional[bytes]:
        # PIL decides whether the payload is an image: browsers send an empty or
        # application/octet-stream content type for some formats (HEIC, Windows files).
        try:
            with PilImage.open(io.BytesIO(raw)) as img:
                img = img.convert("RGB")
                w, h = img.size
                min_dim = min(w, h)
                left = (w - min_dim) // 2
                top = (h - min_dim) // 2
                img = img.crop((left, top, left + min_dim, top + min_dim))
                img = img.resize((256, 256), PilImage.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=88, optimize=True)
                return buf.getvalue()
        except Exception:
            return None

    jpeg_bytes = await run_in_threadpool(_encode_avatar)
    if jpeg_bytes is None:
        raise HTTPException(status_code=400, detail="Не удалось прочитать изображение")

    def _stage_avatar() -> tuple[Path, Path]:
        # Stage to a unique temp file: the live avatar is replaced only after the owner check passes.
        from backend.chat.service import hub_service

        avatars_dir = Path(hub_service.data_dir) / "group_avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = avatars_dir / f"{safe_id}.{uuid.uuid4().hex}.tmp"
        tmp_path.write_bytes(jpeg_bytes)
        return tmp_path, avatars_dir / f"{safe_id}.jpg"

    safe_id = _group_avatar_stem(conversation_id)
    tmp_path, final_path = await run_in_threadpool(_stage_avatar)
    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_group_avatar,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            avatar_url=f"/api/v1/chat/group-avatars/{safe_id}.jpg?v={int(time.time())}",
        )
        await run_in_threadpool(os.replace, tmp_path, final_path)
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="profile_updated",
            ),
            label="publish_group_avatar_updated",
        )
        return conversation
    except Exception as exc:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        chat_api()._raise_chat_http_error(exc)


@router.delete("/conversations/{conversation_id}/avatar", response_model=ChatConversationDetailResponse)
async def delete_chat_group_avatar(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    from pathlib import Path

    def _remove_avatar_file() -> None:
        from backend.chat.service import hub_service

        path = Path(hub_service.data_dir) / "group_avatars" / f"{_group_avatar_stem(conversation_id)}.jpg"
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass  # best-effort: the DB reference is already cleared, an orphan file is harmless

    try:
        conversation = await chat_api()._run_chat_call(
            chat_api().chat_service.update_group_avatar,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            avatar_url=None,
        )
        await run_in_threadpool(_remove_avatar_file)
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_group_conversation_change(
                conversation_id=conversation_id,
                reason="profile_updated",
            ),
            label="publish_group_avatar_cleared",
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


