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
            chat_api.chat_service.get_realtime_snapshot,
            current_user_id=int(current_user.id),
        )
        await chat_api.chat_realtime.send_to_connection(
            connection_id,
            event_type="chat.snapshot",
            payload=snapshot,
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
        client_message_id = chat_api._normalize_text(payload.get("client_message_id")) or None
        from backend.chat.send_audit import audit_send_trace, new_trace_id

        trace_id = new_trace_id()
        wall_ts_ms = int(time.time() * 1000)
        # ws_frame_received ≈ moment Python got the command (not TCP arrival).
        audit_send_trace(
            trace_id=trace_id,
            stage="ws_frame_received",
            elapsed_ms=0.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            request_id=str(request_id or "")[:64],
            wall_ts_ms=wall_ts_ms,
        )
        audit_send_trace(
            trace_id=trace_id,
            stage="command_dispatch_started",
            elapsed_ms=0.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            wall_ts_ms=wall_ts_ms,
        )
        # Keep legacy alias for existing SLO aggregators.
        audit_send_trace(
            trace_id=trace_id,
            stage="websocket_received",
            elapsed_ms=0.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            request_id=str(request_id or "")[:64],
        )
        message, write_meta = await chat_api._run_chat_write_call_with_meta(
            chat_api.chat_service.send_message,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            body=body_text,
            body_format=chat_api._normalize_text(payload.get("body_format")) or "plain",
            client_message_id=payload.get("client_message_id"),
            reply_to_message_id=payload.get("reply_to_message_id"),
            defer_push_notifications=True,
            send_trace_id=trace_id,
            write_job_type="send",
        )
        write_ms = (time.perf_counter() - command_started_at) * 1000.0
        stage_metrics = {}
        if isinstance(write_meta, dict):
            stage_metrics = dict(write_meta.get("send_stage_metrics") or {})
            audit_send_trace(
                trace_id=trace_id,
                stage="write_pool_wait",
                elapsed_ms=float(write_meta.get("write_pool_wait_ms") or 0.0),
                client_message_id=(client_message_id or "")[:80],
                chat_id=str(conversation_id or "")[:64],
                sender_id=int(current_user.id),
            )
        for stage_name in (
            "db_pool_acquired_ms",
            "db_checkout_wait_ms",
            "membership_ms",
            "sequence_ms",
            "seq_claim_ms",
            "message_insert_ms",
            "conversation_touch_ms",
            "outbox_insert_ms",
            "prepare_write_ms",
            "flush_ms",
            "commit_ms",
            "send_received_to_db_commit_ms",
            "serialize_ms",
            "ack_payload_prepare_ms",
            "message_reload_ms",
            "sender_load_ms",
            "participants_load_ms",
            "attachment_load_ms",
            "preview_build_ms",
            "schema_validate_ms",
            "json_encode_ms",
            "conversation_lock_hold_ms",
            "seq_update_total_ms",
            "insert_total_ms",
            "pre_commit_gap_ms",
            "commit_total_ms",
            "invalidate_ms",
            "notifications_ms",
            "second_db_session",
        ):
            if stage_name in stage_metrics:
                audit_send_trace(
                    trace_id=trace_id,
                    stage=stage_name.replace("_ms", ""),
                    elapsed_ms=float(stage_metrics.get(stage_name) or 0.0),
                    client_message_id=(client_message_id or "")[:80],
                    chat_id=str(conversation_id or "")[:64],
                    sender_id=int(current_user.id),
                    message_id=str(message.get("id") or "")[:64],
                    member_count=int(stage_metrics.get("member_count") or 0),
                )
        deferred_notifications = chat_api._pop_deferred_chat_notifications(message)
        deferred_realtime_publish = chat_api._pop_deferred_realtime_publish(message)
        deferred_delivery_outbox = chat_api._pop_deferred_delivery_outbox(message)
        deferred_presence = None
        if isinstance(message, dict):
            deferred_presence = message.pop("_deferred_presence_activity", None)
        # Attach real sender display from the authenticated user (no APP DB lookup).
        # Lean stub sender (empty/user-N) breaks hub toasts and OS notification titles.
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
            deferred_realtime_publish["trace_id"] = trace_id
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
        # commit → critical enqueue → ACK → background
        commit_done_at = time.perf_counter()
        fast_publish = await chat_api._enqueue_critical_message_created(
            conversation_id=conversation_id,
            message_id=str(message.get("id") or ""),
            deferred_realtime_publish=deferred_realtime_publish,
        )
        enqueue_ms = (time.perf_counter() - commit_done_at) * 1000.0
        audit_send_trace(
            trace_id=trace_id,
            stage="recipient_event_enqueued",
            elapsed_ms=enqueue_ms,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        audit_send_trace(
            trace_id=trace_id,
            stage="db_commit_to_event_enqueued",
            elapsed_ms=enqueue_ms,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        ok_started_at = time.perf_counter()
        audit_send_trace(
            trace_id=trace_id,
            stage="sender_ack_enqueued",
            elapsed_ms=(ok_started_at - commit_done_at) * 1000.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        from backend.chat.lean_ack import build_lean_command_ok_payload

        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
            payload=build_lean_command_ok_payload(
                message=message if isinstance(message, dict) else {},
                conversation_id=conversation_id,
            ),
        )
        ok_ms = (time.perf_counter() - ok_started_at) * 1000.0
        audit_send_trace(
            trace_id=trace_id,
            stage="sender_ack_socket_write_finished",
            elapsed_ms=ok_ms,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        audit_send_trace(
            trace_id=trace_id,
            stage="db_commit_to_sender_ack",
            elapsed_ms=(time.perf_counter() - commit_done_at) * 1000.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        audit_send_trace(
            trace_id=trace_id,
            stage="command_ok_sent",
            elapsed_ms=ok_ms,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
        )
        audit_send_trace(
            trace_id=trace_id,
            stage="total_until_ack",
            elapsed_ms=(time.perf_counter() - command_started_at) * 1000.0,
            client_message_id=(client_message_id or "")[:80],
            chat_id=str(conversation_id or "")[:64],
            sender_id=int(current_user.id),
            message_id=str(message.get("id") or "")[:64],
            write_ms=round(write_ms, 1),
            ok_ms=round(ok_ms, 1),
            write_pool_wait_ms=float((write_meta or {}).get("write_pool_wait_ms") or 0.0)
            if isinstance(write_meta, dict)
            else 0.0,
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
            client_message_id=client_message_id,
            has_reply=int(bool(chat_api._normalize_text(payload.get("reply_to_message_id")))),
            write_ms=f"{write_ms:.1f}",
            ok_ms=f"{ok_ms:.1f}",
            trace_id=trace_id,
        )
        chat_api._schedule_chat_message_side_effects(
            conversation_id=conversation_id,
            message_id=message["id"],
            deferred_notifications=deferred_notifications,
            deferred_realtime_publish=deferred_realtime_publish,
            deferred_presence=deferred_presence if isinstance(deferred_presence, dict) else None,
            deferred_delivery_outbox=deferred_delivery_outbox,
            fast_publish=fast_publish,
            critical_already_enqueued=True,
        )
        chat_api._schedule_ai_run_for_message(
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message["id"],
            effective_database_id=chat_api._normalize_text(payload.get("database_id")) or None,
            conversation_kind=str((write_meta or {}).get("conversation_kind") or ""),
        )
        return

    if message_type == "chat.mark_read":
        if not conversation_id:
            raise ValueError("conversation_id is required")
        message_id = str(payload.get("message_id") or "").strip()
        if not message_id:
            raise ValueError("message_id is required")
        command_started_at = time.perf_counter()
        read_payload = await chat_api._run_chat_mark_read_call(
            chat_api.chat_service.mark_read,
            current_user_id=int(current_user.id),
            conversation_id=conversation_id,
            message_id=message_id,
        )
        changed = bool((read_payload or {}).get("changed"))
        clear_hub = bool((read_payload or {}).get("clear_hub_notifications"))
        client_payload = dict(read_payload or {})
        client_payload.pop("changed", None)
        client_payload.pop("clear_hub_notifications", None)
        await chat_api.chat_realtime.send_command_ok(
            connection_id,
            request_id=request_id,
            conversation_id=conversation_id,
            payload=client_payload,
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
        if changed:
            chat_api._schedule_chat_background_task(
                chat_api._publish_message_read_after_mark_read(
                    conversation_id=conversation_id,
                    message_id=message_id,
                    reader_user_id=int(current_user.id),
                    read_at=read_payload.get("read_at"),
                ),
                label="publish_message_read",
            )
        if clear_hub:
            chat_api._schedule_chat_background_task(
                chat_api._clear_hub_notifications_after_mark_read(
                    conversation_id=conversation_id,
                    reader_user_id=int(current_user.id),
                ),
                label="clear_hub_notifications_after_mark_read",
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
