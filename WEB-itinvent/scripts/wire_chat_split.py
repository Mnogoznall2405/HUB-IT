"""Wire ChatService delegations to split modules."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATIONS: dict[str, tuple[str, str]] = {
    # group service
    "create_direct_conversation": ("_group_service", "create_direct_conversation"),
    "get_or_create_notes_conversation": ("_group_service", "get_or_create_notes_conversation"),
    "create_group_conversation": ("_group_service", "create_group_conversation"),
    "add_group_members": ("_group_service", "add_group_members"),
    "remove_group_member": ("_group_service", "remove_group_member"),
    "update_group_member_role": ("_group_service", "update_group_member_role"),
    "transfer_group_ownership": ("_group_service", "transfer_group_ownership"),
    "leave_group": ("_group_service", "leave_group"),
    "update_group_profile": ("_group_service", "update_group_profile"),
    "update_group_avatar": ("_group_service", "update_group_avatar"),
    "get_group_avatar_file_path": ("_group_service", "get_group_avatar_file_path"),
    # presence
    "get_presence": ("_presence_service", "get_presence"),
    "_get_presence_map": ("_presence_service", "_get_presence_map"),
    "_get_users_map": ("_presence_service", "_get_users_map"),
    "_serialize_user": ("_presence_service", "_serialize_user"),
    "_build_presence_payload": ("_presence_service", "_build_presence_payload"),
    "_build_message_read_receipts": ("_presence_service", "_build_message_read_receipts"),
    "_mask_database_url": ("_presence_service", "_mask_database_url"),
    # folders
    "list_chat_folders": ("_folder_service", "list_chat_folders"),
    "create_chat_folder": ("_folder_service", "create_chat_folder"),
    "update_chat_folder": ("_folder_service", "update_chat_folder"),
    "delete_chat_folder": ("_folder_service", "delete_chat_folder"),
    "get_chat_folder": ("_folder_service", "get_chat_folder"),
    "set_chat_folder_conversations": ("_folder_service", "set_chat_folder_conversations"),
    "add_chat_folder_conversation": ("_folder_service", "add_chat_folder_conversation"),
    "remove_chat_folder_conversation": ("_folder_service", "remove_chat_folder_conversation"),
    # membership
    "_require_membership": ("_membership", "_require_membership"),
    "_get_active_membership": ("_membership", "_get_active_membership"),
    "_require_group_membership": ("_membership", "_require_group_membership"),
    "_require_group_manager": ("_membership", "_require_group_manager"),
    "_require_group_owner": ("_membership", "_require_group_owner"),
    "_lock_conversation_for_write": ("_membership", "_lock_conversation_for_write"),
    "_conversation_member_ids": ("_membership", "_conversation_member_ids"),
    "_append_system_message": ("_membership", "_append_system_message"),
    "_resolve_reply_message": ("_membership", "_resolve_reply_message"),
    # notifications
    "_create_chat_notifications": ("_notification_orchestrator", "_create_chat_notifications"),
}


def make_wrapper(method_name: str, target_attr: str, target_method: str, src: str) -> str | None:
    pattern = rf"(\n    def {re.escape(method_name)}\([^)]*\)(?: -> [^:]+)?:\n)(.*?)(?=\n    def |\n\nchat_service = )"
    match = re.search(pattern, src, flags=re.DOTALL)
    if not match:
        return None
    header = match.group(1)
    # preserve signature line only
    sig_line = header.strip().split("\n")[-1]
    if method_name.startswith("_") and method_name != "_create_chat_notifications":
        body = f"        return self.{target_attr}.{target_method}(*args, **kwargs)\n"
        # rebuild with explicit kwargs from signature - use **kwargs pattern won't work for all
        # Use direct pass-through by parsing signature
        pass
    return None


def main() -> None:
    text = SERVICE.read_text(encoding="utf-8")
    imports = """
from backend.chat.chat_folder_service import ChatFolderService
from backend.chat.chat_group_service import ChatGroupService
from backend.chat.chat_membership import ChatMembership
from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator
from backend.chat.chat_presence_service import ChatPresenceService
"""
    if "ChatMembership" not in text:
        text = text.replace(
            "from backend.chat.chat_thread_read_store import ChatThreadReadStore\n",
            "from backend.chat.chat_thread_read_store import ChatThreadReadStore\n" + imports,
        )
    init_block = """        self._membership = ChatMembership(self)
        self._group_service = ChatGroupService(self)
        self._presence_service = ChatPresenceService(self)
        self._folder_service = ChatFolderService(self)
        self._notification_orchestrator = ChatNotificationOrchestrator(self)
"""
    if "_membership = ChatMembership" not in text:
        text = text.replace(
            "        self._runtime_status: Optional[ChatRuntimeStatus] = None\n",
            "        self._runtime_status: Optional[ChatRuntimeStatus] = None\n" + init_block,
        )
    SERVICE.write_text(text, encoding="utf-8")
    print("Added imports and init wiring")


if __name__ == "__main__":
    main()
