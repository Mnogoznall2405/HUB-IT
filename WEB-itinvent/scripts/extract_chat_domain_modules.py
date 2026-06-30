"""Extract ChatService methods into domain service modules."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_PATH = ROOT / "backend" / "chat" / "service_git_head.py"

MODULE_SPECS: dict[str, dict] = {
    "chat_membership": {
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
        "extra_imports": (
            "from datetime import datetime\n\n"
            "from backend.chat.chat_constants import CHAT_GROUP_MANAGER_ROLES\n"
            "from backend.chat.chat_formatting import _normalize_member_role\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": ["_system_message_persistence"],
    },
    "chat_group_service": {
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
        "extra_imports": (
            "from uuid import uuid4\n\n"
            "from backend.chat.chat_constants import NOTES_CONVERSATION_TITLE\n"
            "from backend.chat.chat_formatting import (\n"
            "    _direct_key,\n"
            "    _display_user_name,\n"
            "    _normalize_member_role,\n"
            "    _notes_key,\n"
            "    _utc_now,\n"
            ")\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_require_membership", "_get_active_membership", "_require_group_membership",
            "_require_group_manager", "_require_group_owner", "_lock_conversation_for_write",
            "_conversation_member_ids", "_append_system_message", "_invalidate_conversation_views_for_users",
            "_build_conversation_detail_payload", "_serialize_conversation", "_get_users_map",
            "_get_presence_map", "_list_attachments_by_message", "_cache_get", "_cache_set",
            "_invalidate_user_cache", "group_max_members",
        ],
    },
    "chat_notification_orchestrator": {
        "class_name": "ChatNotificationOrchestrator",
        "doc": "Notification planning and dispatch orchestration.",
        "methods": ["_upsert_chat_push_outbox_job", "_create_chat_notifications"],
        "extra_imports": (
            "import logging\n"
            "import time\n"
            "from typing import Any\n\n"
            "from backend.chat.notification_planner import build_chat_notification_recipient_plans\n"
            "from backend.services.user_service import user_service\n\n"
            "logger = logging.getLogger('backend.chat.service')"
        ),
        "self_prefixes": [
            "_extract_mention_handles", "_resolve_mentioned_member_user_ids",
            "_get_users_map", "_notification_dispatcher", "_log_chat_service_timing",
        ],
    },
    "chat_presence_service": {
        "class_name": "ChatPresenceService",
        "doc": "Presence and user map helpers.",
        "methods": [
            "get_presence",
            "_get_presence_map",
            "_build_presence_payload",
            "_build_message_read_receipts",
            "_get_users_map",
            "_serialize_user",
            "_mask_database_url",
        ],
        "extra_imports": (
            "from backend.chat.chat_formatting import _iso, _parse_dt\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_cache_get", "_cache_set", "_presence_cache", "_cache_lock",
            "chat_cache_ttl_sec", "_PRESENCE_CACHE_TTL_SEC", "_USERS_CACHE_TTL_SEC",
        ],
    },
    "chat_folder_service": {
        "class_name": "ChatFolderService",
        "doc": "Chat folder CRUD.",
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
        "extra_imports": (
            "from uuid import uuid4\n\n"
            "from backend.chat.chat_formatting import _utc_now\n"
            "from backend.chat.folder_mutations import (\n"
            "    normalize_folder_conversation_ids,\n"
            "    require_owned_chat_folder,\n"
            "    serialize_chat_folder,\n"
            "    sum_unread_for_conversations,\n"
            ")\n"
            "from backend.chat.models import ChatFolder, ChatFolderConversation\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_cache_get", "_cache_set", "_invalidate_user_cache", "_require_membership",
        ],
    },
    "chat_cache": {
        "class_name": "ChatCache",
        "doc": "In-memory chat runtime cache helpers.",
        "methods": [
            "_cache_key",
            "_cache_get",
            "_cache_set",
            "_invalidate_user_cache",
            "_invalidate_conversation_views_for_users",
        ],
        "extra_imports": (
            "from datetime import datetime\n"
            "from typing import Any\n\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": ["_cache_lock", "_runtime_cache", "chat_cache_ttl_sec"],
    },
    "chat_serialization": {
        "class_name": "ChatSerialization",
        "doc": "Conversation and message payload serialization.",
        "methods": [
            "_serialize_upload_session_file",
            "_serialize_upload_session",
            "_build_conversation_payload",
            "_build_conversation_summary_payload",
            "_build_conversation_detail_payload",
            "_serialize_conversation_members",
            "_serialize_conversation",
            "_collect_message_payload_user_ids",
            "_serialize_message",
            "_get_message_action_card",
            "_build_conversation_message_preview",
            "_build_reply_previews",
            "_build_forward_previews",
            "_build_message_search_haystack",
            "_build_message_payload_for_members",
        ],
        "extra_imports": (
            "from datetime import datetime\n\n"
            "from backend.chat.chat_constants import CHAT_DELETED_MESSAGE_BODY\n"
            "from backend.chat.chat_formatting import (\n"
            "    _display_user_name,\n"
            "    _iso,\n"
            "    _normalize_body_format,\n"
            "    _normalize_member_role,\n"
            "    _strip_markdown_preview,\n"
            "    _truncate_text,\n"
            ")\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_get_short_user_name", "_count_unread_messages", "_get_users_map", "_get_presence_map",
            "_list_attachments_by_message", "_batch_action_cards_for_messages", "_deserialize_task_preview",
            "_normalize_message_kind", "_attachment_to_payload", "_build_presence_payload",
            "_build_message_read_receipts",
        ],
    },
    "chat_upload_orchestrator": {
        "class_name": "ChatUploadOrchestrator",
        "doc": "Upload session and inline file send orchestration.",
        "methods": [
            "_upload_session_dir",
            "_upload_session_manifest_path",
            "_upload_session_part_path",
            "_normalize_transfer_encoding",
            "_serialize_upload_session_file",
            "_serialize_upload_session",
            "create_upload_session",
            "get_upload_session",
            "complete_upload_session",
            "cancel_upload_session",
            "send_files",
            "_prepare_uploads",
        ],
        "extra_imports": (
            "import asyncio\n"
            "import gzip\n"
            "import json\n"
            "import mimetypes\n"
            "import os\n"
            "import shutil\n"
            "from pathlib import Path\n"
            "from uuid import uuid4\n\n"
            "from fastapi import UploadFile\n\n"
            "from backend.chat.chat_constants import (\n"
            "    CHAT_ALLOWED_EXTENSIONS,\n"
            "    CHAT_ALLOWED_MIME_PREFIXES,\n"
            "    CHAT_ALLOWED_MIME_TYPES,\n"
            "    CHAT_ALLOWED_TRANSFER_ENCODINGS,\n"
            "    CHAT_ARCHIVE_EXTENSIONS,\n"
            "    CHAT_ARCHIVE_MIME_TYPES,\n"
            "    CHAT_MAX_FILES_PER_MESSAGE,\n"
            "    CHAT_MAX_TOTAL_FILE_BYTES,\n"
            ")\n"
            "from backend.chat.chat_formatting import _probe_image_dimensions, _safe_file_name, _utc_now\n"
            "from backend.chat.upload_session_transfer import plan_upload_session_chunk\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_upload_sessions_root", "_upload_sessions", "_upload_session_completion",
            "_attachments_root", "_attachment_media", "_require_membership", "_lock_conversation_for_write",
            "_conversation_member_ids", "_resolve_reply_message", "_file_message_persistence",
            "_create_chat_notifications", "_invalidate_conversation_views_for_users",
            "_write_decoded_transfer_payload", "_upload_cleanup_task", "_upload_cleanup_stop_event",
            "upload_session_chunk_size_bytes", "upload_session_ttl_sec", "upload_session_cleanup_interval_sec",
            "_serialize_upload_session", "_serialize_upload_session_file",
        ],
    },
    "chat_forward_materializer": {
        "class_name": "ChatForwardMaterializer",
        "doc": "Forward message snapshot and attachment materialization.",
        "methods": ["materialize_forward"],
        "extra_imports": (
            "import shutil\n"
            "from pathlib import Path\n"
            "from uuid import uuid4\n\n"
            "from backend.chat.chat_constants import CHAT_MAX_FILES_PER_MESSAGE, CHAT_MAX_TOTAL_FILE_BYTES\n"
            "from backend.chat.chat_formatting import _normalize_body_format, _safe_file_name\n"
            "from backend.chat.message_persistence import ForwardMessageSnapshot\n"
            "from backend.chat.utils import normalize_text as _normalize_text"
        ),
        "self_prefixes": [
            "_require_membership", "_conversation_member_ids", "_resolve_reply_message",
            "_normalize_message_kind", "_list_attachments_by_message", "_task_is_shareable_to_members",
            "_deserialize_task_preview", "_attachments_root", "_resolve_attachment_path",
        ],
        "custom_methods": {
            "materialize_forward": "forward_materializer_method",
        },
    },
}


def extract_method(lines: list[str], name: str) -> list[str]:
    pat = re.compile(rf"^    def {re.escape(name)}\(")
    start = next(i for i, line in enumerate(lines) if pat.match(line))
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if lines[j].startswith("    def ") or lines[j].startswith("chat_service"):
            end = j
            break
    chunk = lines[start:end]
    while chunk and (not chunk[-1].strip() or chunk[-1].strip().startswith("@")):
        chunk.pop()
    return chunk


def transform_method(chunk: list[str], self_prefixes: list[str]) -> list[str]:
    out: list[str] = []
    skip_static = False
    for line in chunk:
        stripped = line.strip()
        if stripped == "@staticmethod":
            skip_static = True
            continue
        if skip_static and stripped.startswith("def "):
            skip_static = False
        text = line
        text = text.replace("self._ensure_available()", "")
        for prefix in sorted(self_prefixes, key=len, reverse=True):
            text = re.sub(rf"\bself\.{re.escape(prefix)}\b", f"self._service.{prefix}", text)
        out.append(text)
    return out


def build_forward_materializer_method(lines: list[str]) -> list[str]:
    """Extract forward prep logic as materialize_forward from forward_message."""
    forward_lines = extract_method(lines, "forward_message")
    body = [
        "    def materialize_forward(",
        "        self,",
        "        *,",
        "        current_user_id: int,",
        "        conversation_id: str,",
        "        source_message_id: str,",
        "        reply_to_message_id: str | None = None,",
        "    ) -> tuple[ForwardMessageSnapshot, list[dict], list[Path], dict]:",
        '        """Build forward snapshot and copy attachment files. Caller owns cleanup of written_paths."""',
        "        normalized_source_message_id = _normalize_text(source_message_id)",
        "        if not normalized_source_message_id:",
        '            raise ValueError("source_message_id is required")',
        "        written_paths: list[Path] = []",
        '        source_kind = "text"',
        '        source_body = ""',
        "        source_attachments: list[ChatMessageAttachment] = []",
        "        source_task_preview: dict | None = None",
        "        prepared_attachments: list[dict] = []",
        "        source_snapshot: ForwardMessageSnapshot | None = None",
        "        task_id: str | None = None",
        "        with chat_session() as session:",
    ]
    inside = False
    for line in forward_lines:
        if "with chat_session() as session:" in line:
            inside = True
            continue
        if not inside:
            continue
        if "if source_snapshot is None:" in line:
            break
        if line.strip().startswith("def _validate_forward"):
            break
        body.append(transform_method([line], MODULE_SPECS["chat_forward_materializer"]["self_prefixes"])[0])
    body.extend(
        [
            "        if source_snapshot is None:",
            '            raise ValueError("Forward source snapshot is missing")',
            "        return source_snapshot, prepared_attachments, written_paths, {",
            '            "source_kind": source_kind,',
            '            "source_body": source_body,',
            '            "source_attachments": source_attachments,',
            '            "source_task_preview": source_task_preview,',
            '            "task_id": task_id,',
            "        }",
        ]
    )
    return body


def render_module(spec: dict, lines: list[str]) -> str:
    methods_body: list[str] = []
    custom = spec.get("custom_methods") or {}
    for name in spec["methods"]:
        if custom.get(name) == "forward_materializer_method":
            methods_body.extend(build_forward_materializer_method(lines))
        else:
            methods_body.extend(transform_method(extract_method(lines, name), spec["self_prefixes"]))
        methods_body.append("")
    header = (
        f'"""{spec["doc"]}"""\n'
        "from __future__ import annotations\n\n"
        "from typing import TYPE_CHECKING, Any, Optional\n\n"
        "from sqlalchemy import and_, func, or_, select\n\n"
        "from backend.chat.db import chat_session\n"
        "from backend.chat.models import (\n"
        "    ChatConversation,\n"
        "    ChatConversationUserState,\n"
        "    ChatMember,\n"
        "    ChatMessage,\n"
        "    ChatMessageAttachment,\n"
        "    ChatMessageRead,\n"
        "    ChatMessageReaction,\n"
        ")\n"
        f"{spec['extra_imports']}\n\n"
        "if TYPE_CHECKING:\n"
        '    from backend.chat.service import ChatService\n\n\n'
        f"class {spec['class_name']}:\n"
        '    def __init__(self, service: "ChatService") -> None:\n'
        "        self._service = service\n\n"
    )
    return header + "\n".join(methods_body).rstrip() + "\n"


def main() -> None:
    lines = SERVICE_PATH.read_text(encoding="utf-8").splitlines()
    for module_name, spec in MODULE_SPECS.items():
        out_path = ROOT / "backend" / "chat" / f"{module_name}.py"
        out_path.write_text(render_module(spec, lines), encoding="utf-8")
        print("wrote", out_path)


if __name__ == "__main__":
    main()
