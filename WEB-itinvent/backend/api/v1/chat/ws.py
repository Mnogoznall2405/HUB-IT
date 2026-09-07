"""Chat WebSocket endpoint."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import (
    assert_access_token_still_valid,
    ensure_user_permission,
    extract_websocket_access_token,
    get_current_user_from_websocket,
)
from backend.chat.ws_commands import dispatch_chat_ws_command
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()


async def _ws_session_watchdog(websocket: WebSocket, token: Optional[str], *, interval_sec: float) -> None:
    """Revalidate even if the peer only receives frames or a command is slow."""
    while True:
        await asyncio.sleep(interval_sec)
        try:
            await run_in_threadpool(assert_access_token_still_valid, token, touch_session=False)
        except HTTPException:
            await websocket.close(code=4401, reason="session expired")
            return
        except Exception:
            # A store outage is a transport failure, not a definitive logout.
            await websocket.close(code=1011, reason="session validation unavailable")
            return


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
        session_watchdog = asyncio.create_task(
            _ws_session_watchdog(
                websocket, ws_access_token,
                interval_sec=max(0.1, float(chat_api().CHAT_WS_SESSION_REVALIDATE_SEC)),
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
            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                if "WebSocket is not connected" in str(exc):
                    break
                raise

            allowed, retry_after_ms, rate_limiter = chat_api().chat_realtime.allow_ws_command(int(current_user.id))
            if not allowed:
                chat_api().chat_realtime.record_rate_limited(connection_id)
                await chat_api().chat_realtime.send_to_connection(
                    connection_id,
                    event_type="error",
                    payload={
                        "code": "rate_limited",
                        "retry_after_ms": int(retry_after_ms),
                    },
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
                    await websocket.close(code=1008, reason="chat websocket rate limit exceeded")
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
                    await run_in_threadpool(assert_access_token_still_valid, ws_access_token)
                except HTTPException:
                    try:
                        from backend.services.auth_session_metrics import note
                        note("websocket_4401_session_expired")
                    except Exception:
                        pass
                    await websocket.close(code=4401, reason="session expired")
                    break
                if not current_user.is_active:
                    await websocket.close(code=4400, reason="inactive user")
                    break

            message_type = str((envelope or {}).get("type") or "").strip()
            request_id = str((envelope or {}).get("request_id") or "").strip() or None
            conversation_id = str((envelope or {}).get("conversation_id") or "").strip() or None
            payload = (envelope or {}).get("payload")
            if not isinstance(payload, dict):
                payload = {}

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
                    code="command_failed",
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
    except WebSocketDisconnect as exc:
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
        disconnect_state = chat_api().chat_realtime.disconnect(connection_id)
        if disconnect_state.get("last_connection"):
            try:
                from backend.chat.realtime_publisher import schedule_presence_updated

                schedule_presence_updated(int(disconnect_state.get("user_id") or 0))
            except Exception:
                pass
