"""Mention parsing/resolution helpers shared by send and outbox-repair paths."""
from __future__ import annotations

from backend.chat.chat_constants import CHAT_MENTION_PATTERN
from backend.chat.chat_formatting import (
    _mention_handle_from_person_name,
    _normalize_mention_handle,
)
from backend.chat.utils import normalize_text as _normalize_text


# "@все" / "@all" notifies every member. Only group owners and moderators may use it: a plain member
# writing it gets an ordinary text, nobody is mentioned (a mention bypasses mute and notification limits).
MENTION_ALL_HANDLES = frozenset({"все", "all"})


def mentions_everyone(body: object) -> bool:
    return bool(extract_mention_handles(body) & MENTION_ALL_HANDLES)


def sender_may_mention_all(*, conversation_id: object, user_id: int) -> bool:
    from sqlalchemy import select

    from backend.chat.chat_formatting import _normalize_member_role
    from backend.chat.db import chat_session
    from backend.chat.models import ChatConversation, ChatMember

    normalized_id = _normalize_text(conversation_id)
    if not normalized_id or int(user_id or 0) <= 0:
        return False
    try:
        with chat_session() as session:
            row = session.execute(
                select(ChatConversation.kind, ChatMember.member_role)
                .join(ChatMember, ChatMember.conversation_id == ChatConversation.id)
                .where(
                    ChatConversation.id == normalized_id,
                    ChatMember.user_id == int(user_id),
                    ChatMember.left_at.is_(None),
                )
            ).first()
    except Exception:
        return False
    if row is None or _normalize_text(row[0]).lower() != "group":
        return False
    return _normalize_member_role(row[1]) in {"owner", "moderator"}


def extract_mention_handles(body: object) -> set[str]:
    text = _normalize_text(body)
    if "@" not in text:
        return set()
    return {
        _normalize_mention_handle(match.group(1))
        for match in CHAT_MENTION_PATTERN.finditer(text)
        if _normalize_mention_handle(match.group(1))
    }


def resolve_mentioned_member_user_ids(
    *,
    member_user_ids: list[int] | set[int] | tuple[int, ...],
    sender_user_id: int,
    body: object,
    conversation_id: object = None,
) -> set[int]:
    handles = extract_mention_handles(body)
    if not handles:
        return set()
    candidate_user_ids = sorted({
        int(item)
        for item in list(member_user_ids or [])
        if int(item) > 0 and int(item) != int(sender_user_id)
    })
    if not candidate_user_ids:
        return set()
    if handles & MENTION_ALL_HANDLES and sender_may_mention_all(
        conversation_id=conversation_id, user_id=int(sender_user_id)
    ):
        return set(candidate_user_ids)
    # Lazy import: user_service lives outside the chat domain modules.
    from backend.services.user_service import user_service

    try:
        users_by_id = user_service.get_users_map_by_ids(candidate_user_ids)
    except Exception:
        users_by_id = {}
    result: set[int] = set()
    for user_id in candidate_user_ids:
        user = users_by_id.get(int(user_id)) or {}
        candidate_handles = {
            _normalize_mention_handle(user.get("username")),
            _mention_handle_from_person_name(user.get("full_name")),
        }
        if handles.intersection({item for item in candidate_handles if item}):
            result.add(int(user_id))
    return result
