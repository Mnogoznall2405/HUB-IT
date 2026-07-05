"""Shared helpers for chat API sub-routers."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from typing import Any, Optional

from fastapi import HTTPException, Request
from starlette.websockets import WebSocketState

from backend.chat.db import ChatConfigurationError
from backend.chat.realtime import ChatWsCommandRateLimiter, chat_realtime as _default_chat_realtime
from backend.chat.realtime_side_effects import publish_message_created_after_send as publish_message_created_after_send_side_effects
from backend.chat.service import chat_service as _default_chat_service

logger = logging.getLogger("backend.chat.websocket")
http_logger = logging.getLogger("backend.chat.api")
logger.setLevel(logging.INFO)
http_logger.setLevel(logging.INFO)
runtime_logger = logging.getLogger("uvicorn.error")


def _pkg():
    return sys.modules["backend.api.v1.chat"]


def _chat_service():
    return _pkg().chat_service


def _chat_realtime():
    return _pkg().chat_realtime

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
CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL = _env_int("CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL", 30, 1, 1000)
CHAT_WS_SESSION_REVALIDATE_SEC = _env_int("CHAT_WS_SESSION_REVALIDATE_SEC", 60, 5, 3600)

# Backward-compatible alias for tests and internal imports.
_ChatWsCommandRateLimiter = ChatWsCommandRateLimiter


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
    try:
        from backend.chat.request_metrics import record_chat_route_cache, record_chat_route_timing

        record_chat_route_timing(route_name, took_ms)
        if "cache_hit" in context and context.get("cache_hit") is not None:
            record_chat_route_cache(route_name, bool(context.get("cache_hit")))
    except Exception:
        pass


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
    return await _pkg().run_in_threadpool(func, *args, **kwargs)


async def _run_chat_call_with_meta(func, /, *args, **kwargs) -> tuple[Any, dict[str, Any]]:
    def _invoke():
        try:
            result = func(*args, **kwargs)
        except Exception:
            _chat_service().consume_request_meta()
            raise
        return result, _chat_service().consume_request_meta()

    return await _pkg().run_in_threadpool(_invoke)


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
    _pkg()._schedule_chat_background_task(
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
    _pkg()._schedule_chat_background_task(
        _queue_ai_run_for_message(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            message_id=message_id,
            effective_database_id=effective_database_id,
        ),
        label="queue_ai_run",
    )



from backend.chat.realtime_publisher import (  # noqa: F401
    _get_conversation_updates_for_users,
    _get_unread_summaries,
    _publish_conversation_updated,
    _publish_deleted_conversation,
    _publish_group_conversation_change,
    _publish_message_created,
    _publish_message_created_after_send,
    _publish_message_deleted,
    _publish_message_deleted_after_soft_delete,
    _publish_message_read,
    _publish_message_read_after_mark_read,
    _publish_message_updated,
    _publish_message_updated_after_edit,
    _publish_presence_updated,
    _publish_unread_summary,
    _queue_ai_run_for_message,
)

# Backward-compatible alias for tests and internal imports.
_ChatWsCommandRateLimiter = ChatWsCommandRateLimiter