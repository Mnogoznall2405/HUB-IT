"""Authenticated WebSocket transport for collaborative task canvases."""
from __future__ import annotations

import json
import os
import time
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import (
    assert_access_token_still_valid,
    ensure_user_permission,
    extract_websocket_access_token,
    get_current_user_from_websocket,
)
from backend.api.v1.chat._common import _deny_ws_handshake
from backend.services.authorization_service import PERM_TASKS_READ
from backend.task_canvas.realtime import (
    TASK_CANVAS_MAX_WS_BYTES,
    TASK_CANVAS_PROTOCOL_VERSION,
    TaskCanvasWsRateLimiter,
    task_canvas_realtime,
)


router = APIRouter()

_SESSION_REVALIDATE_SEC = max(15.0, float(os.getenv("TASK_CANVAS_WS_SESSION_REVALIDATE_SEC", "60") or 60))
_SESSION_REVALIDATE_COMMANDS = max(50, int(os.getenv("TASK_CANVAS_WS_SESSION_REVALIDATE_COMMANDS", "500") or 500))
_ACCESS_REVALIDATE_SEC = max(2.0, float(os.getenv("TASK_CANVAS_WS_ACCESS_REVALIDATE_SEC", "5") or 5))
_MAX_RATE_LIMIT_VIOLATIONS = max(5, int(os.getenv("TASK_CANVAS_WS_RATE_LIMIT_VIOLATIONS", "20") or 20))


async def _send_error(
    connection_id: str,
    *,
    detail: str,
    code: str,
    request_id: str | None = None,
) -> None:
    await task_canvas_realtime.realtime.send_to_connection(
        connection_id,
        event_type="task_canvas.error",
        payload={"code": code, "detail": str(detail or "Task canvas command failed")[:500]},
        request_id=request_id,
    )


@router.websocket("/task-canvas/ws")
async def task_canvas_websocket(websocket: WebSocket, task_id: str):
    current_user: Any = None
    canvas_access: dict[str, Any] | None = None
    try:
        current_user = await get_current_user_from_websocket(websocket)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
        ensure_user_permission(current_user, PERM_TASKS_READ)
        canvas_access = await run_in_threadpool(
            task_canvas_realtime.authorize,
            task_id=task_id,
            user=current_user,
        )
    except Exception as exc:
        await _deny_ws_handshake(websocket, exc)
        return

    connection_id = ""
    room_id = ""
    joined = False
    try:
        connection_id, _ = await task_canvas_realtime.realtime.connect(
            websocket,
            user_id=int(current_user.id),
        )
        room_id = task_canvas_realtime.room_id(task_id)
        task_canvas_realtime.realtime.subscribe_conversation(connection_id, room_id)
        joined = True

        await task_canvas_realtime.realtime.send_to_connection(
            connection_id,
            event_type="task_canvas.connected",
            payload={
                "protocol": TASK_CANVAS_PROTOCOL_VERSION,
                "connection_id": connection_id,
                "collaborator": task_canvas_realtime.collaborator(current_user, connection_id=connection_id),
                **dict(canvas_access or {}),
            },
        )
        await task_canvas_realtime.broadcast_presence(
            task_id=task_id,
            event_type="task_canvas.presence.joined",
            user=current_user,
            connection_id=connection_id,
        )
        await task_canvas_realtime.request_peer_sync(task_id=task_id, connection_id=connection_id)

        limiter = TaskCanvasWsRateLimiter()
        access_token = extract_websocket_access_token(websocket)
        command_count = 0
        last_session_check_at = time.monotonic()
        last_access_check_at = last_session_check_at

        while True:
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                if "WebSocket is not connected" in str(exc):
                    break
                raise

            raw_message_bytes = len(raw_message.encode("utf-8"))
            if raw_message_bytes > TASK_CANVAS_MAX_WS_BYTES:
                await websocket.close(code=1009, reason="task canvas payload too large")
                break

            allowed, retry_after_ms = limiter.allow(cost=max(1.0, raw_message_bytes / (64 * 1024)))
            if not allowed:
                await _send_error(
                    connection_id,
                    detail=f"Too many task canvas updates; retry in {retry_after_ms} ms",
                    code="rate_limited",
                )
                if limiter.violations >= _MAX_RATE_LIMIT_VIOLATIONS:
                    await websocket.close(code=1008, reason="task canvas rate limit exceeded")
                    break
                continue

            try:
                envelope = json.loads(raw_message)
            except (TypeError, ValueError, json.JSONDecodeError):
                await _send_error(connection_id, detail="Invalid websocket payload", code="invalid_payload")
                continue
            if not isinstance(envelope, dict):
                await _send_error(connection_id, detail="Invalid websocket payload", code="invalid_payload")
                continue

            command_count += 1
            now = time.monotonic()
            if command_count >= _SESSION_REVALIDATE_COMMANDS or (now - last_session_check_at) >= _SESSION_REVALIDATE_SEC:
                command_count = 0
                last_session_check_at = now
                try:
                    await run_in_threadpool(assert_access_token_still_valid, access_token)
                except HTTPException:
                    await websocket.close(code=4401, reason="session expired")
                    break

            message_type = str(envelope.get("type") or "").strip()
            request_id = str(envelope.get("request_id") or "").strip() or None
            payload = envelope.get("payload")
            if not isinstance(payload, dict):
                payload = {}

            try:
                if message_type == "task_canvas.ping":
                    await task_canvas_realtime.realtime.send_to_connection(
                        connection_id,
                        event_type="task_canvas.pong",
                        payload={"protocol": TASK_CANVAS_PROTOCOL_VERSION},
                        request_id=request_id,
                    )
                    continue
                if message_type == "task_canvas.cursor":
                    await task_canvas_realtime.broadcast_cursor(
                        task_id=task_id,
                        user=current_user,
                        connection_id=connection_id,
                        payload=payload,
                    )
                    continue
                if message_type == "task_canvas.scene.update":
                    if (now - last_access_check_at) >= _ACCESS_REVALIDATE_SEC:
                        canvas_access = await run_in_threadpool(
                            task_canvas_realtime.authorize,
                            task_id=task_id,
                            user=current_user,
                        )
                        last_access_check_at = now
                    if not bool((canvas_access or {}).get("can_edit")):
                        raise PermissionError("Task canvas is read-only for current user")
                    await task_canvas_realtime.broadcast_scene(
                        task_id=task_id,
                        user=current_user,
                        connection_id=connection_id,
                        payload=payload,
                    )
                    continue
                if message_type == "task_canvas.sync.request":
                    await task_canvas_realtime.request_peer_sync(task_id=task_id, connection_id=connection_id)
                    continue
                raise ValueError("Unsupported task canvas command")
            except PermissionError as exc:
                await _send_error(connection_id, detail=str(exc), code="forbidden", request_id=request_id)
            except (LookupError, ValueError) as exc:
                await _send_error(connection_id, detail=str(exc), code="invalid_command", request_id=request_id)
            except Exception:
                await _send_error(connection_id, detail="Task canvas command failed", code="command_failed", request_id=request_id)
    except WebSocketDisconnect:
        pass
    finally:
        if joined and connection_id:
            try:
                await task_canvas_realtime.broadcast_presence(
                    task_id=task_id,
                    event_type="task_canvas.presence.left",
                    user=current_user,
                    connection_id=connection_id,
                )
            except Exception:
                pass
            if room_id:
                task_canvas_realtime.realtime.unsubscribe_conversation(connection_id, room_id)
            task_canvas_realtime.realtime.disconnect(connection_id)
