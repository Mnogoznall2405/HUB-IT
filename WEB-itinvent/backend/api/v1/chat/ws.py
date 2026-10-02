"""Chat WebSocket endpoint."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import asyncio
import json
import os
import time
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import (
    ensure_user_permission,
    extract_websocket_access_token,
    get_current_active_user,
    get_current_session_id,
    get_current_user_from_websocket,
)
from backend.chat.ws_auth import WsSessionLease
from backend.chat.ws_commands import dispatch_chat_ws_command
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ
from backend.utils.security import create_ws_ticket

router = APIRouter()

_WS_TICKET_TTL_SEC = max(
    60,
    min(3600, int(str(os.getenv("CHAT_WS_TICKET_TTL_SEC", "300") or "300").strip() or "300")),
)
_WS_AUTH_REQUIRED_HINT_MS = 30_000


@router.post("/ws-ticket")
async def issue_chat_ws_ticket(
    current_user: User = Depends(get_current_active_user),
    session_id: Optional[str] = Depends(get_current_session_id),
):
    """Short-lived ws_auth ticket the web client uses to re-auth an open
    socket without exposing its httpOnly access token to JS (D5/W8)."""
    ticket = create_ws_ticket(
        {
            "sub": str(current_user.username or ""),
            "user_id": int(current_user.id),
            "session_id": session_id,
        },
        expires_delta=timedelta(seconds=_WS_TICKET_TTL_SEC),
    )
    return {"ws_ticket": ticket, "expires_in": _WS_TICKET_TTL_SEC}


async def _ws_session_watchdog(
    websocket: WebSocket,
    lease: WsSessionLease,
    *,
    connection_id: str,
    interval_sec: float,
    outcome: Optional[dict] = None,
) -> None:
    """Revalidate even if the peer only receives frames or a command is slow."""
    while True:
        await asyncio.sleep(interval_sec)
        try:
            lease_status = await run_in_threadpool(lease.revalidate)
        except Exception:
            # A store outage is a transport failure, not a definitive logout.
            if outcome is not None:
                outcome["close_code"] = 1011
                outcome["close_reason"] = "session validation unavailable"
            await websocket.close(code=1011, reason="session validation unavailable")
            return
        if lease_status == "dead":
            if outcome is not None:
                outcome["close_code"] = 4401
                outcome["close_reason"] = "session expired"
            await websocket.close(code=4401, reason="session expired")
            return
        if lease_status == "grace":
            await chat_api().chat_realtime.send_control(
                connection_id,
                event_type="chat.auth.required",
                payload={"retry_after_ms": lease.grace_remaining_ms() or _WS_AUTH_REQUIRED_HINT_MS},
            )


async def _ws_post_connect_bootstrap(
    *,
    connection_id: str,
    user_id: int,
    first_connection: bool,
) -> None:
    """Snapshot + presence off the accept/first-ACK critical path."""
    try:
        if not chat_api().chat_realtime.is_connection_registered(connection_id):
            return
        snapshot = await chat_api()._run_chat_call(
            chat_api().chat_service.get_realtime_snapshot,
            current_user_id=int(user_id),
        )
        if not chat_api().chat_realtime.is_connection_registered(connection_id):
            return
        await chat_api().chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.snapshot",
            payload=snapshot,
        )
    except Exception:
        pass
    if first_connection:
        try:
            from backend.chat.realtime_publisher import schedule_presence_updated

            schedule_presence_updated(int(user_id))
        except Exception:
            pass


@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    current_user: Optional[User] = None
    try:
        current_user = await get_current_user_from_websocket(websocket)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        ensure_user_permission(current_user, PERM_CHAT_READ)
    except Exception as exc:
        await chat_api()._deny_ws_handshake(websocket, exc)
        return

    connection_id = ""
    session_watchdog = None
    close_code: Optional[int] = None
    close_reason = ""
    watchdog_close: dict = {}
    try:
        connection_id, first_connection = await chat_api().chat_realtime.connect(
            websocket, user_id=int(current_user.id)
        )
    except Exception:
        await websocket.close(code=1011)
        return

    try:
        # Minimal ready first — do not await DB/presence before the client can send.
        await chat_api().chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.connected",
            payload={
                "connection_id": connection_id,
                "user_id": int(current_user.id),
            },
        )
        asyncio.create_task(
            _ws_post_connect_bootstrap(
                connection_id=connection_id,
                user_id=int(current_user.id),
                first_connection=bool(first_connection),
            ),
            name=f"chat-ws-bootstrap:{connection_id}",
        )
        if not chat_api()._ws_is_connected(websocket):
            return

        ws_access_token = extract_websocket_access_token(websocket)
        ws_auth_lease = WsSessionLease(ws_access_token, user_id=int(current_user.id))
        session_watchdog = asyncio.create_task(
            _ws_session_watchdog(
                websocket, ws_auth_lease,
                connection_id=connection_id,
                interval_sec=max(0.1, float(chat_api().CHAT_WS_SESSION_REVALIDATE_SEC)),
                outcome=watchdog_close,
            ),
            name=f"chat-ws-session:{connection_id}",
        )
        ws_token_check_counter = 0
        last_token_check_at = time.monotonic()
        while True:
            if not chat_api()._ws_is_connected(websocket) or not chat_api().chat_realtime.is_connection_registered(connection_id):
                break
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect as exc:
                close_code = getattr(exc, "code", None)
                close_reason = "peer closed"
                break
            except RuntimeError as exc:
                if "WebSocket is not connected" in str(exc):
                    close_reason = "socket lost"
                    break
                raise

            allowed, retry_after_ms, rate_limiter = chat_api().chat_realtime.allow_ws_command(int(current_user.id))
            if not allowed:
                chat_api().chat_realtime.record_rate_limited(connection_id)
                rate_limited_request_id = None
                try:
                    rate_limited_envelope = json.loads(raw_message)
                    if isinstance(rate_limited_envelope, dict):
                        rate_limited_request_id = (
                            str(rate_limited_envelope.get("request_id") or "").strip() or None
                        )
                except Exception:
                    rate_limited_request_id = None
                await chat_api().chat_realtime.send_to_connection(
                    connection_id,
                    event_type="error",
                    payload={
                        "code": "rate_limited",
                        "retry_after_ms": int(retry_after_ms),
                    },
                    request_id=rate_limited_request_id,
                )
                # Rate-limit identical warnings (QueueHandler when installed).
                try:
                    from backend.chat.async_logging import allow_rate_limited

                    if allow_rate_limited(f"ws_rate:{int(current_user.id)}", interval_sec=5.0):
                        chat_api().logger.warning(
                            "Chat websocket rate limited: user_id=%s connection_id=%s violations=%s",
                            int(current_user.id),
                            connection_id,
                            int(rate_limiter.violations),
                        )
                except Exception:
                    pass
                if int(rate_limiter.violations) >= chat_api().CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS:
                    # 4429 is reconnectable with backoff; 1008 stays for policy/auth.
                    close_code = 4429
                    close_reason = f"chat websocket rate limit exceeded retry_after_ms={int(retry_after_ms)}"
                    await websocket.close(code=4429, reason=close_reason)
                    break
                continue

            try:
                envelope = json.loads(raw_message)
            except (TypeError, ValueError, json.JSONDecodeError):
                await chat_api().chat_realtime.send_error(
                    connection_id,
                    detail="Invalid websocket payload",
                    code="invalid_payload",
                )
                continue

            if not isinstance(envelope, dict):
                await chat_api().chat_realtime.send_error(
                    connection_id,
                    detail="Invalid websocket payload",
                    code="invalid_payload",
                )
                continue

            ws_token_check_counter += 1
            now_monotonic = time.monotonic()
            if (
                ws_token_check_counter >= chat_api().CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL
                or (now_monotonic - last_token_check_at) >= float(chat_api().CHAT_WS_SESSION_REVALIDATE_SEC)
            ):
                ws_token_check_counter = 0
                last_token_check_at = now_monotonic
                try:
                    lease_status = await run_in_threadpool(ws_auth_lease.revalidate)
                except Exception:
                    close_code = 1011
                    close_reason = "session validation unavailable"
                    await websocket.close(code=1011, reason="session validation unavailable")
                    break
                if lease_status == "dead":
                    try:
                        from backend.services.auth_session_metrics import note
                        note("websocket_4401_session_expired")
                    except Exception:
                        pass
                    close_code = 4401
                    close_reason = "session expired"
                    await websocket.close(code=4401, reason="session expired")
                    break
                if lease_status == "grace":
                    await chat_api().chat_realtime.send_control(
                        connection_id,
                        event_type="chat.auth.required",
                        payload={"retry_after_ms": ws_auth_lease.grace_remaining_ms() or _WS_AUTH_REQUIRED_HINT_MS},
                    )
                if not current_user.is_active:
                    close_code = 4400
                    close_reason = "inactive user"
                    await websocket.close(code=4400, reason="inactive user")
                    break

            message_type = str((envelope or {}).get("type") or "").strip()
            request_id = str((envelope or {}).get("request_id") or "").strip() or None
            conversation_id = str((envelope or {}).get("conversation_id") or "").strip() or None
            payload = (envelope or {}).get("payload")
            if not isinstance(payload, dict):
                payload = {}

            if message_type == "chat.auth":
                # In-socket re-auth (D5/W8): fresh access token or ws_ticket
                # extends the lease; otherwise the socket still dies on 4401.
                # R-W8-1: a store error must not tear the loop down — reject.
                try:
                    auth_ok = await run_in_threadpool(ws_auth_lease.apply_auth_payload, payload)
                except Exception:
                    auth_ok = False
                await chat_api().chat_realtime.send_control(
                    connection_id,
                    event_type="chat.auth.ok" if auth_ok else "chat.auth.rejected",
                    request_id=request_id,
                )
                continue

            if message_type not in {"chat.typing", "chat.ping"}:
                chat_api().chat_realtime.touch_presence(connection_id)

            try:
                await dispatch_chat_ws_command(
                    current_user=current_user,
                    connection_id=connection_id,
                    message_type=message_type,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    payload=payload,
                )
            except Exception as exc:
                if isinstance(exc, HTTPException):
                    detail = str(exc.detail or "Command failed")
                elif isinstance(exc, (ValueError, PermissionError)):
                    detail = str(exc) or "Command failed"
                else:
                    detail = "Command failed"
                # Explicit client-facing rejections get stable codes so the
                # web client can skip its HTTP fallback (R3); transient faults
                # (timeouts, write-slot contention) stay "command_failed".
                if isinstance(exc, PermissionError):
                    error_code = "forbidden"
                elif isinstance(exc, ValueError):
                    error_code = "validation_error"
                elif isinstance(exc, HTTPException):
                    status_code = int(exc.status_code or 500)
                    if status_code in (401, 403):
                        error_code = "forbidden"
                    elif status_code < 500:
                        error_code = "validation_error"
                    else:
                        error_code = "command_failed"
                else:
                    error_code = "command_failed"
                # #region agent log
                try:
                    from backend.chat.send_audit import audit_send_trace

                    audit_send_trace(
                        trace_id="ws",
                        stage="command_failed",
                        elapsed_ms=0.0,
                        message_type=message_type,
                        exc_type=type(exc).__name__,
                        exc=str(exc)[:240],
                        user_id=int(getattr(current_user, "id", 0) or 0),
                        conversation_id=(conversation_id or "")[:64],
                    )
                except Exception:
                    pass
                # #endregion
                try:
                    from backend.chat.async_logging import allow_rate_limited

                    if allow_rate_limited(f"ws_cmd_fail:{message_type}", interval_sec=5.0):
                        chat_api().logger.exception(
                            "Chat websocket command failed: type=%s user_id=%s conversation_id=%s",
                            message_type,
                            int(getattr(current_user, "id", 0) or 0),
                            conversation_id,
                        )
                except Exception:
                    pass
                await chat_api().chat_realtime.send_error(
                    connection_id,
                    detail=detail,
                    code=error_code,
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
    except WebSocketDisconnect as exc:
        close_code = getattr(exc, "code", None)
        close_reason = "peer closed"
        try:
            from backend.chat.async_logging import allow_rate_limited

            if allow_rate_limited(f"ws_disc:{int(current_user.id) if current_user else 0}", interval_sec=10.0):
                chat_api().logger.info(
                    "Chat websocket disconnected: user_id=%s connection_id=%s code=%s",
                    int(current_user.id) if current_user is not None else 0,
                    connection_id,
                    getattr(exc, "code", None),
                )
        except Exception:
            pass
    finally:
        if session_watchdog is not None:
            session_watchdog.cancel()
            await asyncio.gather(session_watchdog, return_exceptions=True)
        disconnect_state = chat_api().chat_realtime.disconnect(
            connection_id,
            # The watchdog closes the socket server-side: its code/reason beat
            # whatever WebSocketDisconnect reports afterwards (usually "peer closed").
            close_code=watchdog_close.get("close_code") if watchdog_close.get("close_code") is not None else close_code,
            close_reason=str(watchdog_close.get("close_reason") or "") or close_reason,
        )
        if disconnect_state.get("last_connection"):
            try:
                from backend.chat.realtime_publisher import schedule_presence_updated

                schedule_presence_updated(int(disconnect_state.get("user_id") or 0))
            except Exception:
                pass
