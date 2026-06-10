"""Dispatch chat notification side effects."""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime
import time
from typing import Any, Iterator

from sqlalchemy import select

from backend.chat.models import ChatPushOutbox
from backend.chat.utils import normalize_text as _normalize_text


@dataclass
class ChatNotificationDispatchResult:
    hub_created: bool = False
    push_created: bool = False
    hub_notifications_ms: float = 0.0
    push_notifications_ms: float = 0.0


class ChatNotificationDispatcher:
    """Owns notification transport side effects for chat messages."""

    def __init__(self, *, hub_service: Any, push_service: Any) -> None:
        self._hub_service = hub_service
        self._push_service = push_service

    @contextmanager
    def open_hub_connection(self) -> Iterator[Any | None]:
        with ExitStack() as exit_stack:
            hub_conn = None
            hub_lock = getattr(self._hub_service, "_lock", None)
            hub_connect = getattr(self._hub_service, "_connect", None)
            if hub_lock is not None:
                exit_stack.enter_context(hub_lock)
            if callable(hub_connect):
                try:
                    hub_conn = exit_stack.enter_context(hub_connect())
                except Exception:
                    hub_conn = None
            yield hub_conn

    def upsert_push_outbox_job(
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
        normalized_channel = _normalize_text(channel) or "chat"
        existing = session.execute(
            select(ChatPushOutbox).where(
                ChatPushOutbox.message_id == _normalize_text(message_id),
                ChatPushOutbox.recipient_user_id == int(recipient_user_id),
                ChatPushOutbox.channel == normalized_channel,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return False
        session.add(
            ChatPushOutbox(
                message_id=_normalize_text(message_id),
                conversation_id=_normalize_text(conversation_id),
                recipient_user_id=int(recipient_user_id),
                channel=normalized_channel,
                is_mention=bool(is_mention),
                title=_normalize_text(title) or "Новое сообщение в чате",
                body=_normalize_text(body) or "Откройте чат, чтобы посмотреть сообщение.",
                status="queued",
                attempt_count=0,
                next_attempt_at=now,
                last_error=None,
                created_at=now,
                updated_at=now,
            )
        )
        return True

    def dispatch(
        self,
        *,
        session,
        hub_conn: Any | None,
        recipient_user_id: int,
        conversation_id: str,
        message_id: str,
        event_type: str,
        title: str,
        body: str,
        defer_push_notifications: bool,
        outbox_now: datetime,
    ) -> ChatNotificationDispatchResult:
        result = ChatNotificationDispatchResult()
        notification_started_at = time.perf_counter()
        try:
            self._hub_service._create_notification(
                recipient_user_id=int(recipient_user_id),
                event_type=_normalize_text(event_type),
                title=title,
                body=body,
                entity_type="chat",
                entity_id=_normalize_text(conversation_id),
                conn=hub_conn,
            )
            result.hub_notifications_ms = (time.perf_counter() - notification_started_at) * 1000.0
            result.hub_created = True
        except Exception:
            return result

        if defer_push_notifications:
            result.push_created = self.upsert_push_outbox_job(
                session=session,
                recipient_user_id=int(recipient_user_id),
                conversation_id=conversation_id,
                message_id=message_id,
                channel="chat",
                title=title,
                body=body,
                is_mention=_normalize_text(event_type) == "chat.mention",
                now=outbox_now,
            )
            return result

        push_started_at = time.perf_counter()
        try:
            self._push_service.send_chat_message_notification(
                recipient_user_id=int(recipient_user_id),
                conversation_id=conversation_id,
                message_id=message_id,
                title=title,
                body=body,
            )
            result.push_notifications_ms = (time.perf_counter() - push_started_at) * 1000.0
            result.push_created = True
        except Exception:
            return result
        return result
