"""Chat WebSocket endpoint."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
import json
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from starlette.websockets import WebSocketState

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

@router.websocket("/ws")
async def chat_websocket(websocket: WebSocket):
    current_user: Optional[User] = None
    try:
        current_user = await get_current_user_from_websocket(websocket)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        ensure_user_permission(current_user, PERM_CHAT_READ)
    except Exception as exc:
        await websocket.close(code=chat_api()._ws_error_code(exc))
        return

    connection_id = ""
    try:
        connection_id, first_connection = await chat_api().chat_realtime.connect(websocket, user_id=int(current_user.id))
    except Exception:
        await websocket.close(code=1011)
        return

    try:
        snapshot = await chat_api()._run_chat_call(
            chat_api().chat_service.get_unread_summary,
            current_user_id=int(current_user.id),
        )
        await chat_api().chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.snapshot",
            payload={"unread_summary": snapshot},
        )
        if not chat_api()._ws_is_connected(websocket):
            return
        if first_connection:
            await chat_api()._publish_presence_updated(int(current_user.id))

        ws_access_token = extract_websocket_access_token(websocket)
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
                chat_api().logger.warning(
                    "Chat websocket rate limited: user_id=%s connection_id=%s violations=%s",
                    int(current_user.id),
                    connection_id,
                    int(rate_limiter.violations),
                )
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
                else:
                    detail = "Command failed"
                await chat_api().chat_realtime.send_error(
                    connection_id,
                    detail=detail,
                    code="command_failed",
                    request_id=request_id,
                    conversation_id=conversation_id,
                )
    except WebSocketDisconnect as exc:
        chat_api().logger.info(
            "Chat websocket disconnected: user_id=%s connection_id=%s code=%s",
            int(current_user.id) if current_user is not None else 0,
            connection_id,
            getattr(exc, "code", None),
        )
    finally:
        disconnect_state = chat_api().chat_realtime.disconnect(connection_id)
        if disconnect_state.get("last_connection"):
            try:
                await chat_api()._publish_presence_updated(int(disconnect_state.get("user_id") or 0))
            except Exception:
                pass
