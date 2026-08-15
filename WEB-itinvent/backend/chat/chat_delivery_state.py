"""Shared delivery-state helpers for chat messages and read receipts."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.chat.models import ChatConversation, ChatConversationUserState, ChatMessage, ChatMessageRead
from backend.chat.utils import normalize_text as _normalize_text

CHAT_MESSAGE_DELIVERY_STATE_EVENT = "chat.message.delivery_state"


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


def advance_conversation_read_state(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
    message_id: str,
    target_seq: int,
    read_at: datetime,
    opened_at: datetime,
) -> bool:
    """Advance one viewer's read cursor without allowing concurrent regression."""
    normalized_target_seq = max(0, int(target_seq or 0))
    current_seq = func.coalesce(ChatConversationUserState.last_read_seq, 0)
    latest_seq = func.coalesce(
        select(ChatConversation.last_message_seq)
        .where(ChatConversation.id == conversation_id)
        .scalar_subquery(),
        normalized_target_seq,
    )
    unread_count = case(
        (latest_seq > normalized_target_seq, latest_seq - normalized_target_seq),
        else_=0,
    )
    result = session.execute(
        update(ChatConversationUserState)
        .where(
            ChatConversationUserState.conversation_id == conversation_id,
            ChatConversationUserState.user_id == int(current_user_id),
            or_(
                current_seq < normalized_target_seq,
                and_(
                    current_seq == normalized_target_seq,
                    or_(
                        ChatConversationUserState.last_read_message_id.is_(None),
                        ChatConversationUserState.last_read_message_id != message_id,
                    ),
                ),
            ),
        )
        .values(
            last_read_message_id=message_id,
            last_read_seq=normalized_target_seq,
            last_read_at=read_at,
            unread_count=unread_count,
            opened_at=opened_at,
            updated_at=opened_at,
        )
        .execution_options(synchronize_session=False)
    )
    return int(getattr(result, "rowcount", 0) or 0) > 0


def insert_message_read_receipt_once(
    *,
    session,
    conversation_id: str,
    current_user_id: int,
    message_id: str,
    read_at: datetime,
) -> bool:
    """Insert an idempotent per-message receipt on SQLite and PostgreSQL."""
    bind = session.get_bind()
    dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
    insert_fn = pg_insert if dialect_name == "postgresql" else sqlite_insert
    statement = insert_fn(ChatMessageRead).values(
        conversation_id=conversation_id,
        user_id=int(current_user_id),
        message_id=message_id,
        read_at=read_at,
    )
    if dialect_name == "postgresql":
        statement = statement.on_conflict_do_nothing(
            constraint="uq_chat_message_reads_conversation_user_message"
        )
    else:
        statement = statement.on_conflict_do_nothing(
            index_elements=["conversation_id", "user_id", "message_id"]
        )
    result = session.execute(statement)
    return int(getattr(result, "rowcount", 0) or 0) > 0


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
    """Legacy full delivery-state apply (kept for file/forward/system paths)."""
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


def build_delivery_state_outbox_job(
    *,
    conversation_id: str,
    message_id: str,
    sender_user_id: int,
    member_user_ids: list[int],
    conversation_seq: int,
    seen_at: datetime,
) -> dict[str, Any]:
    normalized_message_id = _normalize_text(message_id)
    return {
        "event_type": CHAT_MESSAGE_DELIVERY_STATE_EVENT,
        "target_scope": "system",
        "target_user_id": int(sender_user_id),
        "conversation_id": _normalize_text(conversation_id),
        "message_id": normalized_message_id,
        "payload": {
            "sender_user_id": int(sender_user_id),
            "member_user_ids": [int(item) for item in list(member_user_ids or []) if int(item) > 0],
            "conversation_seq": int(conversation_seq),
            "seen_at": seen_at.isoformat() if hasattr(seen_at, "isoformat") else str(seen_at),
        },
        "dedupe_key": f"delivery_state:{normalized_message_id}",
    }


def apply_message_delivery_state_after_commit(
    *,
    session,
    conversation_id: str,
    message_id: str,
    sender_user_id: int,
    member_user_ids: list[int],
    conversation_seq: int,
    seen_at: datetime,
) -> dict[str, int]:
    """Idempotent unread/sender-seen apply outside the conversation row lock.

    Unread is recomputed from (last_message_seq - last_read_seq), so outbox
    retries do not double-increment counters.
    """
    normalized_conversation_id = _normalize_text(conversation_id)
    normalized_message_id = _normalize_text(message_id)
    # Sender seen first (single row) — keep mark_read path free of long multi-row ORM loops.
    mark_sender_message_seen(
        session=session,
        conversation_id=normalized_conversation_id,
        current_user_id=int(sender_user_id),
        message_id=normalized_message_id,
        conversation_seq=int(conversation_seq),
        seen_at=seen_at,
    )
    conversation = session.get(ChatConversation, normalized_conversation_id)
    tip_seq = int(getattr(conversation, "last_message_seq", 0) or conversation_seq or 0) if conversation else int(conversation_seq)
    recipient_user_ids = sorted({
        int(member_user_id)
        for member_user_id in list(member_user_ids or [])
        if int(member_user_id) > 0 and int(member_user_id) != int(sender_user_id)
    })
    if not recipient_user_ids:
        return {"recipients_updated": 0, "tip_seq": tip_seq}

    existing_user_ids = set(
        session.execute(
            select(ChatConversationUserState.user_id).where(
                ChatConversationUserState.conversation_id == normalized_conversation_id,
                ChatConversationUserState.user_id.in_(recipient_user_ids),
            )
        ).scalars()
    )
    existing_user_ids = {int(item) for item in existing_user_ids if int(item) > 0}

    # One statement for all existing rows — short lock window vs per-row ORM dirtying.
    # Use CASE (not GREATEST) for SQLite test dialect compatibility.
    updated = 0
    if existing_user_ids:
        unread_expr = int(tip_seq) - func.coalesce(ChatConversationUserState.last_read_seq, 0)
        result = session.execute(
            update(ChatConversationUserState)
            .where(
                ChatConversationUserState.conversation_id == normalized_conversation_id,
                ChatConversationUserState.user_id.in_(sorted(existing_user_ids)),
            )
            .values(
                unread_count=case((unread_expr > 0, unread_expr), else_=0),
                updated_at=seen_at,
            )
        )
        updated = int(getattr(result, "rowcount", 0) or 0)

    missing = [user_id for user_id in recipient_user_ids if user_id not in existing_user_ids]
    for member_user_id in missing:
        session.add(
            ChatConversationUserState(
                conversation_id=normalized_conversation_id,
                user_id=int(member_user_id),
                unread_count=max(0, int(tip_seq)),
                updated_at=seen_at,
            )
        )
        updated += 1
    return {"recipients_updated": updated, "tip_seq": tip_seq}


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
