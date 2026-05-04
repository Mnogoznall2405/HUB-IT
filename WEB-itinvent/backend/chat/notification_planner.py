"""Pure chat notification recipient planning."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


@dataclass(frozen=True)
class ChatNotificationRecipientPlan:
    recipient_user_id: int
    event_type: str
    title: str
    body: str
    is_mentioned: bool = False


def build_chat_notification_recipient_plans(
    *,
    sender_user_id: int,
    conversation_kind: object,
    conversation_title: object,
    member_ids: list[int],
    states_by_user_id: Mapping[int, Any],
    sender_name: str,
    event_type: object,
    title: object,
    body: object,
    mentioned_user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None,
    default_title: str,
    default_group_title: str,
    mention_prefix: str,
) -> list[ChatNotificationRecipientPlan]:
    sender_id = int(sender_user_id)
    mentioned_user_id_set = {
        int(item)
        for item in list(mentioned_user_ids or [])
        if int(item) > 0 and int(item) != sender_id
    }
    normalized_kind = _normalize_text(conversation_kind)
    normalized_event_type = _normalize_text(event_type)
    resolved_sender_name = _normalize_text(sender_name) or "Colleague"
    base_title = _normalize_text(title) or default_title
    base_body = _normalize_text(body)
    plans: list[ChatNotificationRecipientPlan] = []

    for member_id in list(member_ids or []):
        recipient_id = int(member_id)
        if recipient_id <= 0 or recipient_id == sender_id:
            continue
        is_mentioned = recipient_id in mentioned_user_id_set
        state = states_by_user_id.get(recipient_id)
        if (
            not is_mentioned
            and (
                bool(getattr(state, "is_muted", False))
                or bool(getattr(state, "is_archived", False))
            )
        ):
            continue

        current_event_type = normalized_event_type
        if normalized_kind == "direct":
            current_title = resolved_sender_name
            current_body = base_body
            if base_title and base_title != default_title:
                current_body = f"[{base_title}] {base_body}"
        else:
            group_title = _normalize_text(conversation_title) or default_group_title
            current_title = group_title
            prefix = f"[{base_title}] " if base_title and base_title != default_title else ""
            current_body = f"{prefix}{resolved_sender_name}: {base_body}"

        if is_mentioned:
            current_event_type = "chat.mention"
            if normalized_kind == "direct":
                current_title = resolved_sender_name
                current_body = f"[{mention_prefix}] {base_body}"
            else:
                current_title = f"{mention_prefix}: {current_title}"
                current_body = f"{resolved_sender_name}: {base_body}"

        plans.append(
            ChatNotificationRecipientPlan(
                recipient_user_id=recipient_id,
                event_type=current_event_type,
                title=current_title,
                body=current_body,
                is_mentioned=is_mentioned,
            )
        )

    return plans
