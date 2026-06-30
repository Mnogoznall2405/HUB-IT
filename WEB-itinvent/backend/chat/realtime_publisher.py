"""Realtime inbox publish orchestration for chat events."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional


def _api_common():
    from backend.api.v1.chat import _common as common

    return common


def _pkg():
    return _api_common()._pkg()


def _chat_service():
    return _api_common()._chat_service()


def _chat_realtime():
    return _api_common()._chat_realtime()


async def _run_chat_call(func, /, **kwargs):
    return await _pkg()._run_chat_call(func, **kwargs)


def _log_request_timing(route_name: str, request_id: str, started_at: float, **context: Any) -> None:
    _api_common()._log_request_timing(route_name, request_id, started_at, **context)


async def _publish_unread_summary(user_id: int) -> None:
    payload = await _run_chat_call(
        _chat_service().get_unread_summary,
        current_user_id=int(user_id),
    )
    await _chat_realtime().publish_inbox_event(
        user_id=int(user_id),
        event_type="chat.unread.summary",
        payload=payload,
    )


async def _queue_ai_run_for_message(
    *,
    current_user_id: int,
    conversation_id: str,
    message_id: str,
    effective_database_id: str | None = None,
) -> None:
    from backend.ai_chat.service import ai_chat_service

    await _run_chat_call(
        ai_chat_service.queue_run_for_message,
        current_user_id=int(current_user_id),
        conversation_id=conversation_id,
        trigger_message_id=message_id,
        effective_database_id=effective_database_id,
    )


_UNREAD_SUMMARY_DEBOUNCE_SEC = 0.25
_pending_unread_user_ids: set[int] = set()
_unread_summary_flush_task: asyncio.Task | None = None


async def _flush_pending_unread_summaries() -> None:
    global _unread_summary_flush_task
    await asyncio.sleep(_UNREAD_SUMMARY_DEBOUNCE_SEC)
    user_ids = sorted(_pending_unread_user_ids)
    _pending_unread_user_ids.clear()
    _unread_summary_flush_task = None
    if not user_ids:
        return
    unread_summaries_by_user = await _get_unread_summaries(user_ids)
    for member_user_id, unread_payload in unread_summaries_by_user.items():
        await _chat_realtime().publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.unread.summary",
            payload=unread_payload,
        )


def _queue_unread_summaries(user_ids: list[int]) -> None:
    global _unread_summary_flush_task
    for raw_user_id in list(user_ids or []):
        normalized_user_id = int(raw_user_id)
        if normalized_user_id > 0:
            _pending_unread_user_ids.add(normalized_user_id)
    if _pending_unread_user_ids and (_unread_summary_flush_task is None or _unread_summary_flush_task.done()):
        _unread_summary_flush_task = asyncio.create_task(_flush_pending_unread_summaries())


async def _get_unread_summaries(user_ids: list[int]) -> dict[int, dict]:
    normalized_user_ids = sorted({
        int(item)
        for item in list(user_ids or [])
        if int(item) > 0
    })
    if not normalized_user_ids:
        return {}
    return await _run_chat_call(
        _chat_service().get_unread_summaries,
        user_ids=normalized_user_ids,
    )


async def _publish_conversation_updated(
    *,
    conversation_id: str,
    user_id: int,
    reason: str,
) -> None:
    payload = await _run_chat_call(
        _chat_service().get_conversation_summary,
        current_user_id=int(user_id),
        conversation_id=conversation_id,
    )
    await _chat_realtime().publish_inbox_event(
        user_id=int(user_id),
        event_type="chat.conversation.updated",
        conversation_id=conversation_id,
        payload={
            "conversation": payload,
            "reason": str(reason or "").strip() or "updated",
        },
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
        _chat_service().get_conversation_summaries_for_users,
        conversation_id=conversation_id,
        user_ids=normalized_user_ids,
    )
    normalized_reason = str(reason or "").strip() or "updated"
    return {
        int(user_id): {
            "conversation": payload,
            "reason": normalized_reason,
        }
        for user_id, payload in dict(conversation_payloads or {}).items()
        if int(user_id) > 0 and isinstance(payload, dict)
    }


async def _publish_message_created(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    # Batch fetch message for all members (1 DB query instead of N)
    messages_by_user = await _run_chat_call(
        _chat_service().get_messages_for_users,
        message_id=message_id,
        user_ids=member_ids,
    )

    async def _publish_for_member(member_user_id: int, payload: dict) -> None:
        # Inbox subscribers need the same message-created event so global chat
        # notifications can work without an active conversation subscription.
        await _chat_realtime().publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.message.created",
            conversation_id=conversation_id,
            payload=payload,
        )

    publish_tasks = [
        _publish_for_member(int(member_user_id), payload)
        for member_user_id in member_ids
        if (payload := messages_by_user.get(member_user_id)) is not None
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)
    _queue_unread_summaries(member_ids)


async def _publish_group_conversation_change(
    *,
    conversation_id: str,
    reason: str,
    removed_user_ids: Optional[list[int]] = None,
) -> None:
    member_user_ids = await _run_chat_call(
        _chat_service().get_conversation_member_ids,
        conversation_id=conversation_id,
    )
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    removed_ids = sorted({
        int(item)
        for item in list(removed_user_ids or [])
        if int(item) > 0 and int(item) not in member_ids
    })
    conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _get_conversation_updates_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
            reason=reason,
        ),
        _get_unread_summaries([*member_ids, *removed_ids]),
    )

    async def _publish_for_member(member_user_id: int, payload: dict) -> None:
        await _chat_realtime().publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.conversation.updated",
            conversation_id=conversation_id,
            payload=payload,
        )
        if (unread_payload := unread_summaries_by_user.get(int(member_user_id))) is not None:
            await _chat_realtime().publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    publish_tasks = [
        _publish_for_member(int(member_user_id), payload)
        for member_user_id in member_ids
        if (payload := conversation_updates_by_user.get(int(member_user_id))) is not None
    ]
    for removed_user_id in removed_ids:
        publish_tasks.append(
            _chat_realtime().publish_inbox_event(
                user_id=int(removed_user_id),
                event_type="chat.conversation.removed",
                conversation_id=conversation_id,
                payload={
                    "conversation_id": conversation_id,
                    "reason": str(reason or "").strip() or "removed",
                },
            )
        )
        if (unread_payload := unread_summaries_by_user.get(int(removed_user_id))) is not None:
            publish_tasks.append(
                _chat_realtime().publish_inbox_event(
                    user_id=int(removed_user_id),
                    event_type="chat.unread.summary",
                    payload=unread_payload,
                )
            )
    if publish_tasks:
        await asyncio.gather(*publish_tasks)


async def _publish_deleted_conversation(
    *,
    conversation_id: str,
    member_user_ids: list[int],
    reason: str = "deleted",
) -> None:
    normalized_conversation_id = str(conversation_id or "").strip()
    member_ids_set: set[int] = set()
    for item in list(member_user_ids or []):
        try:
            user_id = int(item)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            member_ids_set.add(user_id)
    member_ids = sorted(member_ids_set)
    if not normalized_conversation_id or not member_ids:
        return
    unread_summaries = await _get_unread_summaries(member_ids)

    async def _publish_for_user(user_id: int) -> None:
        await _chat_realtime().publish_inbox_event(
            user_id=user_id,
            event_type="chat.conversation.removed",
            conversation_id=normalized_conversation_id,
            payload={
                "conversation_id": normalized_conversation_id,
                "reason": str(reason or "").strip() or "deleted",
            },
        )
        unread_payload = unread_summaries.get(user_id)
        if isinstance(unread_payload, dict):
            await _chat_realtime().publish_inbox_event(
                user_id=user_id,
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    await asyncio.gather(*(_publish_for_user(user_id) for user_id in member_ids))


async def _publish_message_deleted(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    messages_by_user = await _run_chat_call(
        _chat_service().get_messages_for_users,
        message_id=message_id,
        user_ids=member_ids,
    )

    async def _publish_for_member(member_user_id: int, payload: dict) -> None:
        await _chat_realtime().publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.message.deleted",
            conversation_id=conversation_id,
            payload=payload,
        )
        await _chat_realtime().publish_conversation_event(
            user_id=int(member_user_id),
            conversation_id=conversation_id,
            event_type="chat.message.deleted",
            payload=payload,
        )

    publish_tasks = [
        _publish_for_member(int(member_user_id), payload)
        for member_user_id in member_ids
        if (payload := messages_by_user.get(member_user_id)) is not None
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)
    _queue_unread_summaries(member_ids)


async def _publish_message_deleted_after_soft_delete(*, conversation_id: str, message_id: str) -> None:
    member_user_ids = await _run_chat_call(
        _chat_service().get_conversation_member_ids,
        conversation_id=conversation_id,
    )
    await _publish_message_deleted(
        conversation_id=conversation_id,
        message_id=message_id,
        member_user_ids=member_user_ids,
    )


async def _publish_message_updated(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    messages_by_user = await _run_chat_call(
        _chat_service().get_messages_for_users,
        message_id=message_id,
        user_ids=member_ids,
    )

    async def _publish_for_member(member_user_id: int, payload: dict) -> None:
        await _chat_realtime().publish_inbox_event(
            user_id=int(member_user_id),
            event_type="chat.message.updated",
            conversation_id=conversation_id,
            payload=payload,
        )
        await _chat_realtime().publish_conversation_event(
            user_id=int(member_user_id),
            conversation_id=conversation_id,
            event_type="chat.message.updated",
            payload=payload,
        )

    publish_tasks = [
        _publish_for_member(int(member_user_id), payload)
        for member_user_id in member_ids
        if (payload := messages_by_user.get(member_user_id)) is not None
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)
    _queue_unread_summaries(member_ids)


async def _publish_message_updated_after_edit(*, conversation_id: str, message_id: str) -> None:
    member_user_ids = await _run_chat_call(
        _chat_service().get_conversation_member_ids,
        conversation_id=conversation_id,
    )
    await _publish_message_updated(
        conversation_id=conversation_id,
        message_id=message_id,
        member_user_ids=member_user_ids,
    )


async def _publish_message_read(
    *,
    conversation_id: str,
    message_id: str,
    member_user_ids: list[int],
    reader_user_id: int,
    read_at: Optional[str],
) -> None:
    member_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0
    })
    if not member_ids:
        return

    read_delta, conversation_updates_by_user, unread_summaries_by_user = await asyncio.gather(
        _run_chat_call(
            _chat_service().get_message_read_delta,
            conversation_id=conversation_id,
            message_id=message_id,
        ),
        _get_conversation_updates_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
            reason="read",
        ),
        _get_unread_summaries(member_ids),
    )

    async def _publish_for_member(member_user_id: int) -> None:
        await _chat_realtime().publish_conversation_event(
            user_id=int(member_user_id),
            conversation_id=conversation_id,
            event_type="chat.message.read",
            payload={
                **dict(read_delta or {}),
                "reader_user_id": int(reader_user_id),
                "read_at": str(read_at or "").strip() or None,
            },
        )
        if (conversation_payload := conversation_updates_by_user.get(int(member_user_id))) is not None:
            await _chat_realtime().publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.conversation.updated",
                conversation_id=conversation_id,
                payload=conversation_payload,
            )
        if (unread_payload := unread_summaries_by_user.get(int(member_user_id))) is not None:
            await _chat_realtime().publish_inbox_event(
                user_id=int(member_user_id),
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    publish_tasks = [
        _publish_for_member(int(member_user_id))
        for member_user_id in member_ids
    ]
    if publish_tasks:
        await asyncio.gather(*publish_tasks)


async def _publish_message_created_after_send(*, conversation_id: str, message_id: str) -> None:
    started_at = time.perf_counter()
    try:
        member_user_ids = await _run_chat_call(
            _chat_service().get_conversation_member_ids,
            conversation_id=conversation_id,
        )
        await _publish_message_created(
            conversation_id=conversation_id,
            message_id=message_id,
            member_user_ids=member_user_ids,
        )
    finally:
        _log_request_timing(
            "publish_message_created",
            "-",
            started_at,
            conversation_id=conversation_id,
            message_id=message_id,
        )


async def _publish_message_read_after_mark_read(
    *,
    conversation_id: str,
    message_id: str,
    reader_user_id: int,
    read_at: Optional[str],
) -> None:
    started_at = time.perf_counter()
    try:
        member_user_ids = await _run_chat_call(
            _chat_service().get_conversation_member_ids,
            conversation_id=conversation_id,
        )
        await _publish_message_read(
            conversation_id=conversation_id,
            message_id=message_id,
            member_user_ids=member_user_ids,
            reader_user_id=reader_user_id,
            read_at=read_at,
        )
    finally:
        _log_request_timing(
            "publish_message_read",
            "-",
            started_at,
            conversation_id=conversation_id,
            message_id=message_id,
            reader_user_id=int(reader_user_id),
        )


async def _publish_presence_updated(user_id: int) -> None:
    if int(user_id or 0) <= 0:
        return
    _chat_service().invalidate_presence_cache(user_id=int(user_id))
    payload = await _run_chat_call(_chat_service().get_presence, user_id=int(user_id))
    await _chat_realtime().publish_presence_event(
        user_id=int(user_id),
        payload={
            "user_id": int(user_id),
            "presence": payload,
        },
    )
