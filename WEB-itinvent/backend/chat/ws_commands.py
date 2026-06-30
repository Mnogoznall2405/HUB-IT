"""WebSocket command dispatch for chat."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from fastapi import HTTPException

from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_WRITE


def _api():
    from backend.api.v1.chat._shim import chat_api

    return chat_api()


async def dispatch_chat_ws_command(
    *,
    current_user: User,
    connection_id: str,
    message_type: str,
    request_id: Optional[str],
    conversation_id: Optional[str],
    payload: dict[str, Any],
) -> None:
    """Handle one inbound WS command. Raises on fatal errors; sends WS errors for command failures."""
    from backend.api.deps import ensure_user_permission

    chat_api = _api()

    if message_type == "chat.subscribe_inbox":
        chat_api.chat_realtime.subscribe_inbox(connection_id)
        snapshot = await chat_api._run_chat_call(
            chat_api.chat_service.get_unread_summary,
            current_user_id=int(current_user.id),
        )
        await chat_api.chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.snapshot",
            payload={"unread_summary": snapshot},
            request_id=request_id,
        )
        return

    if message_type == "chat.subscribe_conversation":
        if not conversation_id:
            raise ValueError("conversation_id is required")
        await chat_api._run_chat_call(
            chat_api.chat_service.verify_conversation_access,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
        chat_api.chat_realtime.subscribe_conversation(connection_id, conversation_id)
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
        )
        return

    if message_type == "chat.unsubscribe_conversation":
        if not conversation_id:
            raise ValueError("conversation_id is required")
        chat_api.chat_realtime.unsubscribe_conversation(connection_id, conversation_id)
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
        )
        return

    if message_type == "chat.watch_presence":
        watched_user_ids = chat_api.chat_realtime.watch_presence(
            connection_id,
            payload.get("user_ids") or [],
        )
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            payload={"user_ids": watched_user_ids},
        )
        return

    if message_type == "chat.send_message":
        ensure_user_permission(current_user, PERM_CHAT_WRITE)
        if not conversation_id:
            raise ValueError("conversation_id is required")
        command_started_at = time.perf_counter()
        body_text = chat_api._normalize_text(payload.get("body"))
        message, _ = await chat_api._run_chat_call_with_meta(
            chat_api.chat_service.send_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=body_text,
            body_format=chat_api._normalize_text(payload.get("body_format")) or "plain",
            client_message_id=payload.get("client_message_id"),
            reply_to_message_id=payload.get("reply_to_message_id"),
            defer_push_notifications=True,
        )
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
            payload={
                "message_id": message.get("id"),
                "message": message,
            },
        )
        chat_api._log_ws_command_timing(
            "send_message",
            command_started_at,
            connection_id=connection_id,
            request_id=request_id or "-",
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=chat_api._normalize_text(message.get("id")) or None,
            body_len=len(body_text),
            client_message_id=chat_api._normalize_text(payload.get("client_message_id")) or None,
            has_reply=int(bool(chat_api._normalize_text(payload.get("reply_to_message_id")))),
        )
        chat_api._schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
        )
        chat_api._schedule_ai_run_for_message(
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message["id"],
            effective_database_id=chat_api._normalize_text(payload.get("database_id")) or None,
        )
        return

    if message_type == "chat.mark_read":
        if not conversation_id:
            raise ValueError("conversation_id is required")
        message_id = str(payload.get("message_id") or "").strip()
        if not message_id:
            raise ValueError("message_id is required")
        command_started_at = time.perf_counter()
        read_payload = await chat_api._run_chat_call(
            chat_api.chat_service.mark_read,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
        )
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
            payload=read_payload,
        )
        chat_api._log_ws_command_timing(
            "mark_read",
            command_started_at,
            connection_id=connection_id,
            request_id=request_id or "-",
            user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
        )
        chat_api._schedule_chat_background_task(
            chat_api._publish_message_read_after_mark_read(
                conversation_id=conversation_id,
                message_id=message_id,
                reader_user_id=int(current_user.id),
                read_at=read_payload.get("read_at"),
            ),
            label="publish_message_read",
        )
        return

    if message_type == "chat.typing":
        if not conversation_id:
            raise ValueError("conversation_id is required")
        await chat_api._run_chat_call(
            chat_api.chat_service.verify_conversation_access,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
        )
        is_typing = bool(payload.get("is_typing"))
        if is_typing and not chat_api.chat_realtime.allow_typing_started(
            user_id=int(current_user.id),
            conversation_id=conversation_id,
        ):
            return
        if not is_typing:
            chat_api.chat_realtime.clear_typing_state(
                user_id=int(current_user.id),
                conversation_id=conversation_id,
            )
        member_user_ids = await chat_api._run_chat_call(
            chat_api.chat_service.get_conversation_member_ids,
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
            chat_api.chat_realtime.publish_conversation_event(
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
        return

    if message_type == "chat.ping":
        await chat_api.chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.pong",
            request_id=request_id,
        )
        return

    await chat_api.chat_realtime.send_error(
        connection_id,
        detail=f"Unsupported websocket command: {message_type or 'unknown'}",
        code="unsupported_command",
        request_id=request_id,
        conversation_id=conversation_id,
    )
