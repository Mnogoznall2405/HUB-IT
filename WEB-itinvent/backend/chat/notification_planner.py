"""Pure chat notification recipient planning."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping, Optional

from backend.chat.models import conversation_state_is_muted
from backend.chat.utils import normalize_text as _normalize_text


AI_REPLY_NOTIFICATION_TITLE = "ИИ ответил"
AI_REPLY_PREVIEW_LIMIT = 140
_MARKDOWN_NOISE = re.compile(r"[*_`#>~|]+")
_MARKDOWN_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MEMORY_MARK_LINE = re.compile(r"\n*_?Учтена личная память:[^\n]*_?\s*$")


def ai_reply_preview(value: object, limit: int = AI_REPLY_PREVIEW_LIMIT) -> str:
    """Beginning of an AI answer as plain text for a notification (no markdown, no memory mark)."""
    text = _MEMORY_MARK_LINE.sub("", str(value or ""))
    text = _MARKDOWN_LINK.sub(r"\1", text)
    text = _MARKDOWN_NOISE.sub("", text)
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)].rstrip() + "…"


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
                conversation_state_is_muted(state)
                or bool(getattr(state, "is_archived", False))
            )
        ):
            continue

        current_event_type = normalized_event_type
        if normalized_kind == "ai":
            # The answer of the assistant is a normal incoming message for the employee who left
            # the chat: "ИИ ответил: <beginning of the answer>", not "<bot>: <whole markdown>".
            current_title = AI_REPLY_NOTIFICATION_TITLE
            current_body = ai_reply_preview(base_body)
        elif normalized_kind == "direct":
            current_title = resolved_sender_name
            current_body = base_body
            if base_title and base_title != default_title:
                current_body = f"[{base_title}] {base_body}"
        else:
            group_title = _normalize_text(conversation_title) or default_group_title
            current_title = group_title
            prefix = f"[{base_title}] " if base_title and base_title != default_title else ""
            current_body = f"{prefix}{resolved_sender_name}: {base_body}"

        if is_mentioned and normalized_kind != "ai":
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
