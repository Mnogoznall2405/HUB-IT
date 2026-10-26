"""Export of a conversation history as a text or JSON file.

Who may export: any participant of a direct, notes, task or AI chat; in a group only the owner and
moderators (the history of a group is its members' data, so it is not handed to every member), and
every group export lands in the group action journal (without any message text). Deleted messages are
never exported. Attachments are listed by name and size, their content is not included. The export is
capped (``MAX_EXPORT_MESSAGES``, oldest first) so one request cannot read a whole large chat.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import select

from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES
from backend.chat.chat_group_admin import record_group_action
from backend.chat.chat_thread_read_store import _parse_search_moment
from backend.chat.db import chat_session
from backend.chat.models import ChatMessage, ChatMessageAttachment
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService

MAX_EXPORT_MESSAGES = 20000
EXPORT_FORMATS = ("txt", "json")
GROUP_EXPORT_DENIED_MESSAGE = "Выгружать историю группы могут только владелец и модераторы"

_BATCH = 1000


def _format_moment(value: Optional[datetime]) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _format_size(size: int) -> str:
    value = float(max(0, int(size or 0)))
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if value < 1024 or unit == "ГБ":
            return f"{int(value)} {unit}" if unit == "Б" else f"{value:.1f} {unit}"
        value /= 1024
    return ""


class ChatExport:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def export_conversation(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        export_format: str = "txt",
        created_from: Optional[str] = None,
        created_to: Optional[str] = None,
    ) -> dict[str, Any]:
        normalized_format = _normalize_text(export_format).lower() or "txt"
        if normalized_format not in EXPORT_FORMATS:
            raise ValueError("Недопустимый формат выгрузки")
        from_dt = _parse_search_moment(created_from)
        to_dt = _parse_search_moment(created_to)

        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            is_group = _normalize_text(conversation.kind) == "group"
            if is_group:
                try:
                    self._service._require_group_manager(
                        session=session,
                        conversation_id=conversation.id,
                        current_user_id=int(current_user_id),
                    )
                except PermissionError as exc:
                    raise PermissionError(GROUP_EXPORT_DENIED_MESSAGE) from exc

            rows: list[dict[str, Any]] = []
            truncated = False
            last_seq = -1
            sender_ids: set[int] = set()
            while True:
                query = (
                    select(ChatMessage)
                    .where(
                        ChatMessage.conversation_id == conversation.id,
                        ChatMessage.is_deleted.is_(False),
                        ChatMessage.conversation_seq > last_seq,
                    )
                    .order_by(ChatMessage.conversation_seq.asc(), ChatMessage.id.asc())
                    .limit(_BATCH)
                )
                if from_dt is not None:
                    query = query.where(ChatMessage.created_at >= from_dt)
                if to_dt is not None:
                    query = query.where(ChatMessage.created_at <= to_dt)
                batch = session.execute(query).scalars().all()
                if not batch:
                    break
                attachments_by_message: dict[str, list[ChatMessageAttachment]] = {}
                for attachment in session.execute(
                    select(ChatMessageAttachment).where(
                        ChatMessageAttachment.message_id.in_([item.id for item in batch])
                    )
                ).scalars():
                    attachments_by_message.setdefault(attachment.message_id, []).append(attachment)
                for message in batch:
                    if len(rows) >= MAX_EXPORT_MESSAGES:
                        truncated = True
                        break
                    sender_ids.add(int(message.sender_user_id or 0))
                    rows.append(
                        {
                            "at": message.created_at,
                            "edited_at": message.edited_at,
                            "sender_user_id": int(message.sender_user_id or 0),
                            "kind": _normalize_text(message.kind) or "text",
                            "body": message.body or "",
                            "reply": bool(message.reply_to_message_id),
                            "forwarded": bool(message.forward_from_message_id),
                            "attachments": [
                                {
                                    "file_name": item.file_name,
                                    "kind": item.media_kind or "file",
                                    "size": int(item.file_size or 0),
                                }
                                for item in attachments_by_message.get(message.id, [])
                            ],
                        }
                    )
                if truncated:
                    break
                last_seq = int(batch[-1].conversation_seq or 0)
                if len(batch) < _BATCH:
                    break

            users = self._service._get_users_map(presence_map={}, user_ids=sender_ids) if sender_ids else {}
            title = _normalize_text(conversation.title) or "Чат"
            conversation_key = conversation.id
            if is_group:
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action="history_exported",
                    details={
                        "format": normalized_format,
                        "messages": len(rows),
                        "truncated": truncated,
                        "from": _normalize_text(created_from) or None,
                        "to": _normalize_text(created_to) or None,
                    },
                )

        def sender_name(user_id: int) -> str:
            user = users.get(user_id) or {}
            return (
                _normalize_text(user.get("full_name"))
                or _normalize_text(user.get("username"))
                or (f"Пользователь {user_id}" if user_id else "Система")
            )

        exported_at = _format_moment(datetime.now(timezone.utc))
        if normalized_format == "json":
            payload = {
                "conversation": {"id": conversation_key, "title": title},
                "exported_at_utc": exported_at,
                "truncated": truncated,
                "messages": [
                    {
                        "created_at_utc": _format_moment(row["at"]),
                        "edited_at_utc": _format_moment(row["edited_at"]) or None,
                        "sender": sender_name(row["sender_user_id"]),
                        "kind": row["kind"],
                        "text": row["body"],
                        "is_reply": row["reply"],
                        "is_forwarded": row["forwarded"],
                        "attachments": row["attachments"],
                    }
                    for row in rows
                ],
            }
            content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            content_type = "application/json; charset=utf-8"
        else:
            lines = [
                f"Чат: {title}",
                f"Выгружено: {exported_at} (UTC), сообщений: {len(rows)}",
            ]
            if truncated:
                lines.append(f"Выгрузка ограничена первыми {MAX_EXPORT_MESSAGES} сообщениями.")
            lines.append("")
            for row in rows:
                marks = []
                if row["forwarded"]:
                    marks.append("пересланное")
                if row["reply"]:
                    marks.append("ответ")
                if row["edited_at"] is not None:
                    marks.append("изменено")
                suffix = f" ({', '.join(marks)})" if marks else ""
                who = "Система" if row["kind"] == "system" else sender_name(row["sender_user_id"])
                lines.append(f"[{_format_moment(row['at'])}] {who}{suffix}")
                if row["body"]:
                    lines.append(row["body"])
                for item in row["attachments"]:
                    lines.append(f"  [вложение: {item['file_name']}, {_format_size(item['size'])}]")
                lines.append("")
            content = "\n".join(lines).encode("utf-8")
            content_type = "text/plain; charset=utf-8"

        safe_title = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in title).strip() or "chat"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return {
            "content": content,
            "content_type": content_type,
            "file_name": f"{safe_title[:60]}-{stamp}.{normalized_format}",
            "messages": len(rows),
            "truncated": truncated,
        }
