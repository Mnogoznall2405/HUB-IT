from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from anyio import to_thread

from backend.chat.realtime import chat_realtime
from backend.chat.service import chat_service
from backend.chat.utils import normalize_text as _normalize_text


CHAT_EVENT_SCOPE_INBOX = "inbox"
CHAT_EVENT_SCOPE_CONVERSATION = "conversation"
CHAT_EVENT_SCOPE_BOTH = "both"



async def _run_chat_call(func, *args, **kwargs):
    return await to_thread.run_sync(lambda: func(*args, **kwargs))


@dataclass(frozen=True, slots=True)
class ChatRealtimeEventJob:
    event_type: str
    target_scope: str
    target_user_id: int
    conversation_id: str | None = None
    message_id: str | None = None
    payload: dict[str, Any] | None = None
    dedupe_key: str | None = None


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
        conversation_id=_normalize_text(conversation_id),
        user_ids=normalized_user_ids,
    )
    normalized_reason = _normalize_text(reason, "updated")
    return {
        int(user_id): {
            "conversation": payload,
            "reason": normalized_reason,
        }
        for user_id, payload in dict(conversation_payloads or {}).items()
        if int(user_id) > 0 and isinstance(payload, dict)
    }


async def _resolve_member_ids(
    *,
    conversation_id: str,
    member_user_ids: list[int] | None = None,
) -> list[int]:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if member_ids:
        return member_ids
    member_ids = await _run_chat_call(
        chat_service.get_conversation_member_ids,
        conversation_id=conversation_id,
    )
    return sorted({
        int(item)
        for item in list(member_ids or [])
        if int(item) > 0
    })


def _message_created_jobs(
    *,
    conversation_id: str,
    message_id: str,
    member_ids: list[int],
    messages_by_user: dict[int, dict],
) -> list[ChatRealtimeEventJob]:
    jobs: list[ChatRealtimeEventJob] = []
    for member_user_id in member_ids:
        message_payload = messages_by_user.get(member_user_id)
        if not isinstance(message_payload, dict):
            continue
        jobs.append(
            ChatRealtimeEventJob(
                event_type="chat.message.created",
                target_scope=CHAT_EVENT_SCOPE_INBOX,
                target_user_id=int(member_user_id),
                conversation_id=conversation_id,
                message_id=message_id,
                payload=message_payload,
                dedupe_key=f"message_created:{message_id}:{int(member_user_id)}",
            )
        )
    return jobs


def _inbox_meta_jobs(
    *,
    conversation_id: str,
    message_id: str,
    member_ids: list[int],
    conversation_updates_by_user: dict[int, dict],
    unread_summaries_by_user: dict[int, dict],
) -> list[ChatRealtimeEventJob]:
    jobs: list[ChatRealtimeEventJob] = []
    for member_user_id in member_ids:
        conversation_payload = conversation_updates_by_user.get(int(member_user_id))
        if isinstance(conversation_payload, dict):
            jobs.append(
                ChatRealtimeEventJob(
                    event_type="chat.conversation.updated",
                    target_scope=CHAT_EVENT_SCOPE_INBOX,
                    target_user_id=int(member_user_id),
                    conversation_id=conversation_id,
                    message_id=message_id,
                    payload=conversation_payload,
                    dedupe_key=f"conversation_updated:{message_id}:{int(member_user_id)}",
                )
            )
        unread_payload = unread_summaries_by_user.get(int(member_user_id))
        if isinstance(unread_payload, dict):
            jobs.append(
                ChatRealtimeEventJob(
                    event_type="chat.unread.summary",
                    target_scope=CHAT_EVENT_SCOPE_INBOX,
                    target_user_id=int(member_user_id),
                    conversation_id=conversation_id,
                    message_id=message_id,
                    payload=unread_payload,
                    dedupe_key=f"unread_summary:{message_id}:{int(member_user_id)}",
                )
            )
    return jobs


async def build_message_created_event_jobs(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int] | None = None,
) -> list[ChatRealtimeEventJob]:
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    member_ids = await _resolve_member_ids(
        conversation_id=normalized_conversation_id,
        member_user_ids=member_user_ids,
    )
    if not normalized_conversation_id or not normalized_message_id or not member_ids:
        return []

    messages_by_user = await _run_chat_call(
        chat_service.get_messages_for_users,
        message_id=normalized_message_id,
        user_ids=member_ids,
    )
    conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _get_conversation_updates_for_users(
            conversation_id=normalized_conversation_id,
            user_ids=member_ids,
            reason="message_created",
        ),
        _get_unread_summaries(member_ids),
    )
    return [
        *_message_created_jobs(
            conversation_id=normalized_conversation_id,
            message_id=normalized_message_id,
            member_ids=member_ids,
            messages_by_user=messages_by_user,
        ),
        *_inbox_meta_jobs(
            conversation_id=normalized_conversation_id,
            message_id=normalized_message_id,
            member_ids=member_ids,
            conversation_updates_by_user=conversation_updates_by_user,
            unread_summaries_by_user=unread_summaries_by_user,
        ),
    ]


async def publish_event_job(job: ChatRealtimeEventJob | dict[str, Any]) -> None:
    payload = job.payload if isinstance(job, ChatRealtimeEventJob) else dict(job.get("payload") or {})
    event_type = _normalize_text(job.event_type if isinstance(job, ChatRealtimeEventJob) else job.get("event_type"))
    target_scope = _normalize_text(
        job.target_scope if isinstance(job, ChatRealtimeEventJob) else job.get("target_scope"),
        CHAT_EVENT_SCOPE_INBOX,
    ).lower()
    target_user_id = int(job.target_user_id if isinstance(job, ChatRealtimeEventJob) else job.get("target_user_id") or 0)
    conversation_id = _normalize_text(job.conversation_id if isinstance(job, ChatRealtimeEventJob) else job.get("conversation_id"))
    if not event_type or target_user_id <= 0:
        return
    if target_scope in {CHAT_EVENT_SCOPE_INBOX, CHAT_EVENT_SCOPE_BOTH}:
        await chat_realtime.publish_inbox_event(
            user_id=target_user_id,
            conversation_id=conversation_id or None,
            event_type=event_type,
            payload=payload,
        )
    if target_scope in {CHAT_EVENT_SCOPE_CONVERSATION, CHAT_EVENT_SCOPE_BOTH} and conversation_id:
        await chat_realtime.publish_conversation_event(
            user_id=target_user_id,
            conversation_id=conversation_id,
            event_type=event_type,
            payload=payload,
        )


async def publish_message_created_after_send(*, conversation_id: str, message_id: str) -> None:
    """Publish chat.message.created first; inbox meta (conversation/unread) can lag."""
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    member_ids = await _resolve_member_ids(conversation_id=normalized_conversation_id)
    if not normalized_conversation_id or not normalized_message_id or not member_ids:
        return

    messages_by_user = await _run_chat_call(
        chat_service.get_messages_for_users,
        message_id=normalized_message_id,
        user_ids=member_ids,
    )
    message_jobs = _message_created_jobs(
        conversation_id=normalized_conversation_id,
        message_id=normalized_message_id,
        member_ids=member_ids,
        messages_by_user=messages_by_user,
    )
    if message_jobs:
        await asyncio.gather(*(publish_event_job(job) for job in message_jobs))

    # Sidebar preview / unread badges — after the message is already visible in open threads.
    conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _get_conversation_updates_for_users(
            conversation_id=normalized_conversation_id,
            user_ids=member_ids,
            reason="message_created",
        ),
        _get_unread_summaries(member_ids),
    )
    meta_jobs = _inbox_meta_jobs(
        conversation_id=normalized_conversation_id,
        message_id=normalized_message_id,
        member_ids=member_ids,
        conversation_updates_by_user=conversation_updates_by_user,
        unread_summaries_by_user=unread_summaries_by_user,
    )
    if meta_jobs:
        await asyncio.gather(*(publish_event_job(job) for job in meta_jobs))


async def publish_message_created_fast_after_send(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int] | None = None,
    message_payload: dict[str, Any] | None = None,
    sender_user_id: int = 0,
) -> dict[str, Any]:
    """Deliver chat.message.created via conversation-room broadcast (one fan-out)."""
    import time

    started_at = time.perf_counter()
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    member_ids = [
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    ]
    if not member_ids:
        member_ids = await _resolve_member_ids(conversation_id=normalized_conversation_id)
    if not normalized_conversation_id or not normalized_message_id:
        return {"member_count": 0, "message_jobs": 0, "publish_ms": 0.0, "room_connections": 0}

    if isinstance(message_payload, dict) and message_payload:
        room_payload = dict(message_payload)
        used_prebuilt = 1
    else:
        messages_by_user = await _run_chat_call(
            chat_service.get_messages_for_users,
            message_id=normalized_message_id,
            user_ids=member_ids or [int(sender_user_id)],
        )
        # Prefer a non-sender view for the shared room payload.
        room_payload = None
        for user_id, payload in dict(messages_by_user or {}).items():
            if int(user_id) != int(sender_user_id) and isinstance(payload, dict):
                room_payload = dict(payload)
                break
        if room_payload is None:
            for payload in dict(messages_by_user or {}).values():
                if isinstance(payload, dict):
                    room_payload = dict(payload)
                    break
        used_prebuilt = 0
    if not isinstance(room_payload, dict) or not room_payload:
        return {
            "member_count": len(member_ids),
            "message_jobs": 0,
            "publish_ms": round((time.perf_counter() - started_at) * 1000.0, 1),
            "member_ids": member_ids,
            "conversation_id": normalized_conversation_id,
            "message_id": normalized_message_id,
            "used_prebuilt": used_prebuilt,
            "room_connections": 0,
        }

    # Shared room payload for peers only. Sender already has command_ok/HTTP with is_own=true;
    # echoing is_own=false to the sender flips their bubble to the wrong side.
    room_payload["is_own"] = False
    room_payload["delivery_status"] = None
    room_payload["read_by_count"] = 0
    if not room_payload.get("conversation_id"):
        room_payload["conversation_id"] = normalized_conversation_id
    if not room_payload.get("id"):
        room_payload["id"] = normalized_message_id
    if int(sender_user_id or 0) > 0 and not isinstance(room_payload.get("sender"), dict):
        room_payload["sender_user_id"] = int(sender_user_id)

    room_started_at = time.perf_counter()
    room_connections = await chat_realtime.publish_conversation_room_event(
        conversation_id=normalized_conversation_id,
        event_type="chat.message.created",
        payload=room_payload,
        exclude_user_id=int(sender_user_id or 0),
        distribute=False,
    )
    room_ms = (time.perf_counter() - room_started_at) * 1000.0
    # Sidebar-only users need inbox. Peers already in the conversation room get the
    # room broadcast — skip duplicate inbox enqueue for them (cuts fan-out under load).
    room_subscriber_ids = chat_realtime.conversation_room_user_ids(
        conversation_id=normalized_conversation_id
    )
    inbox_targets = [
        int(user_id)
        for user_id in member_ids
        if int(user_id) > 0
        and int(user_id) != int(sender_user_id or 0)
        and int(user_id) not in room_subscriber_ids
    ]
    inbox_published = 0
    inbox_ms = 0.0
    if inbox_targets:
        inbox_started_at = time.perf_counter()
        inbox_published = await chat_realtime.publish_user_events(
            user_ids=inbox_targets,
            conversation_id=normalized_conversation_id,
            event_type="chat.message.created",
            payload=room_payload,
        )
        inbox_ms = (time.perf_counter() - inbox_started_at) * 1000.0
    publish_ms = (time.perf_counter() - started_at) * 1000.0
    # #region agent log
    try:
        from backend.chat.send_audit import audit_send_trace

        audit_send_trace(
            trace_id="broadcast",
            stage="room_broadcast_detail",
            elapsed_ms=float(publish_ms),
            sender_user_id=int(sender_user_id),
            member_count=len(member_ids),
            room_connections=int(room_connections),
            inbox_published=int(inbox_published),
            used_prebuilt=used_prebuilt,
            room_ms=round(room_ms, 1),
            inbox_ms=round(inbox_ms, 1),
        )
    except Exception:
        pass
    # #endregion
    return {
        "member_count": len(member_ids),
        "message_jobs": 1 if (room_connections or inbox_published) else 0,
        "publish_ms": round(publish_ms, 1),
        "room_ms": round(room_ms, 1),
        "inbox_ms": round(inbox_ms, 1),
        "member_ids": member_ids,
        "conversation_id": normalized_conversation_id,
        "message_id": normalized_message_id,
        "used_prebuilt": used_prebuilt,
        "room_connections": int(room_connections),
        "inbox_published": int(inbox_published),
    }


async def publish_inbox_meta_after_message_created(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int] | None = None,
) -> None:
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    member_ids = await _resolve_member_ids(
        conversation_id=normalized_conversation_id,
        member_user_ids=member_user_ids,
    )
    if not normalized_conversation_id or not normalized_message_id or not member_ids:
        return
    conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _get_conversation_updates_for_users(
            conversation_id=normalized_conversation_id,
            user_ids=member_ids,
            reason="message_created",
        ),
        _get_unread_summaries(member_ids),
    )
    meta_jobs = _inbox_meta_jobs(
        conversation_id=normalized_conversation_id,
        message_id=normalized_message_id,
        member_ids=member_ids,
        conversation_updates_by_user=conversation_updates_by_user,
        unread_summaries_by_user=unread_summaries_by_user,
    )
    if meta_jobs:
        await asyncio.gather(*(publish_event_job(job) for job in meta_jobs))
