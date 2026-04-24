from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from anyio import to_thread

from backend.chat.realtime import chat_realtime
from backend.chat.service import chat_service


CHAT_EVENT_SCOPE_INBOX = "inbox"
CHAT_EVENT_SCOPE_CONVERSATION = "conversation"
CHAT_EVENT_SCOPE_BOTH = "both"


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


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


async def build_message_created_event_jobs(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int] | None = None,
) -> list[ChatRealtimeEventJob]:
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        member_ids = await _run_chat_call(
            chat_service.get_conversation_member_ids,
            conversation_id=normalized_conversation_id,
        )
        member_ids = sorted({
            int(item)
            for item in list(member_ids or [])
            if int(item) > 0
        })
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
    jobs: list[ChatRealtimeEventJob] = []
    for member_user_id in member_ids:
        message_payload = messages_by_user.get(member_user_id)
        if isinstance(message_payload, dict):
            jobs.append(
                ChatRealtimeEventJob(
                    event_type="chat.message.created",
                    target_scope=CHAT_EVENT_SCOPE_BOTH,
                    target_user_id=int(member_user_id),
                    conversation_id=normalized_conversation_id,
                    message_id=normalized_message_id,
                    payload=message_payload,
                    dedupe_key=f"message_created:{normalized_message_id}:{int(member_user_id)}",
                )
            )
        conversation_payload = conversation_updates_by_user.get(int(member_user_id))
        if isinstance(conversation_payload, dict):
            jobs.append(
                ChatRealtimeEventJob(
                    event_type="chat.conversation.updated",
                    target_scope=CHAT_EVENT_SCOPE_INBOX,
                    target_user_id=int(member_user_id),
                    conversation_id=normalized_conversation_id,
                    message_id=normalized_message_id,
                    payload=conversation_payload,
                    dedupe_key=f"conversation_updated:{normalized_message_id}:{int(member_user_id)}",
                )
            )
        unread_payload = unread_summaries_by_user.get(int(member_user_id))
        if isinstance(unread_payload, dict):
            jobs.append(
                ChatRealtimeEventJob(
                    event_type="chat.unread.summary",
                    target_scope=CHAT_EVENT_SCOPE_INBOX,
                    target_user_id=int(member_user_id),
                    conversation_id=normalized_conversation_id,
                    message_id=normalized_message_id,
                    payload=unread_payload,
                    dedupe_key=f"unread_summary:{normalized_message_id}:{int(member_user_id)}",
                )
            )
    return jobs


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
    jobs = await build_message_created_event_jobs(
        conversation_id=conversation_id,
        message_id=message_id,
    )
    if not jobs:
        return
    await asyncio.gather(*(publish_event_job(job) for job in jobs))
