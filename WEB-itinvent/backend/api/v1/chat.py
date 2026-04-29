"""Chat API backed by PostgreSQL and current web-users."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from starlette.websockets import WebSocketState

from backend.api.deps import ensure_user_permission, get_current_database_id, get_current_user_from_websocket, require_permission
from backend.ai_chat.schemas import AiBotListResponse, AiConversationStatusResponse
from backend.chat.db import ChatConfigurationError
from backend.chat.realtime import chat_realtime
from backend.chat.realtime_side_effects import publish_message_created_after_send as publish_message_created_after_send_side_effects
from backend.chat.schemas import (
    ChatConversationAssetsSummaryResponse,
    ChatConversationAttachmentsResponse,
    ChatConversationDetailResponse,
    ChatConversationListResponse,
    ChatConversationSummary,
    ChatHealthResponse,
    ChatMessageSearchResponse,
    ChatThreadBootstrapResponse,
    ChatUnreadSummaryResponse,
    ChatPushConfigResponse,
    ChatPushSubscriptionDeleteRequest,
    ChatPushSubscriptionRequest,
    ChatPushSubscriptionStatusResponse,
    ChatUploadSessionCancelResponse,
    ChatUploadSessionChunkResponse,
    ChatUploadSessionCreateRequest,
    ChatUploadSessionResponse,
    ChatMessageReadsResponse,
    ChatMessageListResponse,
    ChatMessageResponse,
    ChatShareableTasksResponse,
    ChatUsersResponse,
    DirectConversationRequest,
    ForwardMessageRequest,
    GroupConversationRequest,
    MarkReadRequest,
    SendMessageRequest,
    TaskShareMessageRequest,
    UpdateConversationSettingsRequest,
)
from backend.chat.service import chat_service
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_TASKS_READ


router = APIRouter()
logger = logging.getLogger("backend.chat.websocket")
http_logger = logging.getLogger("backend.chat.api")
logger.setLevel(logging.INFO)
http_logger.setLevel(logging.INFO)
runtime_logger = logging.getLogger("uvicorn.error")


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = int(raw)
    except Exception:
        value = int(default)
    return max(minimum, min(maximum, value))


CHAT_WS_COMMANDS_PER_SEC = _env_int("CHAT_WS_COMMANDS_PER_SEC", 20, 1, 1000)
CHAT_WS_COMMAND_BURST = _env_int("CHAT_WS_COMMAND_BURST", 40, 1, 5000)
CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS = _env_int("CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS", 3, 1, 20)
CHAT_WS_RATE_LIMIT_RETRY_AFTER_MS = 1000


class _ChatWsCommandRateLimiter:
    def __init__(self, *, rate_per_sec: int, burst: int) -> None:
        self.rate_per_sec = max(1.0, float(rate_per_sec))
        self.capacity = max(1.0, float(burst))
        self.tokens = self.capacity
        self.updated_at = time.monotonic()
        self.violations = 0

    def allow(self) -> tuple[bool, int]:
        now = time.monotonic()
        elapsed = max(0.0, now - self.updated_at)
        self.updated_at = now
        self.tokens = min(self.capacity, self.tokens + (elapsed * self.rate_per_sec))
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True, 0
        self.violations += 1
        missing = max(0.0, 1.0 - self.tokens)
        retry_after_ms = max(CHAT_WS_RATE_LIMIT_RETRY_AFTER_MS, int((missing / self.rate_per_sec) * 1000.0))
        return False, retry_after_ms


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _request_id_from_headers(request: Optional[Request]) -> str:
    if request is None:
        return "-"
    return _normalize_text(request.headers.get("X-Client-Request-ID"), "-")


def _log_request_timing(route_name: str, request_id: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"chat.{route_name} request_id={request_id} took_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    http_logger.info(message)
    runtime_logger.info(message)


def _log_ws_command_timing(command_name: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"chat.ws.{command_name} ack_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    logger.info(message)
    runtime_logger.info(message)


def _ws_is_connected(websocket: WebSocket) -> bool:
    return (
        websocket.client_state == WebSocketState.CONNECTED
        and websocket.application_state == WebSocketState.CONNECTED
    )


def _raise_chat_http_error(exc: Exception) -> None:
    if isinstance(exc, ChatConfigurationError):
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, LookupError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _ws_error_code(exc: Exception) -> int:
    if isinstance(exc, HTTPException):
        if int(exc.status_code) == 401:
            return 4401
        if int(exc.status_code) == 403:
            return 4403
        if int(exc.status_code) == 404:
            return 4404
        if int(exc.status_code) == 400:
            return 4400
        if int(exc.status_code) == 503:
            return 4503
        return 1011
    if isinstance(exc, PermissionError):
        return 4403
    if isinstance(exc, LookupError):
        return 4404
    if isinstance(exc, ValueError):
        return 4400
    if isinstance(exc, ChatConfigurationError):
        return 4503
    return 1011


async def _run_chat_call(func, /, *args, **kwargs):
    # chat_service still uses sync DB sessions, so every call must stay off the event loop.
    return await run_in_threadpool(func, *args, **kwargs)


async def _run_chat_call_with_meta(func, /, *args, **kwargs) -> tuple[Any, dict[str, Any]]:
    def _invoke():
        try:
            result = func(*args, **kwargs)
        except Exception:
            chat_service.consume_request_meta()
            raise
        return result, chat_service.consume_request_meta()

    return await run_in_threadpool(_invoke)


def _log_chat_background_task_failure(label: str, task: asyncio.Task[Any]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        return
    except Exception:
        logger.exception("Chat background task failed: %s", label)


def _schedule_chat_background_task(coro, *, label: str) -> asyncio.Task[Any]:
    task = asyncio.create_task(coro, name=f"chat:{label}")
    task.add_done_callback(
        lambda finished_task, task_label=label: _log_chat_background_task_failure(task_label, finished_task)
    )
    return task


def _schedule_chat_message_side_effects(
    *,
    conversation_id: str,
    message_id: str,
) -> None:
    _schedule_chat_background_task(
        publish_message_created_after_send_side_effects(
            conversation_id=conversation_id,
            message_id=message_id,
        ),
        label="publish_message_created",
    )


def _schedule_ai_run_for_message(
    *,
    current_user_id: int,
    conversation_id: str,
    message_id: str,
    effective_database_id: str | None = None,
) -> None:
    _schedule_chat_background_task(
        _queue_ai_run_for_message(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            message_id=message_id,
            effective_database_id=effective_database_id,
        ),
        label="queue_ai_run",
    )


async def _publish_unread_summary(user_id: int) -> None:
    payload = await _run_chat_call(
        chat_service.get_unread_summary,
        current_user_id=int(user_id),
    )
    await chat_realtime.publish_inbox_event(
        user_id=int(user_id),
        event_type="chat.unread.summary",
        payload=payload,
    )


async def _queue_ai_run_for_message(
    *,
    current_user_id: int,
    conversation_id: str,
    message_id: str,
    effective_database_id: str | None = None,
) -> None:
    from backend.ai_chat.service import ai_chat_service

    await _run_chat_call(
        ai_chat_service.queue_run_for_message,
        current_user_id=int(current_user_id),
        conversation_id=conversation_id,
        trigger_message_id=message_id,
        effective_database_id=effective_database_id,
    )


async def _get_unread_summaries(user_ids: list[int]) -> dict[int, dict]:
    normalized_user_ids = sorted({
        int(item)
        for item in list(user_ids or [])
        if int(item) > 0
    })
    if not normalized_user_ids:
        return {}
    return await _run_chat_call(
        chat_service.get_unread_summaries,
        user_ids=normalized_user_ids,
    )


async def _publish_conversation_updated(
    *,
    conversation_id: str,
    user_id: int,
    reason: str,
) -> None:
    payload = await _run_chat_call(
        chat_service.get_conversation_summary,
        current_user_id=int(user_id),
        conversation_id=conversation_id,
    )
    await chat_realtime.publish_inbox_event(
        user_id=int(user_id),
        event_type="chat.conversation.updated",
        conversation_id=conversation_id,
        payload={
            "conversation": payload,
            "reason": str(reason or "").strip() or "updated",
        },
    )


async def _get_conversation_updates_for_users(
    *,
    conversation_id: str,
    user_ids: list[int],
    reason: str,
) -> dict[int, dict]:
    normalized_user_ids = sorted({
        int(item)
        for item in list(user_ids or [])
        if int(item) > 0
    })
    if not normalized_user_ids:
        return {}
    conversation_payloads = await _run_chat_call(
        chat_service.get_conversation_summaries_for_users,
        conversation_id=conversation_id,
        user_ids=normalized_user_ids,
    )
    normalized_reason = str(reason or "").strip() or "updated"
    return {
        int(user_id): {
            "conversation": payload,
            "reason": normalized_reason,
        }
        for user_id, payload in dict(conversation_payloads or {}).items()
        if int(user_id) > 0 and isinstance(payload, dict)
    }


async def _publish_message_created(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    # Batch fetch message for all members (1 DB query instead of N)
    messages_by_user = await _run_chat_call(
        chat_service.get_messages_for_users,
        message_id=message_id,
        user_ids=member_ids,
    )
    conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _get_conversation_updates_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
            reason="message_created",
        ),
        _get_unread_summaries(member_ids),
    )

    async def _publish_for_member(member_user_id: int, payload: dict) -> None:
        # Inbox subscribers need the same message-created event so global chat
        # notifications can work without an active conversation subscription.
        await chat_realtime.publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.message.created",
            conversation_id=conversation_id,
            payload=payload,
        )
        await chat_realtime.publish_conversation_event(
            user_id=int(member_user_id),
            conversation_id=conversation_id,
            event_type="chat.message.created",
            payload=payload,
        )
        if (conversation_payload := conversation_updates_by_user.get(int(member_user_id))) is not None:
            await chat_realtime.publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.conversation.updated",
                conversation_id=conversation_id,
                payload=conversation_payload,
            )
        if (unread_payload := unread_summaries_by_user.get(int(member_user_id))) is not None:
            await chat_realtime.publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    publish_tasks = [
        _publish_for_member(int(member_user_id), payload)
        for member_user_id in member_ids
        if (payload := messages_by_user.get(member_user_id)) is not None
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)


async def _publish_message_read(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
    reader_user_id: int,
    read_at: Optional[str],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    read_delta, conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _run_chat_call(
            chat_service.get_message_read_delta,
            conversation_id=conversation_id,
            message_id=message_id,
        ),
        _get_conversation_updates_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
            reason="read",
        ),
        _get_unread_summaries(member_ids),
    )

    async def _publish_for_member(member_user_id: int) -> None:
        await chat_realtime.publish_conversation_event(
            user_id=int(member_user_id),
            conversation_id=conversation_id,
            event_type="chat.message.read",
            payload={
                **dict(read_delta or {}),
                "reader_user_id": int(reader_user_id),
                "read_at": str(read_at or "").strip() or None,
            },
        )
        if (conversation_payload := conversation_updates_by_user.get(int(member_user_id))) is not None:
            await chat_realtime.publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.conversation.updated",
                conversation_id=conversation_id,
                payload=conversation_payload,
            )
        if (unread_payload := unread_summaries_by_user.get(int(member_user_id))) is not None:
            await chat_realtime.publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    publish_tasks = [
        _publish_for_member(int(member_user_id))
        for member_user_id in member_ids
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)


async def _publish_message_created_after_send(*, conversation_id: str, message_id: str) -> None:
    started_at = time.perf_counter()
    try:
        member_user_ids = await _run_chat_call(
            chat_service.get_conversation_member_ids,
            conversation_id=conversation_id,
        )
        await _publish_message_created(
            conversation_id=conversation_id,
            message_id=message_id,
            member_user_ids=member_user_ids,
        )
    finally:
        _log_request_timing(
            "publish_message_created",
            "-",
            started_at,
            conversation_id=conversation_id,
            message_id=message_id,
        )


async def _publish_message_read_after_mark_read(
    *,
    conversation_id: str,
    message_id: str,
    reader_user_id: int,
    read_at: Optional[str],
) -> None:
    started_at = time.perf_counter()
    try:
        member_user_ids = await _run_chat_call(
            chat_service.get_conversation_member_ids,
            conversation_id=conversation_id,
        )
        await _publish_message_read(
            conversation_id=conversation_id,
            message_id=message_id,
            member_user_ids=member_user_ids,
            reader_user_id=reader_user_id,
            read_at=read_at,
        )
    finally:
        _log_request_timing(
            "publish_message_read",
            "-",
            started_at,
            conversation_id=conversation_id,
            message_id=message_id,
            reader_user_id=int(reader_user_id),
        )


async def _publish_presence_updated(user_id: int) -> None:
    if int(user_id or 0) <= 0:
        return
    payload = await _run_chat_call(chat_service.get_presence, user_id=int(user_id))
    await chat_realtime.publish_presence_event(
        user_id=int(user_id),
        payload={
            "user_id": int(user_id),
            "presence": payload,
        },
    )


@router.get("/health", response_model=ChatHealthResponse)
async def get_chat_health(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    return await _run_chat_call(chat_service.get_health)


@router.get("/users", response_model=ChatUsersResponse)
async def get_chat_users(
    q: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        items = await _run_chat_call(
            chat_service.list_available_users,
            current_user_id=int(current_user.id),
            q=q,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/conversations", response_model=ChatConversationListResponse)
async def get_chat_conversations(
    request: Request,
    q: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        items, meta = await _run_chat_call_with_meta(
            chat_service.list_conversations,
            current_user_id=int(current_user.id),
            q=q,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "conversations",
            request_id,
            started_at,
            user_id=int(current_user.id),
            q_len=len(str(q or "")),
            limit=int(limit),
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
        )


@router.get("/unread-summary", response_model=ChatUnreadSummaryResponse)
async def get_chat_unread_summary(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.get_unread_summary,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/push-config", response_model=ChatPushConfigResponse)
async def get_chat_push_config(
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(chat_service.get_push_config)
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.put("/push-subscription", response_model=ChatPushSubscriptionStatusResponse)
async def upsert_chat_push_subscription(
    payload: ChatPushSubscriptionRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.upsert_push_subscription,
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
        _raise_chat_http_error(exc)


@router.delete("/push-subscription", response_model=ChatPushSubscriptionStatusResponse)
async def delete_chat_push_subscription(
    payload: ChatPushSubscriptionDeleteRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.delete_push_subscription,
            current_user_id=int(current_user.id),
            endpoint=payload.endpoint,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.patch("/conversations/{conversation_id}/settings", response_model=ChatConversationSummary)
async def update_chat_conversation_settings(
    conversation_id: str,
    payload: UpdateConversationSettingsRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await _run_chat_call(
            chat_service.update_conversation_settings,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            is_pinned=payload.is_pinned,
            is_muted=payload.is_muted,
            is_archived=payload.is_archived,
        )
        await _publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="settings",
        )
        await _publish_unread_summary(int(current_user.id))
        return conversation
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/direct", response_model=ChatConversationSummary)
async def create_direct_conversation(
    payload: DirectConversationRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await _run_chat_call(
            chat_service.create_direct_conversation,
            current_user_id=int(current_user.id),
            peer_user_id=int(payload.peer_user_id),
        )
        member_user_ids = await _run_chat_call(
            chat_service.get_conversation_member_ids,
            conversation_id=conversation["id"],
        )
        for member_user_id in member_user_ids:
            await _publish_conversation_updated(
                conversation_id=conversation["id"],
                user_id=int(member_user_id),
                reason="created",
            )
            await _publish_unread_summary(int(member_user_id))
        return conversation
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/group", response_model=ChatConversationSummary)
async def create_group_conversation(
    payload: GroupConversationRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        conversation = await _run_chat_call(
            chat_service.create_group_conversation,
            current_user_id=int(current_user.id),
            title=payload.title,
            member_user_ids=payload.member_user_ids,
        )
        member_user_ids = await _run_chat_call(
            chat_service.get_conversation_member_ids,
            conversation_id=conversation["id"],
        )
        for member_user_id in member_user_ids:
            await _publish_conversation_updated(
                conversation_id=conversation["id"],
                user_id=int(member_user_id),
                reason="created",
            )
            await _publish_unread_summary(int(member_user_id))
        return conversation
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetailResponse)
async def get_chat_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.get_conversation,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


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
    request_id = _request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        response, meta = await _run_chat_call_with_meta(
            chat_service.get_messages,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            before_message_id=before_message_id,
            after_message_id=after_message_id,
            limit=int(limit),
        )
        return response
    except Exception as exc:
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "messages",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=_normalize_text(conversation_id) or None,
            limit=int(limit),
            before_message_id=_normalize_text(before_message_id) or None,
            after_message_id=_normalize_text(after_message_id) or None,
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
            direction=meta.get("direction"),
            cursor_invalid=int(bool(meta.get("cursor_invalid"))),
        )


@router.get("/conversations/{conversation_id}/thread-bootstrap", response_model=ChatThreadBootstrapResponse)
async def get_chat_thread_bootstrap(
    request: Request,
    conversation_id: str,
    focus_message_id: Optional[str] = Query(None),
    limit: int = Query(40, ge=1, le=100),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        response, meta = await _run_chat_call_with_meta(
            chat_service.get_thread_bootstrap,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            focus_message_id=focus_message_id,
            limit=int(limit),
        )
        return response
    except Exception as exc:
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "thread_bootstrap",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=_normalize_text(conversation_id) or None,
            focus_message_id=_normalize_text(focus_message_id) or None,
            limit=int(limit),
            cache_hit=int(bool(meta.get("cache_hit"))),
            items_count=meta.get("items_count"),
            initial_anchor_mode=meta.get("initial_anchor_mode"),
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
    request_id = _request_id_from_headers(request)
    meta: dict[str, Any] = {}
    try:
        response, meta = await _run_chat_call_with_meta(
            chat_service.search_messages,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            q=q,
            limit=int(limit),
            before_message_id=before_message_id,
        )
        return response
    except Exception as exc:
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "search",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=_normalize_text(conversation_id) or None,
            q_len=len(str(q or "")),
            limit=int(limit),
            before_message_id=_normalize_text(before_message_id) or None,
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
        items = await _run_chat_call(
            chat_service.list_shareable_tasks,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            q=q,
            limit=int(limit),
        )
        return {"items": items}
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/assets-summary", response_model=ChatConversationAssetsSummaryResponse)
async def get_chat_conversation_assets_summary(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.get_conversation_assets_summary,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/attachments", response_model=ChatConversationAttachmentsResponse)
async def get_chat_conversation_attachments(
    conversation_id: str,
    kind: str = Query("image", pattern="^(image|video|file|audio)$"),
    limit: int = Query(20, ge=1, le=100),
    before_attachment_id: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.list_conversation_attachments,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            kind=kind,
            limit=int(limit),
            before_attachment_id=before_attachment_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessageResponse)
async def send_chat_message(
    request: Request,
    conversation_id: str,
    payload: SendMessageRequest,
    db_id: Optional[str] = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    message_id = ""
    try:
        message, _ = await _run_chat_call_with_meta(
            chat_service.send_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=payload.body,
            body_format=payload.body_format,
            client_message_id=payload.client_message_id,
            reply_to_message_id=payload.reply_to_message_id,
            defer_push_notifications=True,
        )
        message_id = _normalize_text(message.get("id"))
        # Return the saved message immediately; heavy side effects run in the background.
        _schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
        )
        _schedule_ai_run_for_message(
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message["id"],
            effective_database_id=db_id,
        )
        return message
    except Exception as exc:
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "send_message",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id or None,
            body_len=len(_normalize_text(payload.body)),
            client_message_id=_normalize_text(payload.client_message_id) or None,
            has_reply=int(bool(_normalize_text(payload.reply_to_message_id))),
        )


@router.post("/conversations/{conversation_id}/messages/forward", response_model=ChatMessageResponse)
async def forward_chat_message(
    conversation_id: str,
    payload: ForwardMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message, _ = await _run_chat_call_with_meta(
            chat_service.forward_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            source_message_id=payload.source_message_id,
            body=payload.body,
            body_format=payload.body_format,
            reply_to_message_id=payload.reply_to_message_id,
            defer_push_notifications=True,
        )
        _schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
        )
        return message
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/messages/task-share", response_model=ChatMessageResponse)
async def send_chat_task_share(
    conversation_id: str,
    payload: TaskShareMessageRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    ensure_user_permission(current_user, PERM_TASKS_READ)
    try:
        message, _ = await _run_chat_call_with_meta(
            chat_service.send_task_share,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            task_id=payload.task_id,
            reply_to_message_id=payload.reply_to_message_id,
            defer_push_notifications=True,
        )
        _schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
        )
        return message
    except Exception as exc:
        _raise_chat_http_error(exc)


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
    request_id = _request_id_from_headers(request)
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
        http_logger.info(
            "chat.files_upload request_id=%s user_id=%s conversation_id=%s file_count=%d",
            request_id,
            int(current_user.id),
            conversation_id,
            len(files),
        )
        message, _ = await _run_chat_call_with_meta(
            chat_service.send_files,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=body,
            uploads=files,
            files_meta=files_meta,
            reply_to_message_id=reply_to_message_id,
            defer_push_notifications=True,
        )
        message_id = _normalize_text(message.get("id"))
        _schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
        )
        _schedule_ai_run_for_message(
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message["id"],
            effective_database_id=db_id,
        )
        http_logger.info(
            "chat.files_upload_success request_id=%s message_id=%s attachment_count=%d",
            request_id,
            message["id"],
            len(message.get("attachments", [])),
        )
        return message
    except Exception as exc:
        http_logger.error(
            "chat.files_upload_error request_id=%s error=%s",
            request_id,
            str(exc),
            exc_info=True,
        )
        _raise_chat_http_error(exc)
    finally:
        _log_request_timing(
            "send_files",
            request_id,
            started_at,
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id or None,
            file_count=len(files),
            body_len=len(_normalize_text(body)),
            has_reply=int(bool(_normalize_text(reply_to_message_id))),
        )


@router.get("/ai/bots", response_model=AiBotListResponse)
async def list_ai_bots(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await _run_chat_call(
        ai_chat_service.list_bots,
        current_user_id=int(current_user.id),
    )


@router.post("/ai/bots/{bot_id}/open", response_model=ChatConversationSummary)
async def open_ai_bot_conversation(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await _run_chat_call(
        ai_chat_service.open_bot_conversation,
        bot_id=bot_id,
        current_user_id=int(current_user.id),
    )


@router.get("/conversations/{conversation_id}/ai-status", response_model=AiConversationStatusResponse)
async def get_conversation_ai_status(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    ensure_user_permission(current_user, PERM_CHAT_AI_USE)
    from backend.ai_chat.service import ai_chat_service

    try:
        return await _run_chat_call(
            ai_chat_service.get_conversation_status,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/confirm")
async def confirm_ai_action(
    action_id: str,
    payload: dict[str, Any] | None = Body(default=None),
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import confirm_action

    try:
        return await _run_chat_call(
            confirm_action,
            action_id=action_id,
            current_user=current_user,
            payload_overrides=payload,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/cancel")
async def cancel_ai_action(
    action_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import cancel_action

    try:
        return await _run_chat_call(
            cancel_action,
            action_id=action_id,
            current_user=current_user,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/upload-sessions", response_model=ChatUploadSessionResponse)
async def create_chat_upload_session(
    conversation_id: str,
    payload: ChatUploadSessionCreateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await _run_chat_call(
            chat_service.create_upload_session,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=payload.body,
            reply_to_message_id=payload.reply_to_message_id,
            files=[item.model_dump() for item in list(payload.files or [])],
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


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
        return await _run_chat_call(
            chat_service.upload_session_chunk,
            current_user_id=int(current_user.id),
            session_id=session_id,
            file_id=file_id,
            chunk_index=int(chunk_index),
            offset=int(offset),
            payload=bytes(payload or b""),
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/upload-sessions/{session_id}", response_model=ChatUploadSessionResponse)
async def get_chat_upload_session(
    session_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await _run_chat_call(
            chat_service.get_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/upload-sessions/{session_id}/complete", response_model=ChatMessageResponse)
async def complete_chat_upload_session(
    session_id: str,
    db_id: Optional[str] = Depends(get_current_database_id),
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        message, meta = await _run_chat_call_with_meta(
            chat_service.complete_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
            defer_push_notifications=True,
        )
        if bool(meta.get("upload_session_completed_now")):
            _schedule_chat_message_side_effects(
                conversation_id=message["conversation_id"],
                message_id=message["id"],
            )
            _schedule_ai_run_for_message(
                current_user_id=int(current_user.id),
                conversation_id=message["conversation_id"],
                message_id=message["id"],
                effective_database_id=db_id,
            )
        return message
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.delete("/upload-sessions/{session_id}", response_model=ChatUploadSessionCancelResponse)
async def cancel_chat_upload_session(
    session_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_WRITE)),
):
    try:
        return await _run_chat_call(
            chat_service.cancel_upload_session,
            current_user_id=int(current_user.id),
            session_id=session_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.post("/conversations/{conversation_id}/read")
async def mark_chat_conversation_read(
    conversation_id: str,
    payload: MarkReadRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        read_payload = await _run_chat_call(
            chat_service.mark_read,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=payload.message_id,
        )
        _schedule_chat_background_task(
            _publish_message_read_after_mark_read(
                conversation_id=conversation_id,
                message_id=payload.message_id,
                reader_user_id=int(current_user.id),
                read_at=read_payload.get("read_at"),
            ),
            label="publish_message_read",
        )
        return read_payload
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.get("/messages/{message_id}/attachments/{attachment_id}/file")
async def download_chat_attachment(
    message_id: str,
    attachment_id: str,
    inline: bool = Query(False),
    variant: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        attachment = await _run_chat_call(
            chat_service.get_attachment_for_download,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
            variant=variant,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)
    return FileResponse(
        path=attachment["path"],
        filename=attachment["file_name"],
        media_type=attachment["mime_type"],
        content_disposition_type="inline" if inline else "attachment",
    )


@router.get("/messages/{message_id}/reads", response_model=ChatMessageReadsResponse)
async def get_chat_message_reads(
    message_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await _run_chat_call(
            chat_service.get_message_reads,
            current_user_id=int(current_user.id),
            message_id=message_id,
        )
    except Exception as exc:
        _raise_chat_http_error(exc)


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    current_user: Optional[User] = None
    try:
        current_user = await get_current_user_from_websocket(websocket)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        ensure_user_permission(current_user, PERM_CHAT_READ)
    except Exception as exc:
        await websocket.close(code=_ws_error_code(exc))
        return

    connection_id = ""
    try:
        connection_id, first_connection = await chat_realtime.connect(websocket, user_id=int(current_user.id))
    except Exception:
        await websocket.close(code=1011)
        return

    try:
        snapshot = await _run_chat_call(
            chat_service.get_unread_summary,
            current_user_id=int(current_user.id),
        )
        await chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.snapshot",
            payload={"unread_summary": snapshot},
        )
        if not _ws_is_connected(websocket):
            return
        if first_connection:
            await _publish_presence_updated(int(current_user.id))

        rate_limiter = _ChatWsCommandRateLimiter(
            rate_per_sec=CHAT_WS_COMMANDS_PER_SEC,
            burst=CHAT_WS_COMMAND_BURST,
        )
        while True:
            if not _ws_is_connected(websocket):
                break
            try:
                envelope = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                if "WebSocket is not connected" in str(exc):
                    break
                raise
            except ValueError:
                await chat_realtime.send_error(
                    connection_id,
                    detail="Invalid websocket payload",
                    code="invalid_payload",
                )
                continue

            message_type = str((envelope or {}).get("type") or "").strip()
            request_id = str((envelope or {}).get("request_id") or "").strip() or None
            conversation_id = str((envelope or {}).get("conversation_id") or "").strip() or None
            payload = (envelope or {}).get("payload")
            if not isinstance(payload, dict):
                payload = {}

            allowed, retry_after_ms = rate_limiter.allow()
            if not allowed:
                chat_realtime.record_rate_limited(connection_id)
                await chat_realtime.send_to_connection(
                    connection_id,
                    event_type="error",
                    payload={
                        "code": "rate_limited",
                        "retry_after_ms": int(retry_after_ms),
                    },
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
                logger.warning(
                    "Chat websocket rate limited: user_id=%s connection_id=%s message_type=%s violations=%s",
                    int(current_user.id),
                    connection_id,
                    message_type or "-",
                    int(rate_limiter.violations),
                )
                if int(rate_limiter.violations) >= CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS:
                    await websocket.close(code=1008, reason="chat websocket rate limit exceeded")
                    break
                continue
            if message_type not in {"chat.typing", "chat.ping"}:
                chat_realtime.touch_presence(connection_id)

            try:
                if message_type == "chat.subscribe_inbox":
                    chat_realtime.subscribe_inbox(connection_id)
                    snapshot = await _run_chat_call(
                        chat_service.get_unread_summary,
                        current_user_id=int(current_user.id),
                    )
                    await chat_realtime.send_to_connection(
                        connection_id,
                        event_type="chat.snapshot",
                        payload={"unread_summary": snapshot},
                        request_id=request_id,
                    )
                    continue

                if message_type == "chat.subscribe_conversation":
                    if not conversation_id:
                        raise ValueError("conversation_id is required")
                    await _run_chat_call(
                        chat_service.get_conversation_summary,
                        current_user_id=int(current_user.id),
                        conversation_id=conversation_id,
                    )
                    chat_realtime.subscribe_conversation(connection_id, conversation_id)
                    await chat_realtime.send_command_ok(
                        connection_id,
                        request_id=request_id,
                        conversation_id=conversation_id,
                    )
                    continue

                if message_type == "chat.unsubscribe_conversation":
                    if not conversation_id:
                        raise ValueError("conversation_id is required")
                    chat_realtime.unsubscribe_conversation(connection_id, conversation_id)
                    await chat_realtime.send_command_ok(
                        connection_id,
                        request_id=request_id,
                        conversation_id=conversation_id,
                    )
                    continue

                if message_type == "chat.watch_presence":
                    watched_user_ids = chat_realtime.watch_presence(
                        connection_id,
                        payload.get("user_ids") or [],
                    )
                    await chat_realtime.send_command_ok(
                        connection_id,
                        request_id=request_id,
                        payload={"user_ids": watched_user_ids},
                    )
                    continue

                if message_type == "chat.send_message":
                    ensure_user_permission(current_user, PERM_CHAT_WRITE)
                    if not conversation_id:
                        raise ValueError("conversation_id is required")
                    command_started_at = time.perf_counter()
                    body_text = _normalize_text(payload.get("body"))
                    message, _ = await _run_chat_call_with_meta(
                        chat_service.send_message,
                        current_user_id=int(current_user.id),
                        conversation_id=conversation_id,
                        body=body_text,
                        body_format=_normalize_text(payload.get("body_format")) or "plain",
                        client_message_id=payload.get("client_message_id"),
                        reply_to_message_id=payload.get("reply_to_message_id"),
                        defer_push_notifications=True,
                    )
                    await chat_realtime.send_command_ok(
                        connection_id,
                        request_id=request_id,
                        conversation_id=conversation_id,
                        payload={
                            "message_id": message.get("id"),
                            "message": message,
                        },
                    )
                    _log_ws_command_timing(
                        "send_message",
                        command_started_at,
                        connection_id=connection_id,
                        request_id=request_id or "-",
                        user_id=int(current_user.id),
                        conversation_id=conversation_id,
                        message_id=_normalize_text(message.get("id")) or None,
                        body_len=len(body_text),
                        client_message_id=_normalize_text(payload.get("client_message_id")) or None,
                        has_reply=int(bool(_normalize_text(payload.get("reply_to_message_id")))),
                    )
                    # Ack first so the next websocket command is not blocked by side effects.
                    _schedule_chat_message_side_effects(
                        conversation_id=conversation_id,
                        message_id=message["id"],
                    )
                    _schedule_ai_run_for_message(
                        current_user_id=int(current_user.id),
                        conversation_id=conversation_id,
                        message_id=message["id"],
                        effective_database_id=_normalize_text(payload.get("database_id")) or None,
                    )
                    continue

                if message_type == "chat.mark_read":
                    if not conversation_id:
                        raise ValueError("conversation_id is required")
                    message_id = str(payload.get("message_id") or "").strip()
                    if not message_id:
                        raise ValueError("message_id is required")
                    command_started_at = time.perf_counter()
                    read_payload = await _run_chat_call(
                        chat_service.mark_read,
                        current_user_id=int(current_user.id),
                        conversation_id=conversation_id,
                        message_id=message_id,
                    )
                    await chat_realtime.send_command_ok(
                        connection_id,
                        request_id=request_id,
                        conversation_id=conversation_id,
                        payload=read_payload,
                    )
                    _log_ws_command_timing(
                        "mark_read",
                        command_started_at,
                        connection_id=connection_id,
                        request_id=request_id or "-",
                        user_id=int(current_user.id),
                        conversation_id=conversation_id,
                        message_id=message_id,
                    )
                    _schedule_chat_background_task(
                        _publish_message_read_after_mark_read(
                            conversation_id=conversation_id,
                            message_id=message_id,
                            reader_user_id=int(current_user.id),
                            read_at=read_payload.get("read_at"),
                        ),
                        label="publish_message_read",
                    )
                    continue

                if message_type == "chat.typing":
                    if not conversation_id:
                        raise ValueError("conversation_id is required")
                    await _run_chat_call(
                        chat_service.get_conversation,
                        current_user_id=int(current_user.id),
                        conversation_id=conversation_id,
                    )
                    is_typing = bool(payload.get("is_typing"))
                    if is_typing and not chat_realtime.allow_typing_started(
                        user_id=int(current_user.id),
                        conversation_id=conversation_id,
                    ):
                        continue
                    if not is_typing:
                        chat_realtime.clear_typing_state(
                            user_id=int(current_user.id),
                            conversation_id=conversation_id,
                        )
                    member_user_ids = await _run_chat_call(
                        chat_service.get_conversation_member_ids,
                        conversation_id=conversation_id,
                    )
                    sender_name = str(current_user.full_name or current_user.username or "").strip()
                    typing_payload = {
                        "user_id": int(current_user.id),
                        "sender_name": sender_name,
                        "is_typing": is_typing,
                        "expires_in_ms": 5000 if is_typing else 0,
                    }
                    typing_tasks = [
                        chat_realtime.publish_conversation_event(
                            user_id=int(member_user_id),
                            conversation_id=conversation_id,
                            event_type="chat.typing.started" if is_typing else "chat.typing.stopped",
                            payload=typing_payload,
                        )
                        for member_user_id in member_user_ids
                        if int(member_user_id) != int(current_user.id)
                    ]
                    if typing_tasks:
                        await asyncio.gather(*typing_tasks)
                    continue

                if message_type == "chat.ping":
                    await chat_realtime.send_to_connection(
                        connection_id,
                        event_type="chat.pong",
                        request_id=request_id,
                    )
                    continue

                await chat_realtime.send_error(
                    connection_id,
                    detail=f"Unsupported websocket command: {message_type or 'unknown'}",
                    code="unsupported_command",
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
            except Exception as exc:
                await chat_realtime.send_error(
                    connection_id,
                    detail=str(getattr(exc, "detail", None) or exc),
                    code="command_failed",
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
    except WebSocketDisconnect as exc:
        logger.info(
            "Chat websocket disconnected: user_id=%s connection_id=%s code=%s",
            int(current_user.id) if current_user is not None else 0,
            connection_id,
            getattr(exc, "code", None),
        )
    finally:
        disconnect_state = chat_realtime.disconnect(connection_id)
        if disconnect_state.get("last_connection"):
            try:
                await _publish_presence_updated(int(disconnect_state.get("user_id") or 0))
            except Exception:
                pass
