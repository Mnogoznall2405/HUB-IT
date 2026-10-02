"""Scheduled ("Send later") chat messages.

Decision of the user (section 26): a message can be scheduled for a date and time, the sender sees the
scheduled ones of a conversation, may change or cancel them, the server sends them on time through the
existing outbox machinery (no new service) and they appear for everyone as ordinary messages.

Design:
- one table ``chat_scheduled_messages`` (Alembic 20261002_0124);
- the dispatcher is a loop inside the chat process (started next to the event outbox dispatcher in
  ``ChatService.start``); it is safe with several processes: a row is claimed with a conditional
  ``UPDATE ... WHERE status = 'scheduled'`` and the message is sent with the stable
  ``client_message_id = scheduled:<id>``, so a crash between "sent" and "marked sent" never duplicates it;
- the feature is switched by CHAT_SCHEDULED_MESSAGES_ENABLED (0 by default: the table must exist first);
- text messages only (plain/markdown, optional reply); files, polls and AI conversations are not scheduled.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select, update

from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatMember, ChatScheduledMessage
from backend.chat.utils import normalize_text as _normalize_text

logger = logging.getLogger(__name__)

STATUS_SCHEDULED = "scheduled"
STATUS_SENDING = "sending"
STATUS_SENT = "sent"
STATUS_CANCELLED = "cancelled"
STATUS_FAILED = "failed"
EDITABLE_STATUSES = (STATUS_SCHEDULED, STATUS_FAILED)
BODY_MAX_LENGTH = 12000


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _env_flag(name: str, default: str = "0") -> bool:
    return _normalize_text(os.getenv(name), default).lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(_normalize_text(os.getenv(name), str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def scheduled_messages_enabled() -> bool:
    return _env_flag("CHAT_SCHEDULED_MESSAGES_ENABLED", "0")


class ScheduledMessageDisabled(RuntimeError):
    """The feature flag is off (the table may not exist yet)."""


class ChatScheduledMessageService:
    MIN_LEAD_SEC = 30
    MAX_LEAD_DAYS = 366
    MAX_ACTIVE_PER_USER = 100
    MAX_ATTEMPTS = 3
    RETRY_DELAY_SEC = 60
    SENDING_TIMEOUT_SEC = 300

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None

    # ------------------------------------------------------------------ API used by the routes
    @staticmethod
    def _ensure_enabled() -> None:
        if not scheduled_messages_enabled():
            raise ScheduledMessageDisabled("Отложенные сообщения выключены")

    @staticmethod
    def _serialize(row: ChatScheduledMessage) -> dict[str, Any]:
        return {
            "id": row.id,
            "conversation_id": row.conversation_id,
            "body": row.body,
            "body_format": row.body_format,
            "reply_to_message_id": row.reply_to_message_id,
            "scheduled_for": _as_utc(row.scheduled_for).isoformat() if row.scheduled_for else None,
            "status": row.status,
            "attempt_count": int(row.attempt_count or 0),
            "sent_message_id": row.sent_message_id,
            "error_text": row.error_text,
            "created_at": _as_utc(row.created_at).isoformat() if row.created_at else None,
        }

    def _validate_time(self, scheduled_for: datetime) -> datetime:
        value = _as_utc(scheduled_for)
        now = _utc_now()
        if value is None:
            raise ValueError("Укажите дату и время отправки")
        if value < now + timedelta(seconds=self.MIN_LEAD_SEC):
            raise ValueError("Время отправки должно быть в будущем")
        if value > now + timedelta(days=self.MAX_LEAD_DAYS):
            raise ValueError("Отложить можно не дальше, чем на год")
        return value

    @staticmethod
    def _validate_body(body: object) -> str:
        text = _normalize_text(body)
        if not text:
            raise ValueError("Введите текст сообщения")
        if len(text) > BODY_MAX_LENGTH:
            raise ValueError(f"Сообщение длиннее {BODY_MAX_LENGTH} символов")
        return text

    @staticmethod
    def _require_member_of_regular_conversation(session, *, user_id: int, conversation_id: str) -> None:
        conversation = session.get(ChatConversation, conversation_id)
        if conversation is None:
            raise LookupError("Беседа не найдена")
        if _normalize_text(conversation.kind) == "ai":
            raise ValueError("В ИИ-диалогах отложенная отправка недоступна")
        member = session.execute(
            select(ChatMember.id).where(
                ChatMember.conversation_id == conversation_id,
                ChatMember.user_id == int(user_id),
                ChatMember.left_at.is_(None),
            )
        ).first()
        if member is None:
            raise PermissionError("Вы не участник этой беседы")

    def create(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: str,
        scheduled_for: datetime,
        body_format: str = "plain",
        reply_to_message_id: Optional[str] = None,
    ) -> dict[str, Any]:
        self._ensure_enabled()
        text = self._validate_body(body)
        when = self._validate_time(scheduled_for)
        fmt = "markdown" if _normalize_text(body_format).lower() == "markdown" else "plain"
        with chat_session() as session:
            self._require_member_of_regular_conversation(
                session, user_id=int(current_user_id), conversation_id=conversation_id
            )
            active = session.execute(
                select(func.count(ChatScheduledMessage.id)).where(
                    ChatScheduledMessage.sender_user_id == int(current_user_id),
                    ChatScheduledMessage.status.in_((STATUS_SCHEDULED, STATUS_SENDING)),
                )
            ).scalar_one()
            if int(active or 0) >= self.MAX_ACTIVE_PER_USER:
                raise ValueError(f"Не больше {self.MAX_ACTIVE_PER_USER} запланированных сообщений")
            now = _utc_now()
            row = ChatScheduledMessage(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                sender_user_id=int(current_user_id),
                body=text,
                body_format=fmt,
                reply_to_message_id=_normalize_text(reply_to_message_id) or None,
                scheduled_for=when,
                status=STATUS_SCHEDULED,
                attempt_count=0,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            return self._serialize(row)

    def list_for_conversation(self, *, current_user_id: int, conversation_id: str) -> list[dict[str, Any]]:
        self._ensure_enabled()
        with chat_session() as session:
            rows = list(
                session.execute(
                    select(ChatScheduledMessage)
                    .where(
                        ChatScheduledMessage.conversation_id == conversation_id,
                        ChatScheduledMessage.sender_user_id == int(current_user_id),
                        ChatScheduledMessage.status.in_((STATUS_SCHEDULED, STATUS_SENDING, STATUS_FAILED)),
                    )
                    .order_by(ChatScheduledMessage.scheduled_for.asc(), ChatScheduledMessage.created_at.asc())
                ).scalars()
            )
            return [self._serialize(row) for row in rows]

    def _own_row(self, session, *, current_user_id: int, scheduled_id: str) -> ChatScheduledMessage:
        row = session.get(ChatScheduledMessage, _normalize_text(scheduled_id))
        if row is None or int(row.sender_user_id) != int(current_user_id):
            raise LookupError("Запланированное сообщение не найдено")
        return row

    def update(
        self,
        *,
        current_user_id: int,
        scheduled_id: str,
        body: Optional[str] = None,
        scheduled_for: Optional[datetime] = None,
    ) -> dict[str, Any]:
        self._ensure_enabled()
        new_body = self._validate_body(body) if body is not None else None
        new_time = self._validate_time(scheduled_for) if scheduled_for is not None else None
        with chat_session() as session:
            row = self._own_row(session, current_user_id=current_user_id, scheduled_id=scheduled_id)
            if row.status not in EDITABLE_STATUSES:
                raise ValueError("Это сообщение уже отправляется или отправлено")
            values: dict[str, Any] = {"updated_at": _utc_now()}
            if new_body is not None:
                values["body"] = new_body
            if new_time is not None:
                values["scheduled_for"] = new_time
            if row.status == STATUS_FAILED:
                # changing a failed message puts it back in the queue
                values.update(status=STATUS_SCHEDULED, attempt_count=0, error_text=None)
            # conditional write: the dispatcher may have claimed the row a moment ago
            result = session.execute(
                update(ChatScheduledMessage)
                .where(ChatScheduledMessage.id == row.id, ChatScheduledMessage.status.in_(EDITABLE_STATUSES))
                .values(**values)
            )
            if int(result.rowcount or 0) != 1:
                raise ValueError("Это сообщение уже отправляется или отправлено")
            session.expire_all()
            return self._serialize(session.get(ChatScheduledMessage, row.id))

    def cancel(self, *, current_user_id: int, scheduled_id: str) -> dict[str, Any]:
        self._ensure_enabled()
        with chat_session() as session:
            row = self._own_row(session, current_user_id=current_user_id, scheduled_id=scheduled_id)
            result = session.execute(
                update(ChatScheduledMessage)
                .where(ChatScheduledMessage.id == row.id, ChatScheduledMessage.status.in_(EDITABLE_STATUSES))
                .values(status=STATUS_CANCELLED, updated_at=_utc_now())
            )
            if int(result.rowcount or 0) != 1:
                raise ValueError("Это сообщение уже отправляется или отправлено")
            return {"id": row.id, "status": STATUS_CANCELLED}

    # ------------------------------------------------------------------ dispatcher
    def recover_stuck(self) -> int:
        """A worker died between claiming and finishing: put the row back (the stable
        client_message_id makes a second send idempotent)."""
        cutoff = _utc_now() - timedelta(seconds=self.SENDING_TIMEOUT_SEC)
        with chat_session() as session:
            result = session.execute(
                update(ChatScheduledMessage)
                .where(ChatScheduledMessage.status == STATUS_SENDING, ChatScheduledMessage.updated_at < cutoff)
                .values(status=STATUS_SCHEDULED, updated_at=_utc_now())
            )
            return int(result.rowcount or 0)

    def dispatch_due(self, *, batch_size: int = 20) -> int:
        """Send the messages whose time has come. Returns how many were sent."""
        self.recover_stuck()
        now = _utc_now()
        with chat_session() as session:
            due_ids = [
                row_id
                for (row_id,) in session.execute(
                    select(ChatScheduledMessage.id)
                    .where(ChatScheduledMessage.status == STATUS_SCHEDULED, ChatScheduledMessage.scheduled_for <= now)
                    .order_by(ChatScheduledMessage.scheduled_for.asc())
                    .limit(max(1, int(batch_size)))
                ).all()
            ]
        sent = 0
        for scheduled_id in due_ids:
            if self._dispatch_one(scheduled_id):
                sent += 1
        return sent

    def _claim(self, scheduled_id: str) -> Optional[dict[str, Any]]:
        with chat_session() as session:
            result = session.execute(
                update(ChatScheduledMessage)
                .where(ChatScheduledMessage.id == scheduled_id, ChatScheduledMessage.status == STATUS_SCHEDULED)
                .values(
                    status=STATUS_SENDING,
                    attempt_count=ChatScheduledMessage.attempt_count + 1,
                    updated_at=_utc_now(),
                )
            )
            if int(result.rowcount or 0) != 1:
                return None  # cancelled, edited or taken by another process
            row = session.get(ChatScheduledMessage, scheduled_id)
            session.refresh(row)
            return {
                "id": row.id,
                "conversation_id": row.conversation_id,
                "sender_user_id": int(row.sender_user_id),
                "body": row.body,
                "body_format": row.body_format,
                "reply_to_message_id": row.reply_to_message_id,
                "attempt_count": int(row.attempt_count or 0),
            }

    def _dispatch_one(self, scheduled_id: str) -> bool:
        claimed = self._claim(scheduled_id)
        if claimed is None:
            return False
        try:
            from backend.chat.service import chat_service

            message = chat_service.send_message(
                current_user_id=claimed["sender_user_id"],
                conversation_id=claimed["conversation_id"],
                body=claimed["body"],
                body_format=claimed["body_format"],
                client_message_id=f"scheduled:{claimed['id']}",
                reply_to_message_id=claimed["reply_to_message_id"],
                defer_push_notifications=True,
            )
        except Exception as exc:
            self._mark_failed(claimed, exc)
            return False
        # R54: from here on the message IS in the chat. Mark it sent first; what follows (notifications,
        # events) can only be logged - it must never turn a delivered message into "failed" or a retry.
        try:
            self._mark_sent(claimed["id"], message)
        except Exception:
            # The row stays 'sending'; recover_stuck() returns it and the stable client_message_id
            # makes the second send a no-op.
            logger.exception("chat.scheduled_message mark sent failed: id=%s", claimed["id"])
        try:
            self._enqueue_side_effects(conversation_id=claimed["conversation_id"], message=message)
        except Exception:
            logger.exception(
                "chat.scheduled_message side effects failed: id=%s message_id=%s",
                claimed["id"], _normalize_text(message.get("id")),
            )
        return True

    @staticmethod
    def _mark_sent(scheduled_id: str, message: dict[str, Any]) -> None:
        with chat_session() as session:
            session.execute(
                update(ChatScheduledMessage)
                .where(ChatScheduledMessage.id == scheduled_id)
                .values(
                    status=STATUS_SENT,
                    sent_message_id=_normalize_text(message.get("id")) or None,
                    error_text=None,
                    updated_at=_utc_now(),
                )
            )

    def _mark_failed(self, claimed: dict[str, Any], exc: BaseException) -> None:
        # Never log the message text; the exception type and the id are enough.
        logger.warning(
            "chat.scheduled_message send failed: id=%s attempt=%s error=%s",
            claimed["id"], claimed["attempt_count"], type(exc).__name__,
        )
        permanent = isinstance(exc, (PermissionError, LookupError, ValueError))
        give_up = permanent or int(claimed["attempt_count"]) >= self.MAX_ATTEMPTS
        values: dict[str, Any] = {
            "status": STATUS_FAILED if give_up else STATUS_SCHEDULED,
            "error_text": (
                "Не удалось отправить: вы больше не участник беседы или беседа удалена"
                if permanent else
                ("Не удалось отправить сообщение" if give_up else None)
            ),
            "updated_at": _utc_now(),
        }
        if not give_up:
            values["scheduled_for"] = _utc_now() + timedelta(seconds=self.RETRY_DELAY_SEC)
        with chat_session() as session:
            session.execute(
                update(ChatScheduledMessage).where(ChatScheduledMessage.id == claimed["id"]).values(**values)
            )

    @staticmethod
    def _enqueue_side_effects(*, conversation_id: str, message: dict[str, Any]) -> None:
        """Same as after an HTTP send: notifications for the recipients and the message.created
        events through the event outbox (this runs in a worker thread, outside the event loop)."""
        from backend.chat.event_outbox_service import chat_event_outbox_service
        from backend.chat.realtime_side_effects import build_message_created_event_jobs
        from backend.chat.service import chat_service

        message_id = _normalize_text(message.get("id"))
        if not message_id:
            return
        deferred = dict(message.pop("_deferred_chat_notifications", None) or {})
        if deferred:
            try:
                chat_service._create_chat_notifications(
                    sender_user_id=int(deferred.get("sender_user_id") or 0),
                    conversation_id=_normalize_text(deferred.get("conversation_id")),
                    message_id=_normalize_text(deferred.get("message_id")),
                    event_type=_normalize_text(deferred.get("event_type")) or "chat.message_received",
                    title=_normalize_text(deferred.get("title")) or "Новое сообщение в чате",
                    body=_normalize_text(deferred.get("body")),
                    defer_push_notifications=True,
                    mentioned_user_ids=list(deferred.get("mentioned_user_ids") or []),
                )
            except Exception:
                logger.exception("chat.scheduled_message notifications failed: message_id=%s", message_id)
        jobs = asyncio.run(
            build_message_created_event_jobs(conversation_id=conversation_id, message_id=message_id)
        )
        chat_event_outbox_service.enqueue_events([
            {
                "event_type": job.event_type,
                "target_scope": job.target_scope,
                "target_user_id": int(job.target_user_id),
                "conversation_id": job.conversation_id,
                "message_id": job.message_id,
                "payload": job.payload or {},
                "dedupe_key": job.dedupe_key,
            }
            for job in jobs
        ])

    # ------------------------------------------------------------------ background loop
    @property
    def poll_interval_sec(self) -> int:
        return _env_int("CHAT_SCHEDULED_MESSAGES_POLL_SEC", 5, 1, 300)

    @property
    def batch_size(self) -> int:
        return _env_int("CHAT_SCHEDULED_MESSAGES_BATCH_SIZE", 20, 1, 200)

    async def start(self) -> None:
        if not scheduled_messages_enabled():
            return
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="chat-scheduled-messages-dispatcher")

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._stop_event = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.dispatch_due, batch_size=self.batch_size)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("chat.scheduled_messages dispatch iteration failed")
            try:
                assert self._stop_event is not None
                await asyncio.wait_for(self._stop_event.wait(), timeout=float(self.poll_interval_sec))
                return
            except asyncio.TimeoutError:
                continue


chat_scheduled_message_service = ChatScheduledMessageService()
