"""Replace group/presence/folder/notification methods with thin delegates."""
from __future__ import annotations

import re
from pathlib import Path

SERVICE_PATH = Path(__file__).resolve().parents[1] / "backend" / "chat" / "service.py"

DELEGATES = {
    "create_direct_conversation": '''    def create_direct_conversation(self, *, current_user_id: int, peer_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.create_direct_conversation(current_user_id=current_user_id, peer_user_id=peer_user_id)
''',
    "get_or_create_notes_conversation": '''    def get_or_create_notes_conversation(self, *, current_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.get_or_create_notes_conversation(current_user_id=current_user_id)
''',
    "create_group_conversation": '''    def create_group_conversation(self, *, current_user_id: int, title: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        return self._group_service.create_group_conversation(current_user_id=current_user_id, title=title, member_user_ids=member_user_ids)
''',
    "add_group_members": '''    def add_group_members(self, *, current_user_id: int, conversation_id: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        return self._group_service.add_group_members(current_user_id=current_user_id, conversation_id=conversation_id, member_user_ids=member_user_ids)
''',
    "remove_group_member": '''    def remove_group_member(self, *, current_user_id: int, conversation_id: str, target_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.remove_group_member(current_user_id=current_user_id, conversation_id=conversation_id, target_user_id=target_user_id)
''',
    "update_group_member_role": '''    def update_group_member_role(self, *, current_user_id: int, conversation_id: str, target_user_id: int, member_role: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_member_role(
            current_user_id=current_user_id,
            conversation_id=conversation_id,
            target_user_id=target_user_id,
            member_role=member_role,
        )
''',
    "transfer_group_ownership": '''    def transfer_group_ownership(self, *, current_user_id: int, conversation_id: str, owner_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.transfer_group_ownership(current_user_id=current_user_id, conversation_id=conversation_id, owner_user_id=owner_user_id)
''',
    "leave_group": '''    def leave_group(self, *, current_user_id: int, conversation_id: str) -> dict:
        self._ensure_available()
        return self._group_service.leave_group(current_user_id=current_user_id, conversation_id=conversation_id)
''',
    "update_group_profile": '''    def update_group_profile(self, *, current_user_id: int, conversation_id: str, title: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_profile(current_user_id=current_user_id, conversation_id=conversation_id, title=title)
''',
    "update_group_avatar": '''    def update_group_avatar(self, *, current_user_id: int, conversation_id: str, avatar_url: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_avatar(current_user_id=current_user_id, conversation_id=conversation_id, avatar_url=avatar_url)
''',
    "get_group_avatar_file_path": '''    def get_group_avatar_file_path(self, *, current_user_id: int, filename: str) -> Path:
        self._ensure_available()
        return self._group_service.get_group_avatar_file_path(current_user_id=current_user_id, filename=filename)
''',
    "get_presence": '''    def get_presence(self, *, user_id: int) -> dict:
        self._ensure_available()
        return self._presence_service.get_presence(user_id=user_id)
''',
    "_get_presence_map": '''    def _get_presence_map(self, *, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        return self._presence_service._get_presence_map(user_ids=user_ids)
''',
    "_build_presence_payload": '''    def _build_presence_payload(self, *, is_online: bool, last_seen_at: Optional[datetime], typing_in_conversation_id: Optional[str] = None) -> dict:
        return self._presence_service._build_presence_payload(
            is_online=is_online,
            last_seen_at=last_seen_at,
            typing_in_conversation_id=typing_in_conversation_id,
        )
''',
    "_build_message_read_receipts": '''    def _build_message_read_receipts(self, *, session, message: ChatMessage, member_user_ids: list[int], current_user_id: int) -> list[dict]:
        return self._presence_service._build_message_read_receipts(
            session=session,
            message=message,
            member_user_ids=member_user_ids,
            current_user_id=current_user_id,
        )
''',
    "_get_users_map": '''    def _get_users_map(self, *, presence_map: Optional[dict[int, dict]] = None, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        return self._presence_service._get_users_map(presence_map=presence_map, user_ids=user_ids)
''',
    "_serialize_user": '''    def _serialize_user(self, item: dict, *, presence_map: Optional[dict[int, dict]] = None) -> dict:
        return self._presence_service._serialize_user(item=item, presence_map=presence_map)
''',
    "_mask_database_url": '''    def _mask_database_url(self, value: object) -> str:
        return self._presence_service._mask_database_url(value=value)
''',
    "list_chat_folders": '''    def list_chat_folders(self, *, current_user_id: int) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.list_chat_folders(current_user_id=current_user_id)
''',
    "create_chat_folder": '''    def create_chat_folder(self, *, current_user_id: int, name: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.create_chat_folder(current_user_id=current_user_id, name=name)
''',
    "update_chat_folder": '''    def update_chat_folder(self, *, current_user_id: int, folder_id: str, name: Optional[str] = None, sort_order: Optional[int] = None) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.update_chat_folder(
            current_user_id=current_user_id,
            folder_id=folder_id,
            name=name,
            sort_order=sort_order,
        )
''',
    "delete_chat_folder": '''    def delete_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.delete_chat_folder(current_user_id=current_user_id, folder_id=folder_id)
''',
    "get_chat_folder": '''    def get_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.get_chat_folder(current_user_id=current_user_id, folder_id=folder_id)
''',
    "set_chat_folder_conversations": '''    def set_chat_folder_conversations(self, *, current_user_id: int, folder_id: str, conversation_ids: list[str]) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.set_chat_folder_conversations(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_ids=conversation_ids,
        )
''',
    "add_chat_folder_conversation": '''    def add_chat_folder_conversation(self, *, current_user_id: int, folder_id: str, conversation_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.add_chat_folder_conversation(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_id=conversation_id,
        )
''',
    "remove_chat_folder_conversation": '''    def remove_chat_folder_conversation(self, *, current_user_id: int, folder_id: str, conversation_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.remove_chat_folder_conversation(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_id=conversation_id,
        )
''',
    "_create_chat_notifications": '''    def _create_chat_notifications(
        self,
        *,
        sender_user_id: int,
        conversation_id: str,
        message_id: str,
        event_type: str,
        title: str,
        body: str,
        defer_push_notifications: bool = False,
        mentioned_user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None,
    ) -> dict[str, Any]:
        return self._notification_orchestrator._create_chat_notifications(
            sender_user_id=sender_user_id,
            conversation_id=conversation_id,
            message_id=message_id,
            event_type=event_type,
            title=title,
            body=body,
            defer_push_notifications=defer_push_notifications,
            mentioned_user_ids=mentioned_user_ids,
        )
''',
    "_require_membership": '''    def _require_membership(self, *, session, conversation_id: str, current_user_id: int) -> ChatConversation:
        return self._membership._require_membership(session=session, conversation_id=conversation_id, current_user_id=current_user_id)
''',
    "_get_active_membership": '''    def _get_active_membership(self, *, session, conversation_id: str, user_id: int) -> ChatMember | None:
        return self._membership._get_active_membership(session=session, conversation_id=conversation_id, user_id=user_id)
''',
    "_require_group_membership": '''    def _require_group_membership(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_membership(session=session, conversation_id=conversation_id, current_user_id=current_user_id)
''',
    "_require_group_manager": '''    def _require_group_manager(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_manager(session=session, conversation_id=conversation_id, current_user_id=current_user_id)
''',
    "_require_group_owner": '''    def _require_group_owner(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_owner(session=session, conversation_id=conversation_id, current_user_id=current_user_id)
''',
    "_lock_conversation_for_write": '''    def _lock_conversation_for_write(self, *, session, conversation_id: str) -> ChatConversation:
        return self._membership._lock_conversation_for_write(session=session, conversation_id=conversation_id)
''',
    "_conversation_member_ids": '''    def _conversation_member_ids(self, session, conversation_id: str) -> list[int]:
        return self._membership._conversation_member_ids(session, conversation_id)
''',
    "_append_system_message": '''    def _append_system_message(
        self,
        *,
        session,
        conversation: ChatConversation,
        actor_user_id: int,
        body: str,
        member_user_ids: list[int],
        now: datetime,
    ) -> ChatMessage:
        return self._membership._append_system_message(
            session=session,
            conversation=conversation,
            actor_user_id=actor_user_id,
            body=body,
            member_user_ids=member_user_ids,
            now=now,
        )
''',
    "_resolve_reply_message": '''    def _resolve_reply_message(
        self,
        *,
        session,
        conversation_id: str,
        reply_to_message_id: Optional[str],
    ) -> Optional[ChatMessage]:
        return self._membership._resolve_reply_message(
            session=session,
            conversation_id=conversation_id,
            reply_to_message_id=reply_to_message_id,
        )
''',
}


def replace_method(text: str, name: str, replacement: str) -> str:
    pat = re.compile(rf"    def {re.escape(name)}\(.*?(?=\n    def |\nchat_service =)", re.DOTALL)
    new_text, count = pat.subn(replacement + "\n", text, count=1)
    if count != 1:
        raise SystemExit(f"replace failed for {name}: {count}")
    return new_text


def main() -> None:
    text = SERVICE_PATH.read_text(encoding="utf-8")
    for name, body in DELEGATES.items():
        text = replace_method(text, name, body.rstrip())
    SERVICE_PATH.write_text(text, encoding="utf-8")
    print("updated", SERVICE_PATH)


if __name__ == "__main__":
    main()
