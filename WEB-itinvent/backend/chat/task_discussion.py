"""Task-linked corporate chat discussions."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import select

from backend.chat.db import ChatConfigurationError, chat_session, get_chat_database_url, is_chat_enabled
from backend.chat.models import ChatConversation, ChatConversationUserState, ChatMember
from backend.chat.utils import normalize_text as _normalize_text
from backend.config import config
from backend.services.hub_service import hub_service
from backend.services.user_service import user_service


logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def is_task_discussion_chat_enabled() -> bool:
    return bool(is_chat_enabled() and config.chat.task_discussion_enabled)


def _task_discussion_title(task: dict[str, Any]) -> str:
    title = _normalize_text(task.get("title")) or "Без названия"
    prefix = "Задача: "
    max_len = 255
    combined = f"{prefix}{title}"
    if len(combined) <= max_len:
        return combined
    return combined[: max_len - 1].rstrip() + "…"


def _serialize_discussion(
    *,
    conversation: ChatConversation,
    task: Optional[dict[str, Any]],
    created: bool,
) -> dict[str, Any]:
    task_id = _normalize_text(getattr(conversation, "task_id", None)) or None
    return {
        "conversation_id": conversation.id,
        "created": bool(created),
        "title": _normalize_text(conversation.title) or _task_discussion_title(task or {}),
        "task_id": task_id,
        "task_title": _normalize_text((task or {}).get("title")) or None,
        "task_status": _normalize_text((task or {}).get("status")) or None,
        "kind": "task",
    }


def _get_task_for_actor(*, task_id: str, actor_user_id: int) -> dict[str, Any]:
    raw_user = user_service.get_by_id(int(actor_user_id)) or {}
    is_admin = _normalize_text(raw_user.get("role")).lower() == "admin"
    task = hub_service.get_task(task_id, user_id=int(actor_user_id), is_admin=is_admin)
    if task is None:
        raise LookupError("Task not found")
    return task


def _participant_user_ids(task: dict[str, Any]) -> list[int]:
    return sorted(hub_service._task_participant_user_ids(task, include_delegates=True))


def get_task_discussion(*, task_id: str, actor_user_id: int) -> Optional[dict[str, Any]]:
    if not is_task_discussion_chat_enabled():
        return None
    normalized_task_id = _normalize_text(task_id)
    if not normalized_task_id:
        return None
    task = _get_task_for_actor(task_id=normalized_task_id, actor_user_id=int(actor_user_id))
    with chat_session() as session:
        conversation = session.execute(
            select(ChatConversation).where(ChatConversation.task_id == normalized_task_id).limit(1)
        ).scalar_one_or_none()
        if conversation is None:
            return {
                "conversation_id": None,
                "created": False,
                "title": _task_discussion_title(task),
                "task_id": normalized_task_id,
                "task_title": _normalize_text(task.get("title")) or None,
                "task_status": _normalize_text(task.get("status")) or None,
                "kind": "task",
            }
        return _serialize_discussion(conversation=conversation, task=task, created=False)


def ensure_task_discussion(*, task_id: str, actor_user_id: int) -> dict[str, Any]:
    if not is_task_discussion_chat_enabled():
        raise RuntimeError("Task discussion chat is disabled")
    normalized_task_id = _normalize_text(task_id)
    if not normalized_task_id:
        raise ValueError("task_id is required")
    task = _get_task_for_actor(task_id=normalized_task_id, actor_user_id=int(actor_user_id))
    participant_ids = _participant_user_ids(task)
    if int(actor_user_id) not in participant_ids:
        raise PermissionError("Task is not available to the current user")

    owner_user_id = int(task.get("created_by_user_id") or actor_user_id)
    if owner_user_id not in participant_ids:
        owner_user_id = int(actor_user_id)

    with chat_session() as session:
        existing = session.execute(
            select(ChatConversation).where(ChatConversation.task_id == normalized_task_id).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            sync_task_discussion_members(task_id=normalized_task_id, task=task, session=session)
            session.commit()
            try:
                from backend.chat.service import chat_service

                for user_id in participant_ids:
                    chat_service._invalidate_user_cache(user_id=int(user_id), bucket="conversations")
            except Exception:
                pass
            return _serialize_discussion(conversation=existing, task=task, created=False)

        now = _utc_now()
        conversation = ChatConversation(
            id=str(uuid4()),
            kind="task",
            title=_task_discussion_title(task),
            task_id=normalized_task_id,
            direct_key=None,
            created_by_user_id=owner_user_id,
            created_at=now,
            updated_at=now,
        )
        session.add(conversation)
        session.flush()

        for user_id in participant_ids:
            member = user_service.get_by_id(int(user_id))
            if not member or not bool(member.get("is_active", True)):
                continue
            session.add(
                ChatMember(
                    conversation_id=conversation.id,
                    user_id=int(user_id),
                    member_role="owner" if int(user_id) == owner_user_id else "member",
                    joined_at=now,
                )
            )
            session.add(
                ChatConversationUserState(
                    conversation_id=conversation.id,
                    user_id=int(user_id),
                    opened_at=now if int(user_id) == int(actor_user_id) else None,
                    updated_at=now,
                )
            )
        session.commit()
        session.refresh(conversation)
        try:
            from backend.chat.service import chat_service

            for user_id in participant_ids:
                chat_service._invalidate_user_cache(user_id=int(user_id), bucket="conversations")
        except Exception:
            pass
        return _serialize_discussion(conversation=conversation, task=task, created=True)


def sync_task_discussion_members(
    *,
    task_id: str,
    task: Optional[dict[str, Any]] = None,
    session=None,
) -> None:
    if not is_task_discussion_chat_enabled():
        return
    normalized_task_id = _normalize_text(task_id)
    if not normalized_task_id:
        return

    def _sync(active_session) -> None:
        conversation = active_session.execute(
            select(ChatConversation).where(ChatConversation.task_id == normalized_task_id).limit(1)
        ).scalar_one_or_none()
        if conversation is None:
            return
        resolved_task = task
        if resolved_task is None:
            try:
                resolved_task = hub_service.get_task(
                    normalized_task_id,
                    user_id=int(conversation.created_by_user_id or 0),
                    is_admin=True,
                )
            except (LookupError, PermissionError):
                resolved_task = None
        if not resolved_task:
            return
        participant_ids = set(_participant_user_ids(resolved_task))
        owner_user_id = int(resolved_task.get("created_by_user_id") or conversation.created_by_user_id or 0)
        now = _utc_now()
        existing_members = active_session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.left_at.is_(None),
            )
        ).scalars().all()
        existing_ids = {int(item.user_id) for item in existing_members}
        for user_id in participant_ids:
            if user_id in existing_ids:
                continue
            member = user_service.get_by_id(int(user_id))
            if not member or not bool(member.get("is_active", True)):
                continue
            active_session.add(
                ChatMember(
                    conversation_id=conversation.id,
                    user_id=int(user_id),
                    member_role="owner" if int(user_id) == owner_user_id else "member",
                    joined_at=now,
                )
            )
            active_session.add(
                ChatConversationUserState(
                    conversation_id=conversation.id,
                    user_id=int(user_id),
                    opened_at=None,
                    updated_at=now,
                )
            )
        conversation.updated_at = now
        conversation.title = _task_discussion_title(resolved_task)

    if session is not None:
        _sync(session)
        return

    with chat_session() as owned_session:
        _sync(owned_session)
        owned_session.commit()


async def publish_task_discussion_updated(
    *,
    task_id: str,
    task: Optional[dict[str, Any]] = None,
) -> None:
    """Refresh task-chat metadata for every participant without failing the task mutation."""
    if not is_task_discussion_chat_enabled():
        return
    normalized_task_id = _normalize_text(task_id)
    if not normalized_task_id:
        return

    try:
        sync_task_discussion_members(task_id=normalized_task_id, task=task)
        with chat_session() as session:
            conversation = session.execute(
                select(ChatConversation).where(ChatConversation.task_id == normalized_task_id).limit(1)
            ).scalar_one_or_none()
            if conversation is None:
                return
            conversation_id = str(conversation.id)
            member_ids = sorted({
                int(item)
                for item in session.execute(
                    select(ChatMember.user_id).where(
                        ChatMember.conversation_id == conversation_id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
                if int(item) > 0
            })
        if not member_ids:
            return

        from backend.chat.realtime import chat_realtime
        from backend.chat.service import chat_service

        chat_service._invalidate_conversation_views_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
        )
        summaries = chat_service.get_conversation_summaries_for_users(
            conversation_id=conversation_id,
            user_ids=member_ids,
        )
        await asyncio.gather(*(
            chat_realtime.publish_inbox_event(
                user_id=int(user_id),
                event_type="chat.conversation.updated",
                conversation_id=conversation_id,
                payload={
                    "conversation": summary,
                    "reason": "task_updated",
                },
            )
            for user_id, summary in summaries.items()
        ))
    except Exception:
        logger.warning(
            "Failed to publish task discussion update task_id=%s",
            normalized_task_id,
            exc_info=True,
        )


async def delete_task_discussion(*, task_id: str) -> Optional[dict[str, Any]]:
    """Delete the task-owned conversation and notify every former participant."""
    try:
        if not get_chat_database_url():
            return None
    except ChatConfigurationError:
        return None
    normalized_task_id = _normalize_text(task_id)
    if not normalized_task_id:
        return None

    from backend.chat.realtime import chat_realtime
    from backend.chat.service import chat_service

    deleted = chat_service.delete_task_conversation(task_id=normalized_task_id)
    if not deleted:
        return None

    conversation_id = _normalize_text(deleted.get("conversation_id"))
    member_user_ids_set: set[int] = set()
    for item in list(deleted.get("member_user_ids") or []):
        try:
            user_id = int(item)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            member_user_ids_set.add(user_id)
    member_user_ids = sorted(member_user_ids_set)
    if not conversation_id or not member_user_ids:
        return deleted

    unread_summaries = chat_service.get_unread_summaries(user_ids=member_user_ids)

    async def _publish_removed(user_id: int) -> None:
        await chat_realtime.publish_inbox_event(
            user_id=user_id,
            event_type="chat.conversation.removed",
            conversation_id=conversation_id,
            payload={
                "conversation_id": conversation_id,
                "reason": "task_deleted",
            },
        )
        unread_payload = unread_summaries.get(user_id)
        if isinstance(unread_payload, dict):
            await chat_realtime.publish_inbox_event(
                user_id=user_id,
                event_type="chat.unread.summary",
                payload=unread_payload,
            )

    try:
        await asyncio.gather(*(_publish_removed(user_id) for user_id in member_user_ids))
    except Exception:
        logger.warning(
            "Task discussion deleted but realtime removal publish failed task_id=%s conversation_id=%s",
            normalized_task_id,
            conversation_id,
            exc_info=True,
        )
    return deleted


def send_task_discussion_message(*, task_id: str, actor_user_id: int, body: str) -> dict[str, Any]:
    from backend.chat.service import chat_service

    discussion = ensure_task_discussion(task_id=task_id, actor_user_id=int(actor_user_id))
    conversation_id = _normalize_text(discussion.get("conversation_id"))
    if not conversation_id:
        raise RuntimeError("Task discussion conversation is missing")
    return chat_service.send_message(
        current_user_id=int(actor_user_id),
        conversation_id=conversation_id,
        body=body,
    )
