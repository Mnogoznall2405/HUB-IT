"""Regenerate chat_thread_read_store.py from git HEAD service.py implementations."""
from __future__ import annotations

import ast
import re
import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "backend" / "chat" / "chat_thread_read_store.py"

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


def load_head_service() -> str:
    return subprocess.check_output(
        ["git", "show", "HEAD:WEB-itinvent/backend/chat/service.py"],
        text=True,
        encoding="utf-8",
    )


def extract_methods(source: str) -> dict[str, str]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    out: dict[str, str] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "ChatService":
            continue
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and item.name in METHODS:
                out[item.name] = "".join(lines[item.lineno - 1 : item.end_lineno])
    return out


def to_store_method(src: str) -> str:
    lines = src.splitlines()
    while lines and lines[0].strip().startswith("@"):
        lines.pop(0)
    def_line = lines[0]
    body = lines[1:]
    converted = [def_line]
    for line in body:
        stripped = line.lstrip()
        if not stripped:
            converted.append("")
            continue
        lead = line[: len(line) - len(stripped)]
        if stripped == "self._ensure_available()":
            continue
        new = re.sub(r"\bself\.(?!_service\b)", "self._service.", stripped)
        converted.append(lead + new)
    return "\n".join(converted)


def main() -> None:
    methods = extract_methods(load_head_service())
    missing = set(METHODS) - set(methods)
    if missing:
        raise SystemExit(f"Missing methods in HEAD: {missing}")

    header = textwrap.dedent('''\
        """Read-side thread/message queries extracted from ChatService."""
        from __future__ import annotations

        from typing import TYPE_CHECKING, Any, Optional

        from sqlalchemy import and_, func, or_, select

        from backend.chat.chat_formatting import _iso
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

    ''')

    parts = [header]
    for name in METHODS:
        body = to_store_method(methods[name])
        if name == "_serialize_thread_messages_payload":
            body = body.replace(
                ") -> dict[str, Any]:",
                ",\n        lightweight: bool = False,\n    ) -> dict[str, Any]:",
                1,
            )
            insert_marker = "        forward_previews = self._service._build_forward_previews("
            idx = body.find(insert_marker)
            if idx != -1:
                end = body.find("\n        message_ids = ", idx)
                lightweight = textwrap.dedent('''\

                if lightweight:
                    return {
                        "items": [
                            self._service._serialize_message(
                                conversation_kind=conversation.kind,
                                message=item,
                                current_user_id=int(current_user_id),
                                users_by_id=users_by_id,
                                member_ids=member_ids,
                                states_by_user_id=states_by_user_id,
                                reads_by_message_id=reads_by_message_id,
                                reply_previews=reply_previews,
                                forward_previews=forward_previews,
                                attachments=attachments_by_message.get(item.id, []),
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
                        "viewer_last_read_at": _iso(getattr(viewer_state, "last_read_at", None)),
                    }
                ''')
                body = body[:end] + lightweight + body[end:]
        parts.append(body)
        parts.append("")

    OUT.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
