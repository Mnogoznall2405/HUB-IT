"""Notification planning and dispatch orchestration."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, func, or_, select

from backend.chat.db import chat_session
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatMessageRead,
    ChatMessageReaction,
)
import logging
import time
from typing import Any

from backend.chat.chat_formatting import _iso, _utc_now
from backend.chat.hub_bell_events import (
    is_hub_bell_chat_event,
    is_ordinary_chat_hub_event,
    should_create_hub_bell_notification,
)
from backend.chat.notification_planner import build_chat_notification_recipient_plans
from backend.chat.utils import normalize_text as _normalize_text
from backend.services.notification_preferences_service import (
    chat_notification_channel,
    notification_preferences_service,
)
from backend.services.user_service import user_service

logger = logging.getLogger('backend.chat.service')
runtime_logger = logging.getLogger("uvicorn.error")


def _log_chat_service_timing(operation_name: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"chat.service.{operation_name} took_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    logger.info(message)
    runtime_logger.info(message)

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatNotificationOrchestrator:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _upsert_chat_push_outbox_job(
        self,
        *,
        session,
        recipient_user_id: int,
        conversation_id: str,
        message_id: str,
        channel: str,
        title: str,
        body: str,
        now: datetime,
        is_mention: bool = False,
    ) -> bool:
        return self._service._notification_dispatcher.upsert_push_outbox_job(
            session=session,
            recipient_user_id=int(recipient_user_id),
            conversation_id=conversation_id,
            message_id=message_id,
            channel=channel,
            title=title,
            body=body,
            is_mention=bool(is_mention),
            now=now,
        )

    def _create_chat_notifications(
        self,
        *,
        sender_user_id: int,
        conversation_id: str,
        message_id: str,
        event_type: str,
        title: str,
        body: str,
        defer_push_notifications: bool = False,
        mentioned_user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None,
        create_hub_notifications: bool = True,
        enqueue_push_outbox: bool = True,
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        create_hub = bool(create_hub_notifications)
        enqueue_push = bool(enqueue_push_outbox)
        stats: dict[str, Any] = {
            "member_count": 0,
            "recipient_count": 0,
            "hub_count": 0,
            "push_count": 0,
            "ordinary_hub_rows_created": 0,
            "important_hub_rows_created": 0,
            "ordinary_hub_rows_skipped": 0,
            "prep_ms": 0.0,
            "users_map_ms": 0.0,
            "loop_ms": 0.0,
            "hub_notifications_ms": 0.0,
            "push_notifications_ms": 0.0,
            "create_hub": int(create_hub),
            "enqueue_push": int(enqueue_push),
        }
        if not normalized_conversation_id or not normalized_message_id:
            return stats
        member_ids: list[int] = []
        try:
            with chat_session() as session:
                stage_started_at = time.perf_counter()
                conversation = self._service._require_membership(
                    session=session,
                    conversation_id=normalized_conversation_id,
                    current_user_id=int(sender_user_id),
                )
                member_ids = self._service._conversation_member_ids(session, normalized_conversation_id)
                states = list(
                    session.execute(
                        select(ChatConversationUserState).where(
                            ChatConversationUserState.conversation_id == conversation.id,
                            ChatConversationUserState.user_id.in_(member_ids),
                        )
                    ).scalars()
                ) if member_ids else []
                states_by_user_id = {int(item.user_id): item for item in states}
                preference_channel = chat_notification_channel(conversation.kind)
                candidate_recipient_ids = {
                    int(member_id)
                    for member_id in member_ids
                    if int(member_id) > 0 and int(member_id) != int(sender_user_id)
                }
                try:
                    enabled_recipient_ids = notification_preferences_service.enabled_user_ids(
                        user_ids=candidate_recipient_ids,
                        channel=preference_channel,
                    )
                except Exception:
                    logger.warning(
                        "Failed to resolve chat notification preferences: conversation_id=%s channel=%s",
                        normalized_conversation_id,
                        preference_channel,
                        exc_info=True,
                    )
                    enabled_recipient_ids = set(candidate_recipient_ids)
                stats["prep_ms"] = round((time.perf_counter() - stage_started_at) * 1000.0, 1)
                stats["member_count"] = len(member_ids)

                stage_started_at = time.perf_counter()
                users_by_id = user_service.get_users_map_by_ids([int(sender_user_id)])
                stats["users_map_ms"] = round((time.perf_counter() - stage_started_at) * 1000.0, 1)
                sender = users_by_id.get(int(sender_user_id)) or {}
                sender_name = _normalize_text(sender.get("full_name")) or _normalize_text(sender.get("username")) or "Коллега"
                base_title = _normalize_text(title) or "Новое сообщение в чате"
                base_body = _normalize_text(body)
                recipient_plans = build_chat_notification_recipient_plans(
                    sender_user_id=int(sender_user_id),
                    conversation_kind=conversation.kind,
                    conversation_title=conversation.title,
                    member_ids=sorted(enabled_recipient_ids),
                    states_by_user_id=states_by_user_id,
                    sender_name=sender_name,
                    event_type=event_type,
                    title=base_title,
                    body=base_body,
                    mentioned_user_ids=mentioned_user_ids,
                    default_title=base_title if not _normalize_text(title) else "Новое сообщение в чате",
                    default_group_title="Групповой чат",
                    mention_prefix="Вас упомянули",
                )
                plans_by_user_id = {int(plan.recipient_user_id): plan for plan in recipient_plans}
                outbox_now = _utc_now()

                loop_started_at = time.perf_counter()
                hub_rows: list[dict[str, Any]] = []
                push_jobs: list[dict[str, Any]] = []
                for member_id in member_ids:
                    if int(member_id) <= 0 or int(member_id) == int(sender_user_id):
                        continue
                    plan = plans_by_user_id.get(int(member_id))
                    if plan is None:
                        continue
                    is_mentioned = bool(plan.is_mentioned)
                    stats["recipient_count"] += 1

                    current_body = base_body
                    current_event_type = _normalize_text(event_type)
                    if conversation.kind == "direct":
                        current_title = sender_name
                        if base_title and base_title != "Новое сообщение в чате":
                            current_body = f"[{base_title}] {base_body}"
                    else:
                        group_title = _normalize_text(conversation.title) or "Групповой чат"
                        current_title = group_title
                        prefix = f"[{base_title}] " if base_title and base_title != "Новое сообщение в чате" else ""
                        current_body = f"{prefix}{sender_name}: {base_body}"

                    if is_mentioned:
                        current_event_type = "chat.mention"
                        mention_prefix = "Вас упомянули"
                        if conversation.kind == "direct":
                            current_title = sender_name
                            current_body = f"[{mention_prefix}] {base_body}"
                        else:
                            current_title = f"{mention_prefix}: {current_title}"
                            current_body = f"{sender_name}: {base_body}"

                    # Prefer planner event_type when present (mention upgrade).
                    plan_event_type = _normalize_text(getattr(plan, "event_type", "") or "")
                    if plan_event_type:
                        current_event_type = plan_event_type
                    if getattr(plan, "title", None):
                        current_title = _normalize_text(plan.title) or current_title
                    if getattr(plan, "body", None):
                        current_body = _normalize_text(plan.body) or current_body

                    if enqueue_push:
                        push_jobs.append(
                            {
                                "recipient_user_id": int(member_id),
                                "event_type": current_event_type,
                                "title": current_title,
                                "body": current_body,
                            }
                        )
                    if create_hub and should_create_hub_bell_notification(current_event_type):
                        hub_rows.append(
                            {
                                "recipient_user_id": int(member_id),
                                "event_type": current_event_type,
                                "title": current_title,
                                "body": current_body,
                                "entity_type": "chat",
                                "entity_id": normalized_conversation_id,
                            }
                        )
                        if is_hub_bell_chat_event(current_event_type):
                            stats["important_hub_rows_created"] += 1
                        elif is_ordinary_chat_hub_event(current_event_type):
                            stats["ordinary_hub_rows_created"] += 1
                    elif create_hub and is_ordinary_chat_hub_event(current_event_type):
                        stats["ordinary_hub_rows_skipped"] += 1

                # Push outbox first when deferred so Web Push does not wait on hub/app DB.
                push_started_at = time.perf_counter()
                if enqueue_push:
                    if defer_push_notifications:
                        stats["push_count"] = int(
                            self._service._notification_dispatcher.upsert_push_outbox_jobs_batch(
                                session=session,
                                conversation_id=normalized_conversation_id,
                                message_id=normalized_message_id,
                                channel="chat",
                                jobs=[
                                    {
                                        "recipient_user_id": int(job["recipient_user_id"]),
                                        "title": str(job["title"]),
                                        "body": str(job["body"]),
                                        "is_mention": _normalize_text(job["event_type"]) == "chat.mention",
                                    }
                                    for job in push_jobs
                                ],
                                now=outbox_now,
                            )
                            or 0
                        )
                    else:
                        for job in push_jobs:
                            try:
                                self._service._notification_dispatcher._push_service.send_chat_message_notification(
                                    recipient_user_id=int(job["recipient_user_id"]),
                                    conversation_id=normalized_conversation_id,
                                    message_id=normalized_message_id,
                                    title=str(job["title"]),
                                    body=str(job["body"]),
                                    preference_channel=preference_channel,
                                    conversation_kind=_normalize_text(conversation.kind),
                                    task_id=_normalize_text(getattr(conversation, "task_id", None)) or None,
                                )
                                stats["push_count"] += 1
                            except Exception:
                                pass
                stats["push_notifications_ms"] = round((time.perf_counter() - push_started_at) * 1000.0, 1)

                # One multi-VALUES INSERT for all recipients (not N round-trips).
                hub_started_at = time.perf_counter()
                created = 0
                if create_hub and hub_rows:
                    hub_service = self._service._notification_dispatcher._hub_service
                    with self._service._notification_dispatcher.open_hub_connection() as hub_conn:
                        created = int(hub_service.create_notifications_batch(hub_rows, conn=hub_conn) or 0)
                stats["hub_count"] = created
                stats["hub_notifications_ms"] = round((time.perf_counter() - hub_started_at) * 1000.0, 1)
                # #region agent log
                try:
                    from backend.chat.send_audit import audit_send_trace

                    audit_send_trace(
                        trace_id="hub",
                        stage="hub_batch",
                        elapsed_ms=float(stats["hub_notifications_ms"]),
                        hub_rows=len(hub_rows) if create_hub else 0,
                        hub_count=created,
                        ordinary_hub_rows_created=stats["ordinary_hub_rows_created"],
                        important_hub_rows_created=stats["important_hub_rows_created"],
                        ordinary_hub_rows_skipped=stats["ordinary_hub_rows_skipped"],
                        member_count=stats["member_count"],
                        recipient_count=stats["recipient_count"],
                        single_statement=1,
                        push_deferred=int(bool(defer_push_notifications)),
                        push_first=1,
                    )
                except Exception:
                    pass
                # #endregion
                stats["loop_ms"] = round((time.perf_counter() - loop_started_at) * 1000.0, 1)
        except Exception:
            stats["prep_ms"] = round((time.perf_counter() - started_at) * 1000.0, 1)
            _log_chat_service_timing(
                "create_chat_notifications",
                started_at,
                sender_user_id=int(sender_user_id),
                conversation_id=normalized_conversation_id,
                message_id=normalized_message_id,
                prep_ms=stats["prep_ms"],
                failed=1,
            )
            return stats
        _log_chat_service_timing(
            "create_chat_notifications",
            started_at,
            sender_user_id=int(sender_user_id),
            conversation_id=normalized_conversation_id,
            message_id=normalized_message_id,
            member_count=stats["member_count"],
            recipient_count=stats["recipient_count"],
            hub_count=stats["hub_count"],
            push_count=stats["push_count"],
            ordinary_hub_rows_created=stats["ordinary_hub_rows_created"],
            important_hub_rows_created=stats["important_hub_rows_created"],
            ordinary_hub_rows_skipped=stats["ordinary_hub_rows_skipped"],
            push_deferred=int(bool(defer_push_notifications)),
            prep_ms=stats["prep_ms"],
            users_map_ms=stats["users_map_ms"],
            loop_ms=stats["loop_ms"],
            hub_notifications_ms=stats["hub_notifications_ms"],
            push_notifications_ms=stats["push_notifications_ms"],
        )
        return stats
