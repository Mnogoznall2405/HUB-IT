"""Folder mutation helpers used by ChatService."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.chat.models import ChatConversationUserState, ChatFolder
from backend.chat.utils import normalize_text as _normalize_text


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def normalize_folder_conversation_ids(conversation_ids: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in conversation_ids or []:
        conversation_id = _normalize_text(raw)
        if not conversation_id or conversation_id in seen:
            continue
        seen.add(conversation_id)
        normalized.append(conversation_id)
    if len(normalized) > 200:
        raise ValueError("Folder cannot contain more than 200 chats")
    return normalized


def require_owned_chat_folder(session: Session, *, user_id: int, folder_id: str) -> ChatFolder:
    normalized_folder_id = _normalize_text(folder_id)
    if not normalized_folder_id:
        raise ValueError("folder_id is required")
    folder = session.get(ChatFolder, normalized_folder_id)
    if folder is None or int(folder.user_id) != int(user_id):
        raise LookupError("Folder not found")
    return folder


def sum_unread_for_conversations(
    session: Session,
    *,
    user_id: int,
    conversation_ids: list[str],
) -> int:
    if not conversation_ids:
        return 0
    states = list(
        session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.user_id == int(user_id),
                ChatConversationUserState.conversation_id.in_(conversation_ids),
            )
        ).scalars()
    )
    return sum(max(0, int(row.unread_count or 0)) for row in states)


def serialize_chat_folder(
    folder: ChatFolder,
    *,
    conversation_ids: Optional[list[str]] = None,
    conversation_count: Optional[int] = None,
    unread_count: int = 0,
) -> dict[str, Any]:
    resolved_conversation_ids = list(conversation_ids or [])
    return {
        "id": str(folder.id),
        "name": str(folder.name),
        "sort_order": int(folder.sort_order or 0),
        "conversation_count": int(
            conversation_count if conversation_count is not None else len(resolved_conversation_ids)
        ),
        "unread_count": int(unread_count or 0),
        "conversation_ids": resolved_conversation_ids,
        "created_at": _iso(folder.created_at),
        "updated_at": _iso(folder.updated_at),
    }
