"""Generate chat backend split modules from service.py (ADR-0003)."""
from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SERVICE_PATH = REPO / "backend" / "chat" / "service.py"
CHAT_DIR = REPO / "backend" / "chat"


def read_service() -> str:
    return SERVICE_PATH.read_text(encoding="utf-8")


def extract_class_methods(source: str, class_name: str = "ChatService") -> dict[str, tuple[int, int, str]]:
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    result: dict[str, tuple[int, int, str]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != class_name:
            continue
        for item in node.body:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            start = item.lineno - 1
            end = item.end_lineno
            result[item.name] = (start, end, "".join(lines[start:end]))
    return result


def convert_method_body(method_src: str, *, service_attr: str = "_service") -> str:
    lines = method_src.splitlines()
    while lines and lines[0].strip().startswith("@"):
        lines.pop(0)
    if not lines:
        return ""
    def_line = lines[0]
    body_lines = lines[1:]
    out = [def_line]
    for line in body_lines:
        stripped = line.lstrip()
        if not stripped:
            out.append("")
            continue
        lead = line[: len(line) - len(stripped)]
        converted = re.sub(
            rf"\bself\.(?!{re.escape(service_attr)}\b)",
            f"self.{service_attr}.",
            stripped,
        )
        out.append(lead + converted)
    return "\n".join(out)


def build_store_file(
    *,
    module_doc: str,
    class_name: str,
    methods: dict[str, str],
    extra_imports: str = "",
) -> str:
    header = textwrap.dedent(f'''\
        """{module_doc}"""
        from __future__ import annotations

        from typing import TYPE_CHECKING, Any, Optional

        from sqlalchemy import and_, func, or_, select
        from sqlalchemy.orm import aliased

        from backend.chat.db import chat_session
        from backend.chat.models import (
            ChatConversation,
            ChatConversationUserState,
            ChatMember,
            ChatMessage,
            ChatMessageAttachment,
            ChatMessageRead,
            ChatMessageReaction,
        )
        from backend.chat.utils import normalize_text as _normalize_text
        {extra_imports}
        if TYPE_CHECKING:
            from backend.chat.service import ChatService


        class {class_name}:
            def __init__(self, service: ChatService) -> None:
                self._service = service

    ''')
    parts = [header]
    for name in sorted(methods.keys(), key=lambda n: methods[n].find("def ")):
        parts.append(convert_method_body(methods[name]))
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


THREAD_METHODS = [
    "get_messages",
    "get_thread_bootstrap",
    "search_messages",
    "get_message",
    "get_message_reads",
    "get_message_read_delta",
    "get_messages_for_users",
    "_serialize_thread_messages_payload",
]

CONV_EXTRA_METHODS = [
    "get_conversation",
    "get_conversation_summaries_for_users",
    "get_conversation_assets_summary",
    "list_conversation_attachments",
]

GROUP_METHODS = [
    "create_group_conversation",
    "add_group_members",
    "remove_group_member",
    "update_group_member_role",
    "leave_group",
    "update_group_profile",
    "update_group_avatar",
    "_require_group_manager",
    "_get_active_membership",
]

FOLDER_METHODS = [
    "list_chat_folders",
    "create_chat_folder",
    "update_chat_folder",
    "delete_chat_folder",
    "get_chat_folder",
    "set_chat_folder_conversations",
    "add_chat_folder_conversation",
    "remove_chat_folder_conversation",
]

PRESENCE_METHODS = [
    "get_presence",
    "_get_presence_map",
    "_get_users_map",
    "_serialize_user",
    "_build_presence_payload",
    "_build_message_read_receipts",
]

NOTIFICATION_METHODS = ["_create_chat_notifications"]

UPLOAD_METHODS = [
    "create_upload_session",
    "get_upload_session",
    "append_upload_session_chunk",
    "complete_upload_session",
    "cancel_upload_session",
    "_prepare_uploads",
    "_serialize_upload_session",
    "_serialize_upload_session_file",
    "_build_upload_session_file_manifest",
]

MEMBERSHIP_METHODS = [
    "_require_membership",
    "_lock_conversation_for_write",
    "_append_system_message",
    "_resolve_reply_message",
    "_conversation_member_ids",
    "_require_group_manager",
]

CACHE_METHODS = [
    "_cache_key",
    "_cache_get",
    "_cache_set",
    "_invalidate_user_cache",
    "_invalidate_conversation_views_for_users",
    "_set_request_meta",
    "get_request_meta",
    "clear_request_meta",
]


def pick(methods: dict[str, tuple[int, int, str]], names: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for n in names:
        if n not in methods:
            raise KeyError(f"Missing method: {n}")
        out[n] = methods[n][2]
    return out


def patch_serialize_lightweight(store_path: Path) -> None:
    text = store_path.read_text(encoding="utf-8")
    if "lightweight" in text:
        return
    old = "        has_newer: bool,\n    ) -> dict[str, Any]:"
    new = "        has_newer: bool,\n        lightweight: bool = False,\n    ) -> dict[str, Any]:"
    if old not in text:
        return
    text = text.replace(old, new, 1)
    insert_after = "        forward_previews = self._service._build_forward_previews("
    idx = text.find(insert_after)
    if idx == -1:
        store_path.write_text(text, encoding="utf-8")
        return
    # Find end of forward_previews block
    end_idx = text.find("\n        message_ids = ", idx)
    if end_idx == -1:
        store_path.write_text(text, encoding="utf-8")
        return
    lightweight_block = textwrap.dedent('''\

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
                "viewer_last_read_at": self._service._iso(getattr(viewer_state, "last_read_at", None)),
            }
''')
    text = text[:end_idx] + lightweight_block + text[end_idx:]
    store_path.write_text(text, encoding="utf-8")


def make_delegation(name: str, public: bool = True) -> str:
    # Keep signature from original - use pass-through delegation
    if name.startswith("_"):
        prefix = ""
    else:
        prefix = "        self._ensure_available()\n"
    store_map = {
        "list_conversations": "_conversation_reads",
        "get_unread_summary": "_conversation_reads",
        "get_unread_summaries": "_conversation_reads",
        "get_conversation_summary": "_conversation_reads",
        "get_conversation": "_conversation_reads",
        "get_conversation_summaries_for_users": "_conversation_reads",
        "get_conversation_assets_summary": "_conversation_reads",
        "list_conversation_attachments": "_conversation_reads",
        "get_messages": "_thread_reads",
        "get_thread_bootstrap": "_thread_reads",
        "search_messages": "_thread_reads",
        "get_message": "_thread_reads",
        "get_message_reads": "_thread_reads",
        "get_message_read_delta": "_thread_reads",
        "get_messages_for_users": "_thread_reads",
        "_serialize_thread_messages_payload": "_thread_reads",
        "create_group_conversation": "_group_service",
        "add_group_members": "_group_service",
        "remove_group_member": "_group_service",
        "update_group_member_role": "_group_service",
        "leave_group": "_group_service",
        "update_group_profile": "_group_service",
        "update_group_avatar": "_group_service",
        "create_upload_session": "_upload_orchestrator",
        "get_upload_session": "_upload_orchestrator",
        "append_upload_session_chunk": "_upload_orchestrator",
        "complete_upload_session": "_upload_orchestrator",
        "cancel_upload_session": "_upload_orchestrator",
        "_prepare_uploads": "_upload_orchestrator",
        "_create_chat_notifications": "_notification_orchestrator",
        "get_presence": "_presence_service",
        "list_chat_folders": "_folder_service",
        "create_chat_folder": "_folder_service",
        "update_chat_folder": "_folder_service",
        "delete_chat_folder": "_folder_service",
        "get_chat_folder": "_folder_service",
        "set_chat_folder_conversations": "_folder_service",
        "add_chat_folder_conversation": "_folder_service",
        "remove_chat_folder_conversation": "_folder_service",
        "_require_membership": "_membership",
        "_lock_conversation_for_write": "_membership",
        "_append_system_message": "_membership",
        "_resolve_reply_message": "_membership",
        "_conversation_member_ids": "_membership",
        "_cache_get": "_chat_cache",
        "_cache_set": "_chat_cache",
        "_cache_key": "_chat_cache",
        "_invalidate_user_cache": "_chat_cache",
        "_set_request_meta": "_chat_cache",
        "get_request_meta": "_chat_cache",
        "clear_request_meta": "_chat_cache",
    }
    target = store_map.get(name)
    if not target:
        return ""
    return f"{prefix}        return self.{target}.{name}(*args, **kwargs)\n"


def main() -> None:
    source = read_service()
    all_methods = extract_class_methods(source)

    # Phase 1: thread read store
    thread = pick(all_methods, THREAD_METHODS)
    thread_file = build_store_file(
        module_doc="Read-side thread/message queries extracted from ChatService.",
        class_name="ChatThreadReadStore",
        methods=thread,
        extra_imports="from typing import Any\n",
    )
    thread_path = CHAT_DIR / "chat_thread_read_store.py"
    thread_path.write_text(thread_file, encoding="utf-8")
    patch_serialize_lightweight(thread_path)

    # Extend conversation read store
    conv_extra = pick(all_methods, CONV_EXTRA_METHODS)
    conv_path = CHAT_DIR / "chat_conversation_read_store.py"
    conv_existing = conv_path.read_text(encoding="utf-8")
    conv_class_end = conv_existing.rfind("\n")
    extra_methods_text = "\n".join(convert_method_body(src) for src in conv_extra.values())
    if "def get_conversation(" not in conv_existing:
        conv_path.write_text(conv_existing.rstrip() + "\n\n" + extra_methods_text + "\n", encoding="utf-8")
        # Add ChatMessageAttachment import if needed
        if "ChatMessageAttachment" in extra_methods_text and "ChatMessageAttachment" not in conv_existing:
            conv_path.write_text(
                conv_path.read_text(encoding="utf-8").replace(
                    "    ChatMessage,\n)",
                    "    ChatMessage,\n    ChatMessageAttachment,\n)",
                ),
                encoding="utf-8",
            )
        if "from sqlalchemy import and_, func, select" in conv_path.read_text(encoding="utf-8"):
            conv_path.write_text(
                conv_path.read_text(encoding="utf-8").replace(
                    "from sqlalchemy import and_, func, select",
                    "from sqlalchemy import and_, func, or_, select",
                ),
                encoding="utf-8",
            )

    # Phase 3: membership
    membership = pick(all_methods, [m for m in MEMBERSHIP_METHODS if m in all_methods])
    membership_file = build_store_file(
        module_doc="Chat membership and conversation access helpers.",
        class_name="ChatMembership",
        methods=membership,
        extra_imports="from datetime import datetime, timezone\nfrom uuid import uuid4\n",
    )
    (CHAT_DIR / "chat_membership.py").write_text(membership_file, encoding="utf-8")

    # Phase 4: group service
    group = pick(all_methods, [m for m in GROUP_METHODS if m in all_methods])
    group_file = build_store_file(
        module_doc="Group conversation CRUD orchestration.",
        class_name="ChatGroupService",
        methods=group,
        extra_imports=textwrap.dedent('''\
            from datetime import datetime, timezone
            from uuid import uuid4

            from backend.chat.chat_formatting import (
                _display_user_name,
                _normalize_member_role,
                _utc_now,
            )
        '''),
    )
    (CHAT_DIR / "chat_group_service.py").write_text(group_file, encoding="utf-8")

    # Phase 6: notification orchestrator
    notif = pick(all_methods, NOTIFICATION_METHODS)
    notif_file = build_store_file(
        module_doc="Chat notification side-effect orchestration.",
        class_name="ChatNotificationOrchestrator",
        methods=notif,
        extra_imports=textwrap.dedent('''\
            import logging
            import time
            from datetime import datetime, timezone

            from backend.chat.notification_planner import build_chat_notification_recipient_plans
            from backend.services.user_service import user_service

            logger = logging.getLogger("backend.chat.service")
        '''),
    )
    (CHAT_DIR / "chat_notification_orchestrator.py").write_text(notif_file, encoding="utf-8")

    # Phase 6: presence
    presence = pick(all_methods, PRESENCE_METHODS)
    presence_file = build_store_file(
        module_doc="Presence and user serialization for chat.",
        class_name="ChatPresenceService",
        methods=presence,
        extra_imports=textwrap.dedent('''\
            from datetime import datetime, timedelta, timezone

            from backend.chat.chat_constants import CHAT_PRESENCE_ONLINE_WINDOW
            from backend.chat.chat_formatting import _iso, _parse_dt, _utc_now
            from backend.services.session_service import session_service
            from backend.services.user_service import user_service
        '''),
    )
    (CHAT_DIR / "chat_presence_service.py").write_text(presence_file, encoding="utf-8")

    # Phase 7: folders
    folders = pick(all_methods, FOLDER_METHODS)
    folder_file = build_store_file(
        module_doc="Chat folder management.",
        class_name="ChatFolderService",
        methods=folders,
        extra_imports=textwrap.dedent('''\
            from datetime import datetime, timezone
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
    )
    (CHAT_DIR / "chat_folder_service.py").write_text(folder_file, encoding="utf-8")

    print("Generated core split modules.")
    print("Thread store:", thread_path)
    print("Methods:", len(thread))


if __name__ == "__main__":
    main()
