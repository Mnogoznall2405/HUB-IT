"""Apply chat backend split wiring to service.py in safe order."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run(script_name: str) -> None:
    path = SCRIPTS / script_name
    print(f"=== {script_name} ===")
    subprocess.check_call([sys.executable, str(path)], cwd=str(ROOT))


def patch_service_imports_and_init() -> None:
    service_path = ROOT / "backend" / "chat" / "service.py"
    text = service_path.read_text(encoding="utf-8")
    block = """
from backend.chat.chat_folder_service import ChatFolderService
from backend.chat.chat_group_service import ChatGroupService
from backend.chat.chat_membership import ChatMembership
from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator
from backend.chat.chat_presence_service import ChatPresenceService
from backend.chat.chat_cache import ChatCache
from backend.chat.chat_forward_materializer import ChatForwardMaterializer
from backend.chat.chat_serialization import ChatSerialization
from backend.chat.chat_upload_orchestrator import ChatUploadOrchestrator
from backend.chat.chat_delivery_state import (
    find_existing_client_message as _find_existing_client_message_impl,
    get_or_create_conversation_state as _get_or_create_conversation_state_impl,
    increment_unread_counters_for_recipients as _increment_unread_counters_for_recipients_impl,
    mark_sender_message_seen as _mark_sender_message_seen_impl,
)
"""
    if "ChatMembership" not in text:
        anchor = "from backend.chat.chat_thread_read_store import ChatThreadReadStore"
        text = text.replace(anchor, anchor + block)
    init_block = """        self._membership = ChatMembership(self)
        self._group_service = ChatGroupService(self)
        self._presence_service = ChatPresenceService(self)
        self._folder_service = ChatFolderService(self)
        self._notification_orchestrator = ChatNotificationOrchestrator(self)
        self._cache = ChatCache(self)
        self._serialization = ChatSerialization(self)
        self._upload_orchestrator = ChatUploadOrchestrator(self)
        self._forward_materializer = ChatForwardMaterializer(self)
"""
    if "self._membership = ChatMembership(self)" not in text:
        text = text.replace(
            "        self._runtime_status: Optional[ChatRuntimeStatus] = None",
            "        self._runtime_status: Optional[ChatRuntimeStatus] = None\n" + init_block,
        )
    if "self._conversation_reads = ChatConversationReadStore(self)" not in text:
        text = text.replace(
            "        self._thread_reads = ChatThreadReadStore(self)",
            "        self._conversation_reads = ChatConversationReadStore(self)\n        self._thread_reads = ChatThreadReadStore(self)",
        )
    service_path.write_text(text, encoding="utf-8")
    print("patched imports/init")


def main() -> None:
    run("replace_service_conversation_delegates.py")
    run("replace_service_thread_delegates.py")
    patch_service_imports_and_init()
    run("wire_group_presence_folder.py")
    run("wire_chat_service_delegates.py")
    print("done")


if __name__ == "__main__":
    main()
