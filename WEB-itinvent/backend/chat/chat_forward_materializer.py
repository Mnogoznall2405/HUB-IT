"""Forward message snapshot and attachment materialization."""
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
import shutil
from pathlib import Path
from uuid import uuid4

from backend.chat.chat_constants import CHAT_MAX_FILES_PER_MESSAGE, CHAT_MAX_TOTAL_FILE_BYTES
from backend.chat.chat_formatting import _normalize_body_format, _safe_file_name
from backend.chat.message_persistence import ForwardMessageSnapshot
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatForwardMaterializer:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def materialize_forward(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        source_message_id: str,
        reply_to_message_id: str | None = None,
    ) -> tuple[ForwardMessageSnapshot, list[dict], list[Path], dict]:
        """Build forward snapshot and copy attachment files. Caller owns cleanup of written_paths."""
        normalized_source_message_id = _normalize_text(source_message_id)
        if not normalized_source_message_id:
            raise ValueError("source_message_id is required")
        written_paths: list[Path] = []
        source_kind = "text"
        source_body = ""
        source_attachments: list[ChatMessageAttachment] = []
        source_task_preview: dict | None = None
        prepared_attachments: list[dict] = []
        source_snapshot: ForwardMessageSnapshot | None = None
        task_id: str | None = None
        with chat_session() as session:
                target_conversation = self._service._require_membership(
                    session=session,
                    conversation_id=conversation_id,
                    current_user_id=int(current_user_id),
                )
                source_message = session.get(ChatMessage, normalized_source_message_id)
                if source_message is None:
                    raise LookupError("Source message not found")
                self._service._require_membership(
                    session=session,
                    conversation_id=source_message.conversation_id,
                    current_user_id=int(current_user_id),
                )

                member_user_ids = self._service._conversation_member_ids(session, target_conversation.id)
                self._service._resolve_reply_message(
                    session=session,
                    conversation_id=target_conversation.id,
                    reply_to_message_id=reply_to_message_id,
                )
                source_kind = self._service._normalize_message_kind(getattr(source_message, "kind", "text"))
                source_body = _normalize_text(getattr(source_message, "body", ""))
                source_body_format = _normalize_body_format(getattr(source_message, "body_format", None))
                message_body_format = source_body_format if source_kind == "text" else "plain"
                source_attachments = self._service._list_attachments_by_message(
                    session=session,
                    message_ids=[source_message.id],
                ).get(source_message.id, [])
                if len(source_attachments) > CHAT_MAX_FILES_PER_MESSAGE:
                    raise ValueError(f"You can upload at most {CHAT_MAX_FILES_PER_MESSAGE} files at a time")
                if sum(int(item.file_size or 0) for item in source_attachments) > CHAT_MAX_TOTAL_FILE_BYTES:
                    raise ValueError("Total upload size exceeds 1 GB")

                forward_from_message_id = (
                    _normalize_text(getattr(source_message, "forward_from_message_id", None))
                    or source_message.id
                )
                task_id = _normalize_text(getattr(source_message, "task_id", None)) or None
                task_preview_json = None
                if source_kind == "task_share":
                    if not task_id:
                        raise ValueError("Forward source task is missing")
                    if not self._service._task_is_shareable_to_members(task_id=task_id, member_ids=member_user_ids):
                        raise PermissionError("Task is not available to all chat participants")
                    task_preview_json = getattr(source_message, "task_preview_json", None)
                    source_task_preview = self._service._deserialize_task_preview(task_preview_json)

                source_snapshot = ForwardMessageSnapshot(
                    source_message_id=source_message.id,
                    kind=source_kind,
                    body=source_body,
                    body_format=message_body_format,
                    forward_from_message_id=forward_from_message_id,
                    task_id=task_id if source_kind == "task_share" else None,
                    task_preview_json=task_preview_json,
                )

                target_dir = self._service._attachments_root / target_conversation.id
                target_dir.mkdir(parents=True, exist_ok=True)
                for source_attachment in source_attachments:
                    attachment_id = str(uuid4())
                    file_name = _safe_file_name(getattr(source_attachment, "file_name", None) or "file.bin")
                    storage_name = f"{attachment_id}_{file_name}"
                    source_path = self._service._resolve_attachment_path(
                        conversation_id=source_message.conversation_id,
                        storage_name=source_attachment.storage_name,
                    )
                    if not source_path.exists() or not source_path.is_file():
                        raise LookupError("Attachment file not found")
                    target_path = (target_dir / storage_name).resolve()
                    try:
                        target_path.relative_to(self._service._attachments_root.resolve())
                    except ValueError as exc:
                        raise ValueError("Invalid attachment path") from exc
                    shutil.copy2(source_path, target_path)
                    written_paths.append(target_path)
                    prepared_attachments.append(
                        {
                            "attachment_id": attachment_id,
                            "storage_name": storage_name,
                            "file_name": file_name,
                            "mime_type": _normalize_text(getattr(source_attachment, "mime_type", None)) or None,
                            "media_kind": _normalize_text(getattr(source_attachment, "media_kind", None)) or None,
                            "file_size": int(source_attachment.file_size or 0),
                            "width": int(source_attachment.width) if source_attachment.width is not None else None,
                            "height": int(source_attachment.height) if source_attachment.height is not None else None,
                            "duration_seconds": int(source_attachment.duration_seconds) if getattr(source_attachment, "duration_seconds", None) is not None else None,
                        }
                    )

        if source_snapshot is None:
            raise ValueError("Forward source snapshot is missing")
        return source_snapshot, prepared_attachments, written_paths, {
            "source_kind": source_kind,
            "source_body": source_body,
            "source_attachments": source_attachments,
            "source_task_preview": source_task_preview,
            "task_id": task_id,
        }
