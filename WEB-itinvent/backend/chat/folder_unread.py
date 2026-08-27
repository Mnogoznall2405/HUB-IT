"""System-folder unread totals for Chat inbox tabs."""
from __future__ import annotations

from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from backend.chat.models import ChatConversation, ChatConversationUserState, ChatMember

SYSTEM_FOLDER_UNREAD_KEYS = ("personal", "groups", "tasks", "archived")


def empty_system_folder_unread_counts() -> dict[str, int]:
    return {key: 0 for key in SYSTEM_FOLDER_UNREAD_KEYS}


def add_system_folder_unread(
    counts: dict[str, int],
    *,
    kind: object,
    task_id: object = None,
    is_archived: bool = False,
    unread_count: object = 0,
) -> dict[str, int]:
    unread = max(0, int(unread_count or 0))
    if unread <= 0:
        return counts
    if is_archived:
        counts["archived"] = int(counts.get("archived") or 0) + unread
        return counts
    normalized_kind = str(kind or "").strip()
    normalized_task_id = str(task_id or "").strip()
    if normalized_kind in {"direct", "notes", "ai"}:
        counts["personal"] = int(counts.get("personal") or 0) + unread
    if normalized_kind == "group":
        counts["groups"] = int(counts.get("groups") or 0) + unread
    if normalized_kind == "task" or normalized_task_id:
        counts["tasks"] = int(counts.get("tasks") or 0) + unread
    return counts


def compute_system_folder_unread_counts(session: Session, *, user_id: int) -> dict[str, int]:
    counts = empty_system_folder_unread_counts()
    rows = session.execute(
        select(
            ChatConversation.kind,
            ChatConversation.task_id,
            ChatConversationUserState.is_archived,
            ChatConversationUserState.unread_count,
        )
        .select_from(ChatMember)
        .join(ChatConversation, ChatConversation.id == ChatMember.conversation_id)
        .outerjoin(
            ChatConversationUserState,
            and_(
                ChatConversationUserState.conversation_id == ChatConversation.id,
                ChatConversationUserState.user_id == int(user_id),
            ),
        )
        .where(
            ChatMember.user_id == int(user_id),
            ChatMember.left_at.is_(None),
        )
    ).all()
    for kind, task_id, is_archived, unread_count in rows:
        add_system_folder_unread(
            counts,
            kind=kind,
            task_id=task_id,
            is_archived=bool(is_archived),
            unread_count=unread_count,
        )
    return counts


def conversation_search_title(conversation: Any) -> str:
    title = str(getattr(conversation, "title", "") or "").strip()
    if title:
        return title
    kind = str(getattr(conversation, "kind", "") or "").strip()
    return {
        "direct": "Личный чат",
        "group": "Беседа",
        "task": "Задача",
        "ai": "AI",
        "notes": "Заметки",
    }.get(kind, "Диалог")
