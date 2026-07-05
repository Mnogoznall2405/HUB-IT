"""One-off extractor: ChatThreadReadStore from ChatService methods."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"
OUT_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "chat_thread_read_store.py"

HELPERS = [
    "_cache_get", "_cache_set", "_set_request_meta", "_require_membership",
    "_message_before_anchor_condition", "_message_after_anchor_condition",
    "_message_order_desc", "_message_order_asc", "_has_message_before", "_has_message_after",
    "_list_attachments_by_message", "_get_presence_map", "_get_users_map",
    "_build_reply_previews", "_build_forward_previews", "_serialize_message",
    "_build_message_search_haystack", "_build_message_read_receipts",
    "_conversation_member_ids", "_collect_message_payload_user_ids",
    "_build_presence_payload", "_iso",
]

METHODS = [
    "get_message",
    "get_messages_for_users",
    "get_messages",
    "get_thread_bootstrap",
    "search_messages",
    "get_message_reads",
    "get_message_read_delta",
    "_serialize_thread_messages_payload",
]


def extract_method(lines: list[str], name: str) -> list[str]:
    pat = re.compile(rf"^    def {re.escape(name)}\(")
    start = next(i for i, line in enumerate(lines) if pat.match(line))
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("    def ") or lines[j].startswith("chat_service"):
            end = j
            break
    return lines[start:end]


def transform(chunk_lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in chunk_lines:
        if line.startswith("        "):
            text = line
        elif line.startswith("    "):
            text = line
        elif line.strip() == "":
            text = line
        else:
            text = "        " + line
        text = text.replace("self._ensure_available()", "")
        for prefix in HELPERS:
            text = re.sub(rf"\bself\.{prefix}\b", f"self._service.{prefix}", text)
        text = text.replace(
            "self._service._serialize_thread_messages_payload",
            "self._serialize_thread_messages_payload",
        )
        out.append(text)
    return out


def main() -> None:
    lines = SERVICE_PATH.read_text(encoding="utf-8").splitlines()
    header = '''"""Read-side thread/message queries extracted from ChatService."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, func, or_, select

from backend.chat.db import chat_session
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatMember,
    ChatMessage,
    ChatMessageRead,
    ChatMessageReaction,
)
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatThreadReadStore:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

'''
    body_lines: list[str] = []
    for name in METHODS:
        body_lines.extend(transform(extract_method(lines, name)))
        body_lines.append("")

    body = "\n".join(body_lines)
    body = body.replace(
        "def _serialize_thread_messages_payload(\n        self,\n        *,\n        session,\n        conversation: ChatConversation,\n        current_user_id: int,\n        messages: list[ChatMessage],\n        has_older: bool,\n        has_newer: bool,\n    ) -> dict[str, Any]:",
        "def _serialize_thread_messages_payload(\n        self,\n        *,\n        session,\n        conversation: ChatConversation,\n        current_user_id: int,\n        messages: list[ChatMessage],\n        has_older: bool,\n        has_newer: bool,\n        lightweight: bool = False,\n    ) -> dict[str, Any]:",
    )
    lightweight = '''
        if lightweight:
            svc = self._service
            viewer_state = session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id == conversation.id,
                    ChatConversationUserState.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            svc._batch_action_cards_for_messages(
                session=session,
                message_ids=[item.id for item in messages],
            )
            users_by_id = svc._get_users_map(
                presence_map=svc._get_presence_map(user_ids={int(item.sender_user_id) for item in messages}),
                user_ids={int(item.sender_user_id) for item in messages},
            )
            return {
                "items": [
                    svc._serialize_message(
                        conversation_kind=conversation.kind,
                        message=item,
                        current_user_id=int(current_user_id),
                        users_by_id=users_by_id,
                        member_ids=[],
                        states_by_user_id={},
                        reads_by_message_id={},
                        reply_previews=svc._build_reply_previews(
                            session=session,
                            reply_to_message_ids=[getattr(item, "reply_to_message_id", None)],
                            users_by_id=users_by_id,
                        ),
                        forward_previews=svc._build_forward_previews(
                            session=session,
                            forward_from_message_ids=[getattr(item, "forward_from_message_id", None)],
                            users_by_id=users_by_id,
                        ),
                        attachments=svc._list_attachments_by_message(
                            session=session,
                            message_ids=[item.id],
                        ).get(item.id, []),
                    )
                    for item in messages
                ],
                "has_more": bool(has_older),
                "has_older": bool(has_older),
                "has_newer": bool(has_newer),
                "cursor_invalid": False,
                "older_cursor_message_id": messages[0].id if messages and has_older else None,
                "newer_cursor_message_id": messages[-1].id if messages and has_newer else None,
                "viewer_last_read_message_id": _normalize_text(getattr(viewer_state, "last_read_message_id", None)) or None,
                "viewer_last_read_at": svc._iso(getattr(viewer_state, "last_read_at", None)),
            }
'''
    body = body.replace(
        ") -> dict[str, Any]:\n        members = list(",
        ") -> dict[str, Any]:" + lightweight + "\n        members = list(",
        1,
    )
    OUT_PATH.write_text(header + body + "\n", encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len((header + body).splitlines())} lines)")


if __name__ == "__main__":
    main()
