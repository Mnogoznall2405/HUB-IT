"""Complaints about messages of a group (``chat_message_reports``).

Any active member may report another member's message; the owner and moderators of the group see
the open reports and close them (dismiss, or resolve after deleting the message). A message deleted
in the meantime drops out of the open list by itself. Reporting the same message twice is a no-op, so
a double click or a retry never piles reports up. The table arrives with an explicit release
migration: until it exists reporting answers with a clear 400 and the chat is otherwise unaffected.
The group action journal records "reported" / "report closed" without the message text.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import func, select

from backend.chat.chat_group_admin import record_group_action
from backend.chat.db import chat_session
from backend.chat.models import ChatMessage, ChatMessageReport, utcnow
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService

REPORT_REASONS = ("spam", "abuse", "illegal", "other")
REPORT_RESOLUTIONS = ("dismissed", "resolved")
MAX_COMMENT_LENGTH = 500
MAX_OPEN_REPORTS_LISTED = 100
TABLE_MISSING_MESSAGE = "Жалобы станут доступны после обновления базы данных"
MANAGERS_ONLY_MESSAGE = "Жалобы разбирают только владелец и модераторы группы"

_TABLE_RECHECK_SEC = 30.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}


def reset_runtime_state() -> None:
    """Forget the cached table probe (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def reports_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if the table is missing.
        with session.begin_nested():
            session.execute(select(ChatMessageReport.id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


class ChatMessageReports:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def report_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_id: str,
        reason: str,
        comment: Optional[str] = None,
    ) -> dict[str, Any]:
        normalized_reason = _normalize_text(reason).lower()
        if normalized_reason not in REPORT_REASONS:
            raise ValueError("Недопустимая причина жалобы")
        normalized_comment = _normalize_text(comment)[:MAX_COMMENT_LENGTH] or None
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if _normalize_text(conversation.kind) != "group":
                raise ValueError("Жалобы доступны только в группах")
            message = session.get(ChatMessage, _normalize_text(message_id))
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")
            if bool(message.is_deleted):
                raise ValueError("Сообщение уже удалено")
            if self._service._normalize_message_kind(message.kind) == "system":
                raise ValueError("На системное сообщение пожаловаться нельзя")
            if int(message.sender_user_id or 0) == int(current_user_id):
                raise ValueError("Нельзя пожаловаться на своё сообщение")
            if not reports_table_available(session):
                raise ValueError(TABLE_MISSING_MESSAGE)
            existing = session.execute(
                select(ChatMessageReport).where(
                    ChatMessageReport.message_id == message.id,
                    ChatMessageReport.reporter_user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if existing is not None:
                return {"id": existing.id, "status": existing.status, "already_reported": True}
            report = ChatMessageReport(
                id=str(uuid4()),
                conversation_id=conversation.id,
                message_id=message.id,
                reporter_user_id=int(current_user_id),
                reason=normalized_reason,
                comment=normalized_comment,
                status="open",
                created_at=utcnow(),
            )
            session.add(report)
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action="message_reported",
                target_user_id=int(message.sender_user_id or 0) or None,
                details={"reason": normalized_reason, "report_id": report.id},
            )
            session.flush()
            return {"id": report.id, "status": "open", "already_reported": False}

    def list_reports(self, *, current_user_id: int, conversation_id: str) -> dict[str, Any]:
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            self._require_manager(session, conversation, int(current_user_id))
            if not reports_table_available(session):
                return {"items": [], "open_count": 0}
            base = (
                select(ChatMessageReport, ChatMessage)
                .join(ChatMessage, ChatMessage.id == ChatMessageReport.message_id)
                .where(
                    ChatMessageReport.conversation_id == conversation.id,
                    ChatMessageReport.status == "open",
                    ChatMessage.is_deleted.is_(False),
                )
            )
            rows = session.execute(
                base.order_by(ChatMessageReport.created_at.desc()).limit(MAX_OPEN_REPORTS_LISTED)
            ).all()
            open_count = int(
                session.execute(
                    select(func.count(ChatMessageReport.id))
                    .join(ChatMessage, ChatMessage.id == ChatMessageReport.message_id)
                    .where(
                        ChatMessageReport.conversation_id == conversation.id,
                        ChatMessageReport.status == "open",
                        ChatMessage.is_deleted.is_(False),
                    )
                ).scalar_one()
                or 0
            )
            user_ids = {int(report.reporter_user_id) for report, _ in rows} | {
                int(message.sender_user_id or 0) for _, message in rows
            }
            users = self._service._get_users_map(presence_map={}, user_ids=user_ids) if user_ids else {}

            def name(user_id: int) -> str:
                user = users.get(int(user_id)) or {}
                return (
                    _normalize_text(user.get("full_name"))
                    or _normalize_text(user.get("username"))
                    or f"Пользователь {user_id}"
                )

            items = [
                {
                    "id": report.id,
                    "message_id": message.id,
                    "reason": report.reason,
                    "comment": report.comment or "",
                    "created_at": _iso(report.created_at),
                    "reporter_user_id": int(report.reporter_user_id),
                    "reporter_name": name(report.reporter_user_id),
                    "sender_user_id": int(message.sender_user_id or 0),
                    "sender_name": name(message.sender_user_id),
                    "message_preview": (_normalize_text(message.body) or "Сообщение")[:200],
                }
                for report, message in rows
            ]
            return {"items": items, "open_count": open_count}

    def resolve_report(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        report_id: str,
        resolution: str,
    ) -> dict[str, Any]:
        normalized_resolution = _normalize_text(resolution).lower()
        if normalized_resolution not in REPORT_RESOLUTIONS:
            raise ValueError("Недопустимое решение по жалобе")
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            self._require_manager(session, conversation, int(current_user_id))
            if not reports_table_available(session):
                raise ValueError(TABLE_MISSING_MESSAGE)
            report = session.get(ChatMessageReport, _normalize_text(report_id))
            if report is None or report.conversation_id != conversation.id:
                raise LookupError("Report not found")
            if report.status == "open":
                # Every open complaint about the same message is closed together with this one.
                now = utcnow()
                for sibling in session.execute(
                    select(ChatMessageReport).where(
                        ChatMessageReport.message_id == report.message_id,
                        ChatMessageReport.status == "open",
                    )
                ).scalars():
                    sibling.status = normalized_resolution
                    sibling.resolved_by_user_id = int(current_user_id)
                    sibling.resolved_at = now
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action="report_closed",
                    details={"report_id": report.id, "resolution": normalized_resolution},
                )
                session.flush()
            return {"id": report.id, "status": report.status}

    def _require_manager(self, session, conversation, current_user_id: int) -> None:
        try:
            self._service._require_group_manager(
                session=session,
                conversation_id=conversation.id,
                current_user_id=current_user_id,
            )
        except PermissionError as exc:
            raise PermissionError(MANAGERS_ONLY_MESSAGE) from exc
