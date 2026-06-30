"""Shared delivery-state helpers for chat messages and read receipts."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update

from backend.chat.models import ChatConversationUserState, ChatMessage
from backend.chat.utils import normalize_text as _normalize_text


def get_or_create_conversation_state(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
) -> ChatConversationUserState:
    state = session.execute(
        select(ChatConversationUserState).where(
            ChatConversationUserState.conversation_id == conversation_id,
            ChatConversationUserState.user_id == int(current_user_id),
        )
    ).scalar_one_or_none()
    if state is None:
        state = ChatConversationUserState(
            conversation_id=conversation_id,
            user_id=int(current_user_id),
        )
        session.add(state)
    return state


def mark_sender_message_seen(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
    message_id: str,
    conversation_seq: int,
    seen_at: datetime,
) -> None:
    state = get_or_create_conversation_state(
        session=session,
        conversation_id=conversation_id,
        current_user_id=int(current_user_id),
    )
    state.last_read_message_id = _normalize_text(message_id)
    state.last_read_seq = max(0, int(conversation_seq or 0))
    state.last_read_at = seen_at
    state.unread_count = 0
    state.opened_at = seen_at
    state.updated_at = seen_at


def increment_unread_counters_for_recipients(
    *,
    session,
    conversation_id: str,
    sender_user_id: int,
    member_user_ids: list[int],
    seen_at: datetime,
) -> None:
    recipient_user_ids = sorted({
        int(member_user_id)
        for member_user_id in list(member_user_ids or [])
        if int(member_user_id) > 0 and int(member_user_id) != int(sender_user_id)
    })
    if not recipient_user_ids:
        return

    normalized_conversation_id = _normalize_text(conversation_id)
    existing_states = list(
        session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.conversation_id == normalized_conversation_id,
                ChatConversationUserState.user_id.in_(recipient_user_ids),
            )
        ).scalars()
    )
    existing_user_ids = {
        int(state.user_id)
        for state in existing_states
        if int(state.user_id or 0) > 0
    }
    if existing_user_ids:
        session.execute(
            update(ChatConversationUserState)
            .where(
                ChatConversationUserState.conversation_id == normalized_conversation_id,
                ChatConversationUserState.user_id.in_(sorted(existing_user_ids)),
            )
            .values(
                unread_count=ChatConversationUserState.unread_count + 1,
                updated_at=seen_at,
            )
        )

    for member_user_id in recipient_user_ids:
        if member_user_id in existing_user_ids:
            continue
        session.add(
            ChatConversationUserState(
                conversation_id=normalized_conversation_id,
                user_id=member_user_id,
                unread_count=1,
                updated_at=seen_at,
            )
        )


def apply_new_message_delivery_state(
    *,
    session,
    conversation,
    message: ChatMessage,
    sender_user_id: int,
    member_user_ids: list[int],
    seen_at: datetime,
) -> None:
    conversation.last_message_id = message.id
    conversation.last_message_seq = int(message.conversation_seq or 0)
    conversation.last_message_at = seen_at
    conversation.updated_at = seen_at
    mark_sender_message_seen(
        session=session,
        conversation_id=conversation.id,
        current_user_id=int(sender_user_id),
        message_id=message.id,
        conversation_seq=int(message.conversation_seq or 0),
        seen_at=seen_at,
    )
    increment_unread_counters_for_recipients(
        session=session,
        conversation_id=conversation.id,
        sender_user_id=int(sender_user_id),
        member_user_ids=member_user_ids,
        seen_at=seen_at,
    )


def find_existing_client_message(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
    client_message_id: str,
) -> ChatMessage | None:
    normalized_client_message_id = _normalize_text(client_message_id)
    if not normalized_client_message_id:
        return None
    return session.execute(
        select(ChatMessage).where(
            ChatMessage.conversation_id == _normalize_text(conversation_id),
            ChatMessage.sender_user_id == int(current_user_id),
            ChatMessage.client_message_id == normalized_client_message_id,
        )
    ).scalar_one_or_none()


# Backward-compatible aliases for legacy private names.
_get_or_create_conversation_state = get_or_create_conversation_state
_mark_sender_message_seen = mark_sender_message_seen
_increment_unread_counters_for_recipients = increment_unread_counters_for_recipients
_apply_new_message_delivery_state = apply_new_message_delivery_state
_find_existing_client_message = find_existing_client_message
