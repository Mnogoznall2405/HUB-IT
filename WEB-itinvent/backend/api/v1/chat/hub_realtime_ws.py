"""Authenticated, read-only realtime channel for HUB invalidations."""
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
from backend.chat.realtime import chat_realtime
from backend.realtime.hub import (
    HUB_REALTIME_PROTOCOL_VERSION,
    hub_task_presence_room_id,
    hub_user_room_id,
)
from backend.services.authorization_service import PERM_TASKS_MANAGE_ALL, PERM_TASKS_READ, authorization_service
from backend.services.hub_service import hub_service


router = APIRouter()

_MAX_PAYLOAD_BYTES = max(
    1024,
    min(256 * 1024, int(str(os.getenv("HUB_REALTIME_MAX_WS_BYTES", str(32 * 1024)) or "32768"))),
)
_SESSION_REVALIDATE_SEC = max(
    15.0,
    float(os.getenv("HUB_REALTIME_SESSION_REVALIDATE_SEC", "60") or 60),
)
_SESSION_REVALIDATE_COMMANDS = max(
    20,
    int(os.getenv("HUB_REALTIME_SESSION_REVALIDATE_COMMANDS", "200") or 200),
)
_MAX_RATE_LIMIT_VIOLATIONS = max(
    5,
    int(os.getenv("HUB_REALTIME_RATE_LIMIT_VIOLATIONS", "20") or 20),
)
_MAX_TASK_PRESENCE_ROOMS = max(
    1,
    min(16, int(os.getenv("HUB_REALTIME_MAX_TASK_PRESENCE_ROOMS", "4") or 4)),
)


def _is_admin_or_task_manager(user: Any) -> bool:
    role = str(getattr(user, "role", "") or "").strip().lower()
    return role == "admin" or authorization_service.has_permission(
        role,
        PERM_TASKS_MANAGE_ALL,
        use_custom_permissions=bool(getattr(user, "use_custom_permissions", False)),
        custom_permissions=list(getattr(user, "permissions", []) or []),
    )


def _task_presence_collaborator(user: Any, *, connection_id: str) -> dict[str, Any]:
    user_id = int(getattr(user, "id", 0) or 0)
    return {
        "id": user_id,
        "username": str(getattr(user, "username", "") or "").strip()[:160],
        "full_name": str(getattr(user, "full_name", "") or "").strip()[:240],
        "connection_id": str(connection_id or "").strip()[:128],
    }


def _authorize_task_presence(*, task_id: str, user: Any) -> dict[str, Any]:
    ensure_user_permission(user, PERM_TASKS_READ)
    task = hub_service.get_task(
        task_id,
        user_id=int(getattr(user, "id", 0) or 0),
        is_admin=_is_admin_or_task_manager(user),
    )
    if not task:
        raise LookupError("Task not found")
    return task


async def _broadcast_task_presence(
    *,
    task_id: str,
    event_type: str,
    user: Any,
    connection_id: str,
    target_connection_id: str = "",
) -> None:
    await chat_realtime.publish_conversation_room_event(
        conversation_id=hub_task_presence_room_id(task_id),
        event_type=event_type,
        payload={
            "protocol": HUB_REALTIME_PROTOCOL_VERSION,
            "task_id": task_id,
            "connection_id": connection_id,
            "target_connection_id": str(target_connection_id or "").strip()[:128] or None,
            "collaborator": _task_presence_collaborator(user, connection_id=connection_id),
        },
        exclude_connection_id=connection_id,
    )


async def _send_error(
    connection_id: str,
    *,
    detail: str,
    code: str,
    request_id: str | None = None,
) -> None:
    await chat_realtime.send_to_connection(
        connection_id,
        event_type="hub.realtime.error",
        payload={
            "protocol": HUB_REALTIME_PROTOCOL_VERSION,
            "code": str(code or "command_failed")[:80],
            "detail": str(detail or "Realtime command failed")[:500],
        },
        request_id=request_id,
    )


@router.websocket("/hub-realtime/ws")
async def hub_realtime_websocket(websocket: WebSocket):
    current_user: Any = None
    try:
        current_user = await get_current_user_from_websocket(websocket)
        if not current_user.is_active:
            raise HTTPException(status_code=400, detail="Inactive user")
    except Exception as exc:
        await _deny_ws_handshake(websocket, exc)
        return

    connection_id = ""
    room_id = ""
    joined_task_ids: set[str] = set()
    try:
        connection_id, _ = await chat_realtime.connect(
            websocket,
            user_id=int(current_user.id),
            receive_user_events=False,
            track_presence=False,
        )
        room_id = hub_user_room_id(int(current_user.id))
        chat_realtime.subscribe_conversation(connection_id, room_id)
        await chat_realtime.send_to_connection(
            connection_id,
            event_type="hub.realtime.connected",
            payload={
                "protocol": HUB_REALTIME_PROTOCOL_VERSION,
                "connection_id": connection_id,
                "snapshot_required": True,
            },
        )

        access_token = extract_websocket_access_token(websocket)
        command_count = 0
        last_session_check_at = time.monotonic()
        while True:
            try:
                raw_message = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except RuntimeError as exc:
                if "WebSocket is not connected" in str(exc):
                    break
                raise

            if len(raw_message.encode("utf-8")) > _MAX_PAYLOAD_BYTES:
                await websocket.close(code=1009, reason="hub realtime payload too large")
                break

            allowed, retry_after_ms, limiter = chat_realtime.allow_ws_command(int(current_user.id))
            if not allowed:
                chat_realtime.record_rate_limited(connection_id)
                await _send_error(
                    connection_id,
                    detail=f"Too many realtime commands; retry in {retry_after_ms} ms",
                    code="rate_limited",
                )
                if int(limiter.violations) >= _MAX_RATE_LIMIT_VIOLATIONS:
                    await websocket.close(code=1008, reason="hub realtime rate limit exceeded")
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
            if (
                command_count >= _SESSION_REVALIDATE_COMMANDS
                or (now - last_session_check_at) >= _SESSION_REVALIDATE_SEC
            ):
                command_count = 0
                last_session_check_at = now
                try:
                    await run_in_threadpool(assert_access_token_still_valid, access_token)
                except HTTPException:
                    await websocket.close(code=4401, reason="session expired")
                    break
                if not current_user.is_active:
                    await websocket.close(code=4400, reason="inactive user")
                    break
                for joined_task_id in tuple(joined_task_ids):
                    try:
                        await run_in_threadpool(
                            _authorize_task_presence,
                            task_id=joined_task_id,
                            user=current_user,
                        )
                    except Exception:
                        await _broadcast_task_presence(
                            task_id=joined_task_id,
                            event_type="tasks.presence.left",
                            user=current_user,
                            connection_id=connection_id,
                        )
                        chat_realtime.unsubscribe_conversation(
                            connection_id,
                            hub_task_presence_room_id(joined_task_id),
                        )
                        joined_task_ids.discard(joined_task_id)

            message_type = str(envelope.get("type") or "").strip()
            request_id = str(envelope.get("request_id") or "").strip() or None
            payload = envelope.get("payload")
            if not isinstance(payload, dict):
                payload = {}
            if message_type == "hub.realtime.ping":
                await chat_realtime.send_to_connection(
                    connection_id,
                    event_type="hub.realtime.pong",
                    payload={"protocol": HUB_REALTIME_PROTOCOL_VERSION},
                    request_id=request_id,
                )
                for joined_task_id in tuple(joined_task_ids):
                    await _broadcast_task_presence(
                        task_id=joined_task_id,
                        event_type="tasks.presence.heartbeat",
                        user=current_user,
                        connection_id=connection_id,
                    )
                continue
            if message_type == "tasks.presence.join":
                task_id = str(payload.get("task_id") or "").strip()[:128]
                if not task_id:
                    await _send_error(connection_id, detail="Task id is required", code="invalid_command", request_id=request_id)
                    continue
                if task_id not in joined_task_ids and len(joined_task_ids) >= _MAX_TASK_PRESENCE_ROOMS:
                    await _send_error(connection_id, detail="Too many open task presence rooms", code="room_limit", request_id=request_id)
                    continue
                try:
                    await run_in_threadpool(_authorize_task_presence, task_id=task_id, user=current_user)
                except PermissionError:
                    await _send_error(connection_id, detail="Task access denied", code="forbidden", request_id=request_id)
                    continue
                except Exception:
                    await _send_error(connection_id, detail="Task not found", code="not_found", request_id=request_id)
                    continue
                if task_id not in joined_task_ids:
                    task_room_id = hub_task_presence_room_id(task_id)
                    chat_realtime.subscribe_conversation(connection_id, task_room_id)
                    joined_task_ids.add(task_id)
                    await _broadcast_task_presence(
                        task_id=task_id,
                        event_type="tasks.presence.joined",
                        user=current_user,
                        connection_id=connection_id,
                    )
                    await chat_realtime.publish_conversation_room_event(
                        conversation_id=task_room_id,
                        event_type="tasks.presence.sync.requested",
                        payload={
                            "protocol": HUB_REALTIME_PROTOCOL_VERSION,
                            "task_id": task_id,
                            "target_connection_id": connection_id,
                        },
                        exclude_connection_id=connection_id,
                    )
                await chat_realtime.send_to_connection(
                    connection_id,
                    event_type="tasks.presence.snapshot",
                    payload={
                        "protocol": HUB_REALTIME_PROTOCOL_VERSION,
                        "task_id": task_id,
                        "connection_id": connection_id,
                        "collaborators": [],
                    },
                    request_id=request_id,
                )
                continue
            if message_type == "tasks.presence.sync":
                task_id = str(payload.get("task_id") or "").strip()[:128]
                target_connection_id = str(payload.get("target_connection_id") or "").strip()[:128]
                if task_id in joined_task_ids and target_connection_id:
                    await _broadcast_task_presence(
                        task_id=task_id,
                        event_type="tasks.presence.present",
                        user=current_user,
                        connection_id=connection_id,
                        target_connection_id=target_connection_id,
                    )
                continue
            if message_type == "tasks.presence.leave":
                task_id = str(payload.get("task_id") or "").strip()[:128]
                if task_id in joined_task_ids:
                    await _broadcast_task_presence(
                        task_id=task_id,
                        event_type="tasks.presence.left",
                        user=current_user,
                        connection_id=connection_id,
                    )
                    chat_realtime.unsubscribe_conversation(connection_id, hub_task_presence_room_id(task_id))
                    joined_task_ids.discard(task_id)
                continue
            await _send_error(
                connection_id,
                detail="Unsupported realtime command",
                code="invalid_command",
                request_id=request_id,
            )
    except WebSocketDisconnect:
        pass
    finally:
        for joined_task_id in tuple(joined_task_ids):
            try:
                await _broadcast_task_presence(
                    task_id=joined_task_id,
                    event_type="tasks.presence.left",
                    user=current_user,
                    connection_id=connection_id,
                )
            except Exception:
                pass
            chat_realtime.unsubscribe_conversation(connection_id, hub_task_presence_room_id(joined_task_id))
        if room_id and connection_id:
            chat_realtime.unsubscribe_conversation(connection_id, room_id)
        if connection_id:
            chat_realtime.disconnect(connection_id)
