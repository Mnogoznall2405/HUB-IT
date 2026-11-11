"""Regenerate split chat modules from git HEAD service.py."""
from __future__ import annotations

import ast
import re
import subprocess
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CHAT = REPO / "backend" / "chat"

MODULES: dict[str, dict] = {
    "chat_group_service.py": {
        "class_name": "ChatGroupService",
        "doc": "Group and direct conversation mutations.",
        "methods": [
            "create_direct_conversation",
            "get_or_create_notes_conversation",
            "create_group_conversation",
            "add_group_members",
            "remove_group_member",
            "update_group_member_role",
            "transfer_group_ownership",
            "leave_group",
            "update_group_profile",
            "update_group_avatar",
            "get_group_avatar_file_path",
        ],
        "extra_imports": textwrap.dedent('''\
            from uuid import uuid4

            from backend.chat.chat_constants import NOTES_CONVERSATION_TITLE
            from backend.chat.chat_formatting import (
                _direct_key,
                _display_user_name,
                _normalize_member_role,
                _notes_key,
                _utc_now,
            )
        '''),
    },
    "chat_membership.py": {
        "class_name": "ChatMembership",
        "doc": "Chat membership and conversation access helpers.",
        "methods": [
            "_require_membership",
            "_get_active_membership",
            "_require_group_membership",
            "_require_group_manager",
            "_require_group_owner",
            "_lock_conversation_for_write",
            "_conversation_member_ids",
            "_append_system_message",
            "_resolve_reply_message",
        ],
        "extra_imports": "from backend.chat.chat_formatting import _normalize_member_role\n",
    },
    "chat_folder_service.py": {
        "class_name": "ChatFolderService",
        "doc": "Chat folder management.",
        "methods": [
            "list_chat_folders",
            "create_chat_folder",
            "update_chat_folder",
            "delete_chat_folder",
            "get_chat_folder",
            "set_chat_folder_conversations",
            "add_chat_folder_conversation",
            "remove_chat_folder_conversation",
        ],
        "extra_imports": textwrap.dedent('''\
            from uuid import uuid4

            from backend.chat.folder_mutations import (
                normalize_folder_conversation_ids,
                require_owned_chat_folder,
                serialize_chat_folder,
                sum_unread_for_conversations,
            )
            from backend.chat.models import ChatFolder, ChatFolderConversation
            from backend.chat.chat_formatting import _utc_now
        '''),
    },
    "chat_presence_service.py": {
        "class_name": "ChatPresenceService",
        "doc": "Presence and user serialization for chat.",
        "methods": [
            "get_presence",
            "_get_presence_map",
            "_build_presence_payload",
            "_build_message_read_receipts",
            "_get_users_map",
            "_serialize_user",
            "_mask_database_url",
        ],
        "extra_imports": textwrap.dedent('''\
            from backend.chat.chat_constants import CHAT_PRESENCE_ONLINE_WINDOW
            from backend.chat.chat_formatting import _iso, _parse_dt, _utc_now
            from backend.services.session_service import session_service
            from backend.services.user_service import user_service
        '''),
    },
    "chat_notification_orchestrator.py": {
        "class_name": "ChatNotificationOrchestrator",
        "doc": "Chat notification side-effect orchestration.",
        "methods": ["_create_chat_notifications", "_upsert_chat_push_outbox_job"],
        "extra_imports": textwrap.dedent('''\
            import logging
            import time

            from backend.chat.notification_planner import build_chat_notification_recipient_plans
            from backend.chat.chat_formatting import _utc_now
            from backend.services.user_service import user_service

            logger = logging.getLogger("backend.chat.service")
        '''),
    },
}


def head_service() -> str:
    return subprocess.check_output(
        ["git", "show", "HEAD:WEB-itinvent/backend/chat/service.py"],
        text=True,
        encoding="utf-8",
    )


def extract(source: str, names: list[str]) -> dict[str, str]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    out: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "ChatService":
            for item in node.body:
                if isinstance(item, ast.FunctionDef) and item.name in names:
                    out[item.name] = "".join(lines[item.lineno - 1 : item.end_lineno])
    return out


def convert(body: str) -> str:
    lines = body.splitlines()
    while lines and lines[0].strip().startswith("@"):
        lines.pop(0)
    out = [lines[0]]
    for line in lines[1:]:
        stripped = line.lstrip()
        if not stripped:
            out.append("")
            continue
        lead = line[: len(line) - len(stripped)]
        if stripped == "self._ensure_available()":
            continue
        out.append(lead + re.sub(r"\bself\.(?!_service\b)", "self._service.", stripped))
    return "\n".join(out)


def write_module(path: Path, *, class_name: str, doc: str, methods: dict[str, str], extra_imports: str) -> None:
    header = textwrap.dedent(f'''\
        """{doc}"""
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
        )
        {extra_imports}
        if TYPE_CHECKING:
            from backend.chat.service import ChatService


        class {class_name}:
            def __init__(self, service: "ChatService") -> None:
                self._service = service

    ''')
    parts = [header]
    for name in methods:
        parts.append(convert(methods[name]))
        parts.append("")
    path.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    source = head_service()
    for filename, spec in MODULES.items():
        names = spec["methods"]
        found = extract(source, names)
        missing = [n for n in names if n not in found]
        if missing:
            raise SystemExit(f"{filename} missing methods: {missing}")
        write_module(
            CHAT / filename,
            class_name=spec["class_name"],
            doc=spec["doc"],
            methods={n: found[n] for n in names},
            extra_imports=spec["extra_imports"],
        )
        print("OK", filename, len(names))


if __name__ == "__main__":
    main()
