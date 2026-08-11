"""Atomic conversation sequence claim for short message-write transactions."""
from __future__ import annotations

from sqlalchemy import select, update

from backend.chat.models import ChatConversation
from backend.chat.utils import normalize_text as _normalize_text


def claim_next_conversation_seq(*, session, conversation_id: str) -> int:
    """Atomically increment last_message_seq and return the claimed value.

    Prefer claim_next_conversation_seq_and_touch for the send critical path so the
    conversation tip fields are updated in the same statement.
    """
    return claim_next_conversation_seq_and_touch(
        session=session,
        conversation_id=conversation_id,
        message_id=None,
        seen_at=None,
        touch_tip=False,
    )


def claim_next_conversation_seq_and_touch(
    *,
    session,
    conversation_id: str,
    message_id: str | None = None,
    seen_at=None,
    touch_tip: bool = True,
) -> int:
    """Claim next seq and optionally set last_message_* in one UPDATE.

    Row lock is held until the surrounding transaction commits; keep the TX to
    INSERT message + commit only after this call.
    """
    normalized_conversation_id = _normalize_text(conversation_id)
    if not normalized_conversation_id:
        raise LookupError("Conversation not found")

    bind = session.get_bind()
    dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
    values: dict = {"last_message_seq": ChatConversation.__table__.c.last_message_seq + 1}
    if touch_tip:
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required when touch_tip=True")
        if seen_at is None:
            raise ValueError("seen_at is required when touch_tip=True")
        values.update(
            {
                "last_message_id": normalized_message_id,
                "last_message_at": seen_at,
                "updated_at": seen_at,
            }
        )

    if dialect_name in {"postgresql", "sqlite"}:
        table = ChatConversation.__table__
        seq_expr = table.c.last_message_seq + 1
        update_values = {"last_message_seq": seq_expr}
        if touch_tip:
            update_values.update(
                {
                    "last_message_id": _normalize_text(message_id),
                    "last_message_at": seen_at,
                    "updated_at": seen_at,
                }
            )
        result = session.execute(
            update(table)
            .where(table.c.id == normalized_conversation_id)
            .where(table.c.is_archived.is_(False))
            .values(**update_values)
            .returning(table.c.last_message_seq)
        )
        claimed = result.scalar_one_or_none()
        if claimed is None:
            raise LookupError("Conversation not found")
        return int(claimed)

    conversation = session.execute(
        select(ChatConversation)
        .where(ChatConversation.id == normalized_conversation_id)
        .with_for_update()
    ).scalar_one_or_none()
    if conversation is None or bool(conversation.is_archived):
        raise LookupError("Conversation not found")
    conversation.last_message_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
    if touch_tip:
        conversation.last_message_id = _normalize_text(message_id)
        conversation.last_message_at = seen_at
        conversation.updated_at = seen_at
    session.flush()
    return int(conversation.last_message_seq)


def touch_conversation_last_message(
    *,
    session,
    conversation_id: str,
    message_id: str,
    conversation_seq: int,
    seen_at,
) -> None:
    """Legacy tip touch when seq was claimed separately (file/forward paths)."""
    normalized_conversation_id = _normalize_text(conversation_id)
    session.execute(
        update(ChatConversation)
        .where(ChatConversation.id == normalized_conversation_id)
        .where(ChatConversation.last_message_seq == int(conversation_seq))
        .values(
            last_message_id=_normalize_text(message_id),
            last_message_at=seen_at,
            updated_at=seen_at,
        )
    )
