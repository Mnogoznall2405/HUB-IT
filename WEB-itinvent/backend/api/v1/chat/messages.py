from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import asyncio
import json
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

from backend.api.deps import ensure_user_permission, get_current_database_id, require_permission
from backend.chat.schemas import (
    ChatConversationAssetsSummaryResponse,
    ChatConversationAttachmentsResponse,
    ChatMessageListResponse,
    ChatMessageResponse,
    ChatMessageSearchResponse,
    ChatReactionToggleRequest,
    ChatReactionToggleResponse,
    ChatShareableTasksResponse,
    ChatThreadBootstrapResponse,
    ChatThreadHydrateResponse,
    EditMessageRequest,
    ForwardMessageRequest,
    MarkReadRequest,
    SendMessageRequest,
    TaskShareMessageRequest,
)
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_TASKS_READ

router = APIRouter()

@router.delete("/conversations/{conversation_id}/messages/{message_id}", response_model=ChatMessageResponse)
async def delete_chat_message(
    conversation_id: str,
    message_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message = await chat_api()._run_chat_call(
            chat_api().chat_service.delete_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
        )
        system_message_id = str((message or {}).pop("_system_message_id", "") or "").strip()
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_message_deleted_after_soft_delete(
                conversation_id=conversation_id,
                message_id=message_id,
            ),
            label="publish_message_deleted",
        )
        if system_message_id:
            chat_api()._schedule_chat_background_task(
                chat_api()._publish_message_created_after_send(
                    conversation_id=conversation_id,
                    message_id=system_message_id,
                ),
                label="publish_message_deleted_system_event",
            )
        return message
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/conversations/{conversation_id}/messages/{message_id}", response_model=ChatMessageResponse)
async def edit_chat_message(
    conversation_id: str,
    message_id: str,
    payload: EditMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message = await chat_api()._run_chat_call(
            chat_api().chat_service.edit_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
            body=payload.body,
            body_format=payload.body_format,
        )
        chat_api()._schedule_chat_background_task(
            chat_api()._publish_message_updated_after_edit(
                conversation_id=conversation_id,
                message_id=message_id,
            ),
            label="publish_message_updated",
        )
        return message
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages/{message_id}/reactions", response_model=ChatReactionToggleResponse)
async def toggle_chat_message_reaction(
    conversation_id: str,
    message_id: str,
    payload: ChatReactionToggleRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        result = await chat_api()._run_chat_call(
            chat_api().chat_service.toggle_reaction,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
            emoji=payload.emoji,
        )
        member_user_ids = await chat_api()._run_chat_call(
            chat_api().chat_service.get_conversation_member_ids,
            conversation_id=conversation_id,
        )
        async def _publish_reaction(member_user_id: int) -> None:
            await chat_api().chat_realtime.publish_conversation_event(
                user_id=int(member_user_id),
                conversation_id=conversation_id,
                event_type="chat.message.reaction",
                payload=result,
            )
        await asyncio.gather(*[_publish_reaction(uid) for uid in (member_user_ids or [])])
        return result
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/messages", response_model=ChatMessageListResponse)
async def get_chat_messages(
    request: Request,
    conversation_id: str,
    before_message_id: Optional[str] = Query(None),
    after_message_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        from backend.chat.latency_profile import set_active_endpoint

        set_active_endpoint("GET /chat/messages")
        response, meta = await chat_api()._run_chat_read_call_with_meta(
            chat_api().chat_service.get_messages,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            before_message_id=before_message_id,
            after_message_id=after_message_id,
            limit=int(limit),
        )
        try:
            from backend.chat.response_profile import maybe_profile_read_response

            maybe_profile_read_response(
                route="messages",
                request_id=request_id,
                db_ms=float(meta.get("db_ms") or 0.0),
                handler_ms=(time.perf_counter() - started_at) * 1000.0,
                payload=response,
                items_hint=meta.get("items_count"),
            )
        except Exception:
            pass
        return response
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "messages",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=chat_api()._normalize_text(conversation_id) or None,
            limit=int(limit),
            before_message_id=chat_api()._normalize_text(before_message_id) or None,
            after_message_id=chat_api()._normalize_text(after_message_id) or None,
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
            direction=meta.get("direction"),
            cursor_invalid=int(bool(meta.get("cursor_invalid"))),
            db_ms=meta.get("db_ms"),
            executor_wait_ms=meta.get("executor_wait_ms"),
        )


@router.get("/conversations/{conversation_id}/thread-bootstrap", response_model=ChatThreadBootstrapResponse)
async def get_chat_thread_bootstrap(
    request: Request,
    conversation_id: str,
    focus_message_id: Optional[str] = Query(None),
    limit: int = Query(40, ge=1, le=100),
    lightweight: bool = Query(True),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        from backend.chat.latency_profile import set_active_endpoint

        set_active_endpoint("GET /chat/thread-bootstrap")
        response, meta = await chat_api()._run_chat_read_call_with_meta(
            chat_api().chat_service.get_thread_bootstrap,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            focus_message_id=focus_message_id,
            limit=int(limit),
            lightweight=bool(lightweight),
        )
        try:
            from backend.chat.response_profile import maybe_profile_read_response

            maybe_profile_read_response(
                route="thread_bootstrap",
                request_id=request_id,
                db_ms=float(meta.get("db_ms") or 0.0),
                handler_ms=(time.perf_counter() - started_at) * 1000.0,
                payload=response,
                items_hint=meta.get("items_count"),
            )
        except Exception:
            pass
        return response
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "thread_bootstrap",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=chat_api()._normalize_text(conversation_id) or None,
            focus_message_id=chat_api()._normalize_text(focus_message_id) or None,
            limit=int(limit),
            lightweight=int(bool(lightweight)),
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
            initial_anchor_mode=meta.get("initial_anchor_mode"),
            db_ms=meta.get("db_ms"),
            executor_wait_ms=meta.get("executor_wait_ms"),
        )


@router.get("/conversations/{conversation_id}/messages/hydrate", response_model=ChatThreadHydrateResponse)
async def hydrate_chat_thread_messages(
    request: Request,
    conversation_id: str,
    message_ids: str = Query("", description="Comma-separated message ids, max 50"),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    parsed_ids = [
        chat_api()._normalize_text(item)
        for item in str(message_ids or "").split(",")
        if chat_api()._normalize_text(item)
    ]
    meta: dict[str, Any] = {}
    try:
        response, meta = await chat_api()._run_chat_read_call_with_meta(
            chat_api().chat_service.hydrate_thread_messages,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_ids=parsed_ids,
        )
        return response
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "thread_hydrate",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=chat_api()._normalize_text(conversation_id) or None,
            items_count=meta.get("items_count"),
            cache_hit=int(bool(meta.get("cache_hit"))),
        )


@router.get("/conversations/{conversation_id}/messages/search", response_model=ChatMessageSearchResponse)
async def search_chat_messages(
    request: Request,
    conversation_id: str,
    q: str = Query("", min_length=0),
    limit: int = Query(20, ge=1, le=100),
    before_message_id: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        response, meta = await chat_api()._run_chat_read_call_with_meta(
            chat_api().chat_service.search_messages,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            q=q,
            limit=int(limit),
            before_message_id=before_message_id,
        )
        return response
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "search",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=chat_api()._normalize_text(conversation_id) or None,
            q_len=len(str(q or "")),
            limit=int(limit),
            before_message_id=chat_api()._normalize_text(before_message_id) or None,
            items_count=meta.get("items_count"),
        )


@router.get("/conversations/{conversation_id}/shareable-tasks", response_model=ChatShareableTasksResponse)
async def get_chat_shareable_tasks(
    conversation_id: str,
    q: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    ensure_user_permission(current_user, PERM_TASKS_READ)
    try:
        items = await chat_api()._run_chat_call(
            chat_api().chat_service.list_shareable_tasks,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            q=q,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/assets-summary", response_model=ChatConversationAssetsSummaryResponse)
async def get_chat_conversation_assets_summary(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_conversation_assets_summary,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/attachments", response_model=ChatConversationAttachmentsResponse)
async def get_chat_conversation_attachments(
    conversation_id: str,
    kind: str = Query("image", pattern="^(image|video|file|audio)$"),
    limit: int = Query(20, ge=1, le=100),
    before_attachment_id: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.list_conversation_attachments,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            kind=kind,
            limit=int(limit),
            before_attachment_id=before_attachment_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageResponse)
async def send_chat_message(
    request: Request,
    conversation_id: str,
    payload: SendMessageRequest,
    db_id: Optional[str] = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    message_id = ""
    try:
        message, write_meta = await chat_api()._run_chat_write_call_with_meta(
            chat_api().chat_service.send_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=payload.body,
            body_format=payload.body_format,
            client_message_id=payload.client_message_id,
            reply_to_message_id=payload.reply_to_message_id,
            defer_push_notifications=True,
        )
        deferred_notifications = chat_api()._pop_deferred_chat_notifications(message)
        deferred_realtime_publish = chat_api()._pop_deferred_realtime_publish(message)
        deferred_delivery_outbox = chat_api()._pop_deferred_delivery_outbox(message)
        message_id = chat_api()._normalize_text(message.get("id"))
        from backend.chat.lean_ack import apply_sender_summary_to_message

        if isinstance(message, dict):
            message = apply_sender_summary_to_message(
                message,
                user_id=int(current_user.id),
                username=getattr(current_user, "username", None),
                full_name=getattr(current_user, "full_name", None),
                role=getattr(current_user, "role", None),
                avatar_url=getattr(current_user, "avatar_url", None),
            )
        if isinstance(deferred_realtime_publish, dict):
            realtime_message = deferred_realtime_publish.get("message")
            if isinstance(realtime_message, dict):
                deferred_realtime_publish["message"] = apply_sender_summary_to_message(
                    realtime_message,
                    user_id=int(current_user.id),
                    username=getattr(current_user, "username", None),
                    full_name=getattr(current_user, "full_name", None),
                    role=getattr(current_user, "role", None),
                    avatar_url=getattr(current_user, "avatar_url", None),
                )
        # Return the saved message immediately; heavy side effects run in the background.
        chat_api()._schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
            deferred_notifications=deferred_notifications,
            deferred_realtime_publish=deferred_realtime_publish,
            deferred_delivery_outbox=deferred_delivery_outbox,
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
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "send_message",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id or None,
            body_len=len(chat_api()._normalize_text(payload.body)),
            client_message_id=chat_api()._normalize_text(payload.client_message_id) or None,
            has_reply=int(bool(chat_api()._normalize_text(payload.reply_to_message_id))),
        )


@router.post("/conversations/{conversation_id}/messages/forward", response_model=ChatMessageResponse)
async def forward_chat_message(
    conversation_id: str,
    payload: ForwardMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message, _ = await chat_api()._run_chat_call_with_meta(
            chat_api().chat_service.forward_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            source_message_id=payload.source_message_id,
            body=payload.body,
            body_format=payload.body_format,
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
        return message
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages/task-share", response_model=ChatMessageResponse)
async def send_chat_task_share(
    conversation_id: str,
    payload: TaskShareMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    ensure_user_permission(current_user, PERM_TASKS_READ)
    try:
        message, _ = await chat_api()._run_chat_call_with_meta(
            chat_api().chat_service.send_task_share,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            task_id=payload.task_id,
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
        return message
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages/files", response_model=ChatMessageResponse)
async def send_chat_files(
    request: Request,
    conversation_id: str,
    body: Optional[str] = Form(None, max_length=12000),
    reply_to_message_id: Optional[str] = Form(None),
    files_meta_json: Optional[str] = Form(None),
    files: list[UploadFile] = File(default=[]),
    db_id: Optional[str] = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    started_at = time.perf_counter()
    request_id = chat_api()._request_id_from_headers(request)
    message_id = ""
    try:
        files_meta: list[dict[str, Any]] | None = None
        normalized_files_meta_json = str(files_meta_json or "").strip()
        if normalized_files_meta_json:
            parsed_files_meta = json.loads(normalized_files_meta_json)
            if not isinstance(parsed_files_meta, list):
                raise ValueError("files_meta_json must be a JSON array")
            files_meta = [
                item if isinstance(item, dict) else {}
                for item in parsed_files_meta
            ]
        chat_api().http_logger.info(
            "chat.files_upload request_id=%s user_id=%s conversation_id=%s file_count=%d",
            request_id,
            int(current_user.id),
            conversation_id,
            len(files),
        )
        message, write_meta = await chat_api()._run_chat_call_with_meta(
            chat_api().chat_service.send_files,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=body,
            uploads=files,
            files_meta=files_meta,
            reply_to_message_id=reply_to_message_id,
            defer_push_notifications=True,
        )
        deferred_notifications = chat_api()._pop_deferred_chat_notifications(message)
        deferred_realtime_publish = chat_api()._pop_deferred_realtime_publish(message)
        message_id = chat_api()._normalize_text(message.get("id"))
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
        chat_api().http_logger.info(
            "chat.files_upload_success request_id=%s message_id=%s attachment_count=%d",
            request_id,
            message["id"],
            len(message.get("attachments", [])),
        )
        return message
    except Exception as exc:
        chat_api().http_logger.error(
            "chat.files_upload_error request_id=%s error=%s",
            request_id,
            str(exc),
            exc_info=True,
        )
        chat_api()._raise_chat_http_error(exc)
    finally:
        chat_api()._log_request_timing(
            "send_files",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id or None,
            file_count=len(files),
            body_len=len(chat_api()._normalize_text(body)),
            has_reply=int(bool(chat_api()._normalize_text(reply_to_message_id))),
        )


@router.post("/conversations/{conversation_id}/read")
async def mark_chat_conversation_read(
    conversation_id: str,
    payload: MarkReadRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    from backend.chat.latency_profile import StageClock, profile_trace

    handler_enter = time.perf_counter()
    asgi_received = float(getattr(request.state, "chat_asgi_received_at", 0.0) or 0.0)
    middleware_enter = float(getattr(request.state, "chat_middleware_enter_at", 0.0) or 0.0)
    clock = StageClock(trace_id="mark_read", kind="http_mark_read")
    if asgi_received > 0:
        clock.stages_ms["handler_queue_wait_ms"] = max(0.0, (handler_enter - asgi_received) * 1000.0)
    if middleware_enter > 0 and asgi_received > 0:
        clock.stages_ms["middleware_ms"] = max(0.0, (middleware_enter - asgi_received) * 1000.0)
    clock.mark("handler_enter")
    try:
        executor_submit_at = time.perf_counter()
        clock.stages_ms["pre_executor_ms"] = (executor_submit_at - handler_enter) * 1000.0
        read_payload = await chat_api()._run_chat_mark_read_call(
            chat_api().chat_service.mark_read,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=payload.message_id,
        )
        clock.stages_ms["executor_and_service_ms"] = (time.perf_counter() - executor_submit_at) * 1000.0
        changed = bool((read_payload or {}).get("changed"))
        if changed:
            chat_api()._schedule_chat_background_task(
                chat_api()._publish_message_read_after_mark_read(
                    conversation_id=conversation_id,
                    message_id=payload.message_id,
                    reader_user_id=int(current_user.id),
                    read_at=read_payload.get("read_at"),
                ),
                label="publish_message_read",
            )
        if bool((read_payload or {}).get("clear_hub_notifications")):
            chat_api()._schedule_chat_background_task(
                chat_api()._clear_hub_notifications_after_mark_read(
                    conversation_id=conversation_id,
                    reader_user_id=int(current_user.id),
                ),
                label="clear_hub_notifications_after_mark_read",
            )
        # Internal flags must not leak to HTTP clients.
        if isinstance(read_payload, dict):
            read_payload.pop("changed", None)
            read_payload.pop("clear_hub_notifications", None)
        clock.mark("response_created")
        clock.span("response_create_ms", "handler_enter", "response_created")
        return read_payload
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    finally:
        try:
            clock.emit(stage="mark_read_http_breakdown")
            profile_trace(
                "mark_read",
                "mark_read",
                clock.total_ms(),
                conversation_id=str(conversation_id or "")[:64],
                user_id=int(getattr(current_user, "id", 0) or 0),
                handler_queue_wait_ms=clock.stages_ms.get("handler_queue_wait_ms"),
                executor_and_service_ms=clock.stages_ms.get("executor_and_service_ms"),
            )
        except Exception:
            pass
