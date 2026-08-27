"""Shared helpers for chat API sub-routers."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from fastapi import HTTPException, Request
from starlette.responses import JSONResponse, Response
from starlette.websockets import WebSocket, WebSocketState

from backend.chat.db import ChatConfigurationError
from backend.chat.realtime import ChatWsCommandRateLimiter, chat_realtime as _default_chat_realtime
from backend.chat.realtime_side_effects import (
    publish_inbox_meta_after_message_created as publish_inbox_meta_after_message_created_side_effects,
    publish_message_created_fast_after_send as publish_message_created_fast_after_send_side_effects,
)
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
# Keep hub/push fan-out off the shared FastAPI/anyio threadpool used by send/publish.
CHAT_NOTIFICATION_SIDEFX_WORKERS = _env_int("CHAT_NOTIFICATION_SIDEFX_WORKERS", 4, 1, 32)
# Hub/app notifications: keep moderate under chat+HUB load.
CHAT_NOTIFICATION_SIDEFX_CONCURRENCY = _env_int("CHAT_NOTIFICATION_SIDEFX_CONCURRENCY", 4, 1, 16)
# Push outbox enqueue after ACK: higher priority than hub so Web Push is not delayed into already_read.
CHAT_PUSH_SIDEFX_CONCURRENCY = _env_int("CHAT_PUSH_SIDEFX_CONCURRENCY", 8, 1, 32)
# Cap concurrent message fan-out so outbound WS queues / Redis publish do not stall ACKs.
# High priority: delivery-state / durable outbox-adjacent work.
CHAT_AFTER_SEND_HIGH_CONCURRENCY = _env_int("CHAT_AFTER_SEND_HIGH_CONCURRENCY", 8, 1, 32)
# Medium: inbox metadata / unread cache fan-out.
CHAT_AFTER_SEND_META_CONCURRENCY = _env_int("CHAT_AFTER_SEND_META_CONCURRENCY", 4, 1, 16)
# Legacy alias used for room broadcast enqueue.
CHAT_AFTER_SEND_CONCURRENCY = _env_int("CHAT_AFTER_SEND_CONCURRENCY", 12, 1, 64)
# Dedicated pool for chat writes so hub HTTP cannot starve send/mark_read.
CHAT_WRITE_WORKERS = _env_int("CHAT_WRITE_WORKERS", 48, 4, 128)
# Isolate mark_read from long send transactions on the write pool.
CHAT_MARK_READ_WORKERS = _env_int("CHAT_MARK_READ_WORKERS", 16, 2, 64)
# Read concurrency is acquired BEFORE threadpool submit (does not cancel running SQL).
from backend.chat.write_path_limits import (  # noqa: E402
    CHAT_READ_ACQUIRE_TIMEOUT_MS,
    CHAT_READ_CONCURRENCY,
)

_CHAT_READ_SEM: asyncio.Semaphore | None = None
_CHAT_NOTIFICATION_EXECUTOR = ThreadPoolExecutor(
    max_workers=CHAT_NOTIFICATION_SIDEFX_WORKERS,
    thread_name_prefix="chat-notif",
)
_CHAT_WRITE_EXECUTOR = ThreadPoolExecutor(
    max_workers=CHAT_WRITE_WORKERS,
    thread_name_prefix="chat-write",
)
_CHAT_MARK_READ_EXECUTOR = ThreadPoolExecutor(
    max_workers=CHAT_MARK_READ_WORKERS,
    thread_name_prefix="chat-mark-read",
)
_CHAT_NOTIFICATION_SEM: asyncio.Semaphore | None = None
_CHAT_PUSH_SIDEFX_SEM: asyncio.Semaphore | None = None
_CHAT_AFTER_SEND_SEM: asyncio.Semaphore | None = None
_CHAT_AFTER_SEND_HIGH_SEM: asyncio.Semaphore | None = None
_CHAT_AFTER_SEND_META_SEM: asyncio.Semaphore | None = None
_INBOX_META_PENDING: dict[str, asyncio.Task[Any]] = {}
_INBOX_META_LOCK: asyncio.Lock | None = None


def _notification_sem() -> asyncio.Semaphore:
    global _CHAT_NOTIFICATION_SEM
    if _CHAT_NOTIFICATION_SEM is None:
        _CHAT_NOTIFICATION_SEM = asyncio.Semaphore(CHAT_NOTIFICATION_SIDEFX_CONCURRENCY)
    return _CHAT_NOTIFICATION_SEM


def _push_sidefx_sem() -> asyncio.Semaphore:
    global _CHAT_PUSH_SIDEFX_SEM
    if _CHAT_PUSH_SIDEFX_SEM is None:
        _CHAT_PUSH_SIDEFX_SEM = asyncio.Semaphore(CHAT_PUSH_SIDEFX_CONCURRENCY)
    return _CHAT_PUSH_SIDEFX_SEM


def _after_send_sem() -> asyncio.Semaphore:
    global _CHAT_AFTER_SEND_SEM
    if _CHAT_AFTER_SEND_SEM is None:
        _CHAT_AFTER_SEND_SEM = asyncio.Semaphore(CHAT_AFTER_SEND_CONCURRENCY)
    return _CHAT_AFTER_SEND_SEM


def _after_send_high_sem() -> asyncio.Semaphore:
    global _CHAT_AFTER_SEND_HIGH_SEM
    if _CHAT_AFTER_SEND_HIGH_SEM is None:
        _CHAT_AFTER_SEND_HIGH_SEM = asyncio.Semaphore(CHAT_AFTER_SEND_HIGH_CONCURRENCY)
    return _CHAT_AFTER_SEND_HIGH_SEM


def _after_send_meta_sem() -> asyncio.Semaphore:
    global _CHAT_AFTER_SEND_META_SEM
    if _CHAT_AFTER_SEND_META_SEM is None:
        _CHAT_AFTER_SEND_META_SEM = asyncio.Semaphore(CHAT_AFTER_SEND_META_CONCURRENCY)
    return _CHAT_AFTER_SEND_META_SEM


def _inbox_meta_lock() -> asyncio.Lock:
    global _INBOX_META_LOCK
    if _INBOX_META_LOCK is None:
        _INBOX_META_LOCK = asyncio.Lock()
    return _INBOX_META_LOCK


def _read_sem() -> asyncio.Semaphore:
    global _CHAT_READ_SEM
    if _CHAT_READ_SEM is None:
        _CHAT_READ_SEM = asyncio.Semaphore(CHAT_READ_CONCURRENCY)
    return _CHAT_READ_SEM


class ChatReadConcurrencyTimeout(TimeoutError):
    """Raised when read slot cannot be acquired before threadpool submit."""


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _request_id_from_headers(request: Optional[Request]) -> str:
    if request is None:
        return "-"
    return _normalize_text(request.headers.get("X-Client-Request-ID"), "-")


def _log_request_timing(route_name: str, request_id: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    try:
        from backend.chat.request_metrics import record_chat_route_cache, record_chat_route_timing

        record_chat_route_timing(route_name, took_ms)
        if "cache_hit" in context and context.get("cache_hit") is not None:
            record_chat_route_cache(route_name, bool(context.get("cache_hit")))
    except Exception:
        pass
    # Metrics always; logging only above slow threshold (QueueHandler when installed).
    try:
        from backend.chat.async_logging import log_slow_warning, should_log_route_timing

        if should_log_route_timing(took_ms):
            payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
            message = f"chat.{route_name} request_id={request_id} took_ms={took_ms:.1f}"
            if payload:
                message = f"{message} {payload}"
            log_slow_warning(http_logger, f"route:{route_name}", "%s", message)
    except Exception:
        if took_ms >= 200.0:
            http_logger.warning(
                "chat.%s request_id=%s took_ms=%.1f",
                route_name,
                request_id,
                took_ms,
            )
    # #region agent log
    try:
        if route_name in {"conversations", "messages", "conversation_detail", "unread_summary"} or took_ms >= 200.0:
            from backend.chat.send_audit import audit_send_trace

            pool_checked = None
            pool_size = None
            try:
                from backend.chat.db import get_chat_engine

                eng = get_chat_engine()
                pool = getattr(eng, "pool", None)
                if pool is not None:
                    pool_checked = int(pool.checkedout()) if hasattr(pool, "checkedout") else None
                    pool_size = int(pool.size()) if hasattr(pool, "size") else None
            except Exception:
                pass
            audit_send_trace(
                trace_id="route",
                stage="chat_route_timing",
                elapsed_ms=float(took_ms),
                route=str(route_name),
                cache_hit=context.get("cache_hit"),
                items_count=context.get("items_count"),
                user_id=context.get("user_id"),
                pool_checkedout=pool_checked,
                pool_size=pool_size,
            )
    except Exception:
        pass
    # #endregion


def _log_ws_command_timing(command_name: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    try:
        from backend.chat.async_logging import should_log_route_timing

        if not should_log_route_timing(took_ms):
            return
    except Exception:
        if took_ms < 200.0:
            return
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"chat.ws.{command_name} ack_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    logger.warning(message)


def _ws_is_connected(websocket: WebSocket) -> bool:
    return (
        websocket.client_state == WebSocketState.CONNECTED
        and websocket.application_state == WebSocketState.CONNECTED
    )


def _raise_chat_http_error(exc: Exception) -> None:
    if isinstance(exc, ChatConfigurationError):
        raise HTTPException(
            status_code=503,
            detail=str(exc),
            headers={"Retry-After": "1"},
        ) from exc
    if isinstance(exc, ChatReadConcurrencyTimeout):
        # Prefer fast fail + Retry-After over letting list/history stall the event loop.
        raise HTTPException(
            status_code=503,
            detail=str(exc),
            headers={"Retry-After": "1"},
        ) from exc
    try:
        from backend.chat.write_path_limits import WriteSlotTimeoutError

        if isinstance(exc, WriteSlotTimeoutError):
            raise HTTPException(
                status_code=503,
                detail=str(exc),
                headers={"Retry-After": "1"},
            ) from exc
    except HTTPException:
        raise
    except Exception:
        pass
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        sqlstate = str(getattr(current, "sqlstate", None) or getattr(current, "pgcode", None) or "")
        if sqlstate == "57014" or current.__class__.__name__.lower() in {"querycanceled", "querycancelederror"}:
            raise HTTPException(
                status_code=503,
                detail="Chat database query timed out",
                headers={"Retry-After": "1"},
            ) from exc
        original = getattr(current, "orig", None)
        if isinstance(original, BaseException) and id(original) not in seen:
            current = original
            continue
        current = current.__cause__ if isinstance(current.__cause__, BaseException) else None
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
        if int(exc.status_code) == 429:
            return 4429
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
    if isinstance(exc, ChatReadConcurrencyTimeout):
        return 4503
    return 1011


def _classify_ws_handshake_denial(exc: Exception) -> tuple[int, str, str]:
    """Map handshake failure to (http_status, reason_code, detail).

    Classification (plan):
      400 — malformed handshake/request
      401 — missing/expired/racing session
      403 — authenticated but access denied
      429/503 — admission control or temporary overload
    """
    if isinstance(exc, HTTPException):
        status = int(exc.status_code)
        detail = str(exc.detail or "")[:240]
        if status == 401:
            return 401, "auth_session", detail or "authentication_required"
        if status == 403:
            return 403, "access_denied", detail or "forbidden"
        if status == 400:
            return 400, "malformed_request", detail or "bad_request"
        if status == 429:
            return 429, "rate_limited", detail or "too_many_requests"
        if status == 503:
            return 503, "overloaded", detail or "service_unavailable"
        if status == 404:
            # Session/user lookup during handshake → treat as auth race/missing.
            return 401, "auth_session", detail or "not_found"
        if 400 <= status < 500:
            return status, "client_error", detail or f"http_{status}"
        return 503, "overloaded", detail or f"http_{status}"
    if isinstance(exc, PermissionError):
        return 403, "access_denied", str(exc)[:240] or "forbidden"
    if isinstance(exc, ValueError):
        return 400, "malformed_request", str(exc)[:240] or "bad_request"
    if isinstance(exc, LookupError):
        return 401, "auth_session", str(exc)[:240] or "not_found"
    if isinstance(exc, (ChatConfigurationError, ChatReadConcurrencyTimeout)):
        return 503, "overloaded", str(exc)[:240] or "service_unavailable"
    try:
        from backend.chat.write_path_limits import WriteSlotTimeoutError

        if isinstance(exc, WriteSlotTimeoutError):
            return 503, "overloaded", str(exc)[:240] or "write_slot_timeout"
    except Exception:
        pass
    return 503, "overloaded", str(exc)[:240] or "internal_error"


def _ws_denial_extension_available(websocket: WebSocket) -> bool:
    extensions = websocket.scope.get("extensions") if getattr(websocket, "scope", None) else None
    return isinstance(extensions, dict) and "websocket.http.response" in extensions


async def _deny_ws_handshake(websocket: WebSocket, exc: Exception) -> dict[str, Any]:
    """Deny WS before accept with informative HTTP status when supported.

    Falls back to pre-accept close (uvicorn may still surface HTTP 403) but always
    emits a structured reason-log so denials are not opaque.
    """
    status, reason_code, detail = _classify_ws_handshake_denial(exc)
    close_code = _ws_error_code(exc)
    denial_mode = "close_fallback"
    log_payload = {
        "status": status,
        "reason_code": reason_code,
        "detail": detail,
        "close_code": close_code,
        "exc_type": type(exc).__name__,
    }
    try:
        if _ws_denial_extension_available(websocket):
            response: Response = JSONResponse(
                status_code=status,
                content={
                    "detail": detail,
                    "reason_code": reason_code,
                },
            )
            await websocket.send_denial_response(response)
            denial_mode = "http_denial"
        else:
            await websocket.close(code=close_code)
    except RuntimeError:
        try:
            await websocket.close(code=close_code)
        except Exception:
            pass
        denial_mode = "close_fallback"
    except Exception:
        try:
            await websocket.close(code=close_code)
        except Exception:
            pass
        denial_mode = "close_fallback"
    log_payload["denial_mode"] = denial_mode
    logger.warning(
        "chat_ws_handshake_denied status=%s reason=%s mode=%s detail=%s close_code=%s exc=%s",
        status,
        reason_code,
        denial_mode,
        detail,
        close_code,
        type(exc).__name__,
    )
    return log_payload


async def _acquire_read_slot() -> None:
    """Acquire read concurrency before submitting sync SQL to a threadpool."""
    sem = _read_sem()
    timeout_sec = max(0.01, float(CHAT_READ_ACQUIRE_TIMEOUT_MS) / 1000.0)
    try:
        await asyncio.wait_for(sem.acquire(), timeout=timeout_sec)
    except asyncio.TimeoutError as exc:
        raise ChatReadConcurrencyTimeout(
            f"chat read concurrency full (limit={CHAT_READ_CONCURRENCY}, "
            f"acquire_timeout_ms={CHAT_READ_ACQUIRE_TIMEOUT_MS})"
        ) from exc


async def _run_chat_call(func, /, *args, **kwargs):
    # chat_service still uses sync DB sessions, so every call must stay off the event loop.
    # NOTE: do not put read semaphore here — this helper is also used by after-send/publish.
    queue_started_at = time.perf_counter()
    _queued_at = time.time()

    def _invoke():
        try:
            wait_ms = (time.time() - _queued_at) * 1000.0
            if wait_ms >= 50.0:
                from backend.chat.send_audit import audit_send_trace

                audit_send_trace(
                    trace_id="pool",
                    stage="threadpool_wait",
                    elapsed_ms=float(wait_ms),
                    func=getattr(func, "__name__", str(func))[:80],
                )
        except Exception:
            pass
        return func(*args, **kwargs)

    result = await _pkg().run_in_threadpool(_invoke)
    _ = queue_started_at
    return result


async def _run_chat_call_with_meta(func, /, *args, **kwargs) -> tuple[Any, dict[str, Any]]:
    queue_started_at = time.perf_counter()

    def _invoke():
        started = time.perf_counter()
        wait_ms = (started - queue_started_at) * 1000.0
        try:
            if wait_ms >= 50.0:
                from backend.chat.send_audit import audit_send_trace

                audit_send_trace(
                    trace_id="pool",
                    stage="threadpool_wait_meta",
                    elapsed_ms=float(wait_ms),
                    func=getattr(func, "__name__", str(func))[:80],
                )
        except Exception:
            pass
        try:
            result = func(*args, **kwargs)
        except Exception:
            _chat_service().consume_request_meta()
            raise
        meta = _chat_service().consume_request_meta() or {}
        if not isinstance(meta, dict):
            meta = {}
        meta["executor_wait_ms"] = round(wait_ms, 2)
        meta["db_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
        return result, meta

    return await _pkg().run_in_threadpool(_invoke)


async def _run_chat_read_call(func, /, *args, **kwargs):
    """HTTP read path: acquire read slot BEFORE threadpool (does not cancel running SQL)."""
    await _acquire_read_slot()
    try:
        return await _run_chat_call(func, *args, **kwargs)
    finally:
        _read_sem().release()


async def _run_chat_read_call_with_meta(func, /, *args, **kwargs) -> tuple[Any, dict[str, Any]]:
    await _acquire_read_slot()
    try:
        return await _run_chat_call_with_meta(func, *args, **kwargs)
    finally:
        _read_sem().release()


async def _run_chat_notification_call(func, /, *args, **kwargs):
    """Run notification fan-out on a dedicated pool (does not starve send/publish)."""
    from backend.chat.latency_profile import run_in_named_executor

    return await run_in_named_executor(
        _CHAT_NOTIFICATION_EXECUTOR,
        "chat_notif",
        func,
        *args,
        **kwargs,
    )


async def _run_chat_write_call(func, /, *args, **kwargs):
    """Run chat write ops on a dedicated pool (isolated from hub/read stampede)."""
    from backend.chat.latency_profile import run_in_named_executor

    return await run_in_named_executor(
        _CHAT_WRITE_EXECUTOR,
        "chat_write",
        func,
        *args,
        **kwargs,
    )


async def _run_chat_mark_read_call(func, /, *args, **kwargs):
    """Run mark_read on its own pool so send sequence TX cannot starve receipts."""
    from backend.chat.latency_profile import run_in_named_executor

    return await run_in_named_executor(
        _CHAT_MARK_READ_EXECUTOR,
        "chat_mark_read",
        func,
        *args,
        **kwargs,
    )


async def _run_chat_write_call_with_meta(func, /, *args, **kwargs) -> tuple[Any, dict[str, Any]]:
    from backend.chat.latency_profile import run_in_named_executor
    from backend.chat.send_audit import audit_send_trace
    from backend.chat.write_path_metrics import (
        mark_send_stage,
        reset_send_trace_id,
        set_send_trace_id,
    )

    queued_at = time.perf_counter()
    send_trace_id = str(kwargs.pop("send_trace_id", "") or "")[:32]
    job_type = str(kwargs.pop("write_job_type", "send") or "send")[:32]
    conversation_id = str(kwargs.get("conversation_id") or "")[:64]
    if send_trace_id:
        audit_send_trace(
            trace_id=send_trace_id,
            stage="write_job_submitted",
            elapsed_ms=0.0,
            job_type=job_type,
            chat_id=conversation_id,
            wall_ts_ms=int(time.time() * 1000),
        )
        try:
            from backend.chat.send_inflight_tracker import note_send_queued

            note_send_queued(
                trace_id=send_trace_id,
                conversation_id=conversation_id,
                job_type=job_type,
            )
        except Exception:
            pass

    def _invoke():
        wait_ms = (time.perf_counter() - queued_at) * 1000.0
        token = set_send_trace_id(send_trace_id) if send_trace_id else None
        try:
            if send_trace_id:
                try:
                    from backend.chat.send_inflight_tracker import note_send_started, note_send_stage

                    note_send_started(trace_id=send_trace_id, conversation_id=conversation_id)
                    note_send_stage(trace_id=send_trace_id, stage="write_job_started")
                except Exception:
                    pass
                mark_send_stage(
                    "write_job_started",
                    started_at=queued_at,
                    job_type=job_type,
                    chat_id=conversation_id,
                )
                mark_send_stage(
                    "executor_queue_wait",
                    started_at=queued_at,
                    job_type=job_type,
                    chat_id=conversation_id,
                )
            try:
                result = func(*args, **kwargs)
            except Exception:
                _chat_service().consume_request_meta()
                raise
            meta = _chat_service().consume_request_meta()
            if not isinstance(meta, dict):
                meta = {}
            meta["write_pool_wait_ms"] = round(wait_ms, 1)
            meta["write_job_type"] = job_type
            return result, meta
        finally:
            if send_trace_id:
                try:
                    from backend.chat.send_inflight_tracker import note_send_finished

                    note_send_finished(trace_id=send_trace_id)
                except Exception:
                    pass
            if token is not None:
                reset_send_trace_id(token)

    return await run_in_named_executor(
        _CHAT_WRITE_EXECUTOR,
        "chat_write",
        _invoke,
    )


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


def _pop_deferred_chat_notifications(message: Any) -> dict[str, Any] | None:
    """Extract internal deferred-notification plan; never leak it to clients."""
    if not isinstance(message, dict):
        return None
    deferred = message.pop("_deferred_chat_notifications", None)
    return deferred if isinstance(deferred, dict) and deferred else None


def _pop_deferred_realtime_publish(message: Any) -> dict[str, Any] | None:
    """Extract prebuilt realtime publish plan; never leak it to clients."""
    if not isinstance(message, dict):
        return None
    deferred = message.pop("_deferred_realtime_publish", None)
    return deferred if isinstance(deferred, dict) and deferred else None


def _pop_deferred_delivery_outbox(message: Any) -> dict[str, Any] | None:
    """Extract deferred delivery-state outbox job; never leak it to clients."""
    if not isinstance(message, dict):
        return None
    deferred = message.pop("_deferred_delivery_outbox", None)
    return deferred if isinstance(deferred, dict) and deferred else None


async def _enqueue_deferred_delivery_outbox(*, deferred: dict[str, Any] | None) -> bool:
    """Aux-slot INSERT ... ON CONFLICT DO NOTHING after ACK."""
    if not isinstance(deferred, dict) or not deferred:
        return False
    from backend.chat.event_outbox_service import chat_event_outbox_service
    from backend.chat.write_path_limits import WriteSlotTimeoutError
    from backend.chat.write_path_metrics import note_outbox_enqueue_failed

    try:
        return bool(
            await asyncio.to_thread(
                chat_event_outbox_service.enqueue_delivery_state_job_idempotent,
                deferred,
            )
        )
    except WriteSlotTimeoutError:
        note_outbox_enqueue_failed()
        return False
    except Exception:
        note_outbox_enqueue_failed()
        return False


async def _create_deferred_chat_notifications_after_send(
    *,
    deferred: dict[str, Any],
) -> None:
    """Enqueue push outbox first (high concurrency), then hub notifications (moderate)."""
    if not isinstance(deferred, dict) or not deferred:
        return
    common_kwargs = {
        "sender_user_id": int(deferred.get("sender_user_id") or 0),
        "conversation_id": str(deferred.get("conversation_id") or ""),
        "message_id": str(deferred.get("message_id") or ""),
        "event_type": str(deferred.get("event_type") or "chat.message_received"),
        "title": str(deferred.get("title") or "Новое сообщение в чате"),
        "body": str(deferred.get("body") or ""),
        "defer_push_notifications": True,
        "mentioned_user_ids": list(deferred.get("mentioned_user_ids") or []),
    }

    push_wait_started_at = time.perf_counter()
    async with _push_sidefx_sem():
        push_sem_wait_ms = (time.perf_counter() - push_wait_started_at) * 1000.0
        # #region agent log
        try:
            from backend.chat.send_audit import audit_send_trace

            audit_send_trace(
                trace_id="notif",
                stage="deferred_notifications_start",
                elapsed_ms=float(push_sem_wait_ms),
                conversation_id=str(deferred.get("conversation_id") or "")[:64],
                message_id=str(deferred.get("message_id") or "")[:64],
                mentioned_count=len(list(deferred.get("mentioned_user_ids") or [])),
                phase="push",
            )
        except Exception:
            pass
        # #endregion
        push_stats = await _run_chat_notification_call(
            _chat_service()._create_chat_notifications,
            create_hub_notifications=False,
            enqueue_push_outbox=True,
            **common_kwargs,
        )

    hub_wait_started_at = time.perf_counter()
    async with _notification_sem():
        hub_sem_wait_ms = (time.perf_counter() - hub_wait_started_at) * 1000.0
        hub_stats = await _run_chat_notification_call(
            _chat_service()._create_chat_notifications,
            create_hub_notifications=True,
            enqueue_push_outbox=False,
            **common_kwargs,
        )
    # #region agent log
    try:
        from backend.chat.send_audit import audit_send_trace

        audit_send_trace(
            trace_id="notif",
            stage="deferred_notifications_done",
            elapsed_ms=float(push_sem_wait_ms + hub_sem_wait_ms),
            push_sem_wait_ms=float(push_sem_wait_ms),
            hub_sem_wait_ms=float(hub_sem_wait_ms),
            hub_count=(hub_stats or {}).get("hub_count") if isinstance(hub_stats, dict) else None,
            push_count=(push_stats or {}).get("push_count") if isinstance(push_stats, dict) else None,
            recipient_count=(push_stats or {}).get("recipient_count") if isinstance(push_stats, dict) else None,
            hub_notifications_ms=(hub_stats or {}).get("hub_notifications_ms") if isinstance(hub_stats, dict) else None,
            push_notifications_ms=(push_stats or {}).get("push_notifications_ms") if isinstance(push_stats, dict) else None,
        )
    except Exception:
        pass
    # #endregion


async def _apply_delivery_state_after_send(*, message_id: str) -> float:
    """Process durable unread/sender-seen outbox job after ACK (not under conversation lock)."""
    from backend.chat.event_outbox_service import chat_event_outbox_service

    started = time.perf_counter()
    async with _after_send_high_sem():
        job = await asyncio.to_thread(
            chat_event_outbox_service.claim_delivery_state_job_for_message,
            message_id=str(message_id or ""),
        )
        if job is None:
            return 0.0
        await chat_event_outbox_service.process_job(job)
    return (time.perf_counter() - started) * 1000.0


async def _schedule_coalesced_inbox_meta(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
) -> None:
    """Coalesce inbox/cache updates per conversation (latest message wins)."""
    key = f"inbox_meta:{_normalize_text(conversation_id)}"
    async with _inbox_meta_lock():
        previous = _INBOX_META_PENDING.get(key)
        if previous is not None and not previous.done():
            previous.cancel()

        async def _run() -> None:
            async with _after_send_meta_sem():
                await publish_inbox_meta_after_message_created_side_effects(
                    conversation_id=conversation_id,
                    message_id=message_id,
                    member_user_ids=member_user_ids,
                )

        task = _pkg()._schedule_chat_background_task(_run(), label="publish_inbox_meta")
        _INBOX_META_PENDING[key] = task

        def _cleanup(finished: asyncio.Task[Any], *, cleanup_key: str = key) -> None:
            current = _INBOX_META_PENDING.get(cleanup_key)
            if current is finished:
                _INBOX_META_PENDING.pop(cleanup_key, None)

        task.add_done_callback(_cleanup)


async def _enqueue_critical_message_created(
    *,
    conversation_id: str,
    message_id: str,
    deferred_realtime_publish: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Hand message.created to realtime BEFORE ACK. Must never silently drop."""
    from backend.chat.write_path_metrics import (
        critical_queue_enter,
        critical_queue_leave,
        note_critical_queue_drop,
        record_stage,
    )

    realtime = deferred_realtime_publish if isinstance(deferred_realtime_publish, dict) else {}
    trace_id = str(realtime.get("trace_id") or "")[:32]
    started = time.perf_counter()
    critical_queue_enter()
    try:
        # Critical path: await enqueue into outbound/realtime. Do not drop on overflow.
        fast = await publish_message_created_fast_after_send_side_effects(
            conversation_id=str(realtime.get("conversation_id") or conversation_id),
            message_id=str(realtime.get("message_id") or message_id),
            member_user_ids=list(realtime.get("member_user_ids") or []),
            message_payload=realtime.get("message") if isinstance(realtime.get("message"), dict) else None,
            sender_user_id=int(realtime.get("sender_user_id") or 0),
        )
        record_stage(
            "db_commit_to_event_enqueued",
            (time.perf_counter() - started) * 1000.0,
            trace_id=trace_id,
            chat_id=str(conversation_id or "")[:64],
            message_id=str(message_id or "")[:64],
            critical_queue_drop=0,
        )
        try:
            from backend.chat.send_audit import audit_send_trace

            if trace_id:
                audit_send_trace(
                    trace_id=trace_id,
                    stage="websocket_broadcast_room",
                    elapsed_ms=float((fast or {}).get("room_ms") or 0.0),
                    chat_id=str(conversation_id or "")[:64],
                    message_id=str(message_id or "")[:64],
                    room_connections=int((fast or {}).get("room_connections") or 0),
                )
                audit_send_trace(
                    trace_id=trace_id,
                    stage="recipient_socket_write",
                    elapsed_ms=float((fast or {}).get("publish_ms") or 0.0),
                    chat_id=str(conversation_id or "")[:64],
                    message_id=str(message_id or "")[:64],
                    room_connections=int((fast or {}).get("room_connections") or 0),
                    inbox_published=int((fast or {}).get("inbox_published") or 0),
                )
        except Exception:
            pass
        return fast if isinstance(fast, dict) else {}
    except Exception:
        note_critical_queue_drop()
        raise
    finally:
        critical_queue_leave()


async def _run_after_send_background_effects(
    *,
    conversation_id: str,
    message_id: str,
    deferred_notifications: dict[str, Any] | None = None,
    deferred_realtime_publish: dict[str, Any] | None = None,
    deferred_presence: dict[str, Any] | None = None,
    deferred_delivery_outbox: dict[str, Any] | None = None,
    fast_publish: dict[str, Any] | None = None,
) -> None:
    """Background/coalescible work after ACK (unread, inbox meta, hub, presence)."""
    from backend.chat.write_path_metrics import background_queue_enter, background_queue_leave

    background_queue_enter()
    try:
        realtime = deferred_realtime_publish if isinstance(deferred_realtime_publish, dict) else {}
        invalidate_user_ids = [
            int(item)
            for item in list(realtime.get("invalidate_user_ids") or realtime.get("member_user_ids") or [])
            if int(item) > 0
        ]
        invalidate_conversation_id = str(realtime.get("conversation_id") or conversation_id or "")

        if isinstance(deferred_presence, dict) and int(deferred_presence.get("user_id") or 0) > 0:
            try:
                from backend.chat.realtime import chat_realtime

                chat_realtime.note_user_activity(int(deferred_presence["user_id"]))
                _chat_service().invalidate_presence_cache(user_id=int(deferred_presence["user_id"]))
            except Exception:
                pass

        async def _invalidate_member_caches() -> float:
            if not invalidate_user_ids or not invalidate_conversation_id:
                return 0.0
            started = time.perf_counter()
            async with _after_send_meta_sem():
                await _run_chat_call(
                    _chat_service()._invalidate_conversation_views_for_users,
                    conversation_id=invalidate_conversation_id,
                    user_ids=invalidate_user_ids,
                )
            return (time.perf_counter() - started) * 1000.0

        from backend.chat.latency_profile import (
            delivery_state_after_send_enabled,
            inbox_meta_after_send_enabled,
        )

        # Deferred outbox first (aux slot), then apply — closes crash window via repair poll.
        if isinstance(deferred_delivery_outbox, dict) and deferred_delivery_outbox:
            await _enqueue_deferred_delivery_outbox(deferred=deferred_delivery_outbox)
        if delivery_state_after_send_enabled():
            _pkg()._schedule_chat_background_task(
                _apply_delivery_state_after_send(message_id=str(realtime.get("message_id") or message_id)),
                label="apply_delivery_state",
            )
        if invalidate_user_ids and invalidate_conversation_id:
            _pkg()._schedule_chat_background_task(
                _invalidate_member_caches(),
                label="invalidate_after_send",
            )
        fast = fast_publish if isinstance(fast_publish, dict) else {}
        if bool(realtime.get("needs_enrichment")):
            enrich_conversation_id = str(realtime.get("conversation_id") or conversation_id or "")
            enrich_message_id = str(realtime.get("message_id") or message_id or "")
            enrich_member_ids = [
                int(item)
                for item in list(realtime.get("member_user_ids") or [])
                if int(item) > 0
            ]
            if enrich_conversation_id and enrich_message_id and enrich_member_ids:
                _pkg()._schedule_chat_background_task(
                    _publish_message_updated(
                        conversation_id=enrich_conversation_id,
                        message_id=enrich_message_id,
                        member_user_ids=enrich_member_ids,
                    ),
                    label="enrich_message_after_lean_ack",
                )
        if inbox_meta_after_send_enabled():
            await _schedule_coalesced_inbox_meta(
                conversation_id=str(fast.get("conversation_id") or conversation_id),
                message_id=str(fast.get("message_id") or message_id),
                member_user_ids=list(fast.get("member_ids") or realtime.get("member_user_ids") or []),
            )
        if isinstance(deferred_notifications, dict) and deferred_notifications:
            _pkg()._schedule_chat_background_task(
                _create_deferred_chat_notifications_after_send(deferred=deferred_notifications),
                label="create_chat_notifications",
            )
    finally:
        background_queue_leave()


async def _run_after_send_side_effects(
    *,
    conversation_id: str,
    message_id: str,
    deferred_notifications: dict[str, Any] | None = None,
    deferred_realtime_publish: dict[str, Any] | None = None,
    deferred_delivery_outbox: dict[str, Any] | None = None,
) -> None:
    """Legacy combined path (HTTP send): critical enqueue then background."""
    fast = await _enqueue_critical_message_created(
        conversation_id=conversation_id,
        message_id=message_id,
        deferred_realtime_publish=deferred_realtime_publish,
    )
    await _run_after_send_background_effects(
        conversation_id=conversation_id,
        message_id=message_id,
        deferred_notifications=deferred_notifications,
        deferred_realtime_publish=deferred_realtime_publish,
        deferred_delivery_outbox=deferred_delivery_outbox,
        fast_publish=fast,
    )


def _schedule_chat_message_side_effects(
    *,
    conversation_id: str,
    message_id: str,
    deferred_notifications: dict[str, Any] | None = None,
    deferred_realtime_publish: dict[str, Any] | None = None,
    deferred_presence: dict[str, Any] | None = None,
    deferred_delivery_outbox: dict[str, Any] | None = None,
    fast_publish: dict[str, Any] | None = None,
    critical_already_enqueued: bool = False,
) -> None:
    if critical_already_enqueued:
        _pkg()._schedule_chat_background_task(
            _run_after_send_background_effects(
                conversation_id=conversation_id,
                message_id=message_id,
                deferred_notifications=deferred_notifications,
                deferred_realtime_publish=deferred_realtime_publish,
                deferred_presence=deferred_presence,
                deferred_delivery_outbox=deferred_delivery_outbox,
                fast_publish=fast_publish,
            ),
            label="after_send_background",
        )
        return
    _pkg()._schedule_chat_background_task(
        _run_after_send_side_effects(
            conversation_id=conversation_id,
            message_id=message_id,
            deferred_notifications=deferred_notifications,
            deferred_realtime_publish=deferred_realtime_publish,
            deferred_delivery_outbox=deferred_delivery_outbox,
        ),
        label="after_send_side_effects",
    )


def _schedule_ai_run_for_message(
    *,
    current_user_id: int,
    conversation_id: str,
    message_id: str,
    effective_database_id: str | None = None,
    conversation_kind: str | None = None,
) -> None:
    normalized_kind = _normalize_text(conversation_kind).lower()
    if normalized_kind and normalized_kind != "ai":
        return
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
    _clear_hub_notifications_after_mark_read,
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
