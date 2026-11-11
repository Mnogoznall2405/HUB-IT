from __future__ import annotations

import inspect

from backend.chat.service import ChatService


# Public API surface — intentional contract. Add methods here when exposing new ChatService API.
EXPECTED_PUBLIC_METHODS = frozenset({
    "add_chat_folder_conversation",
    "add_group_members",
    "apply_delivery_state_for_message",
    "cancel_upload_session",
    "chat_cache_ttl_sec",
    "cleanup_expired_upload_sessions",
    "clear_hub_notifications_after_mark_read",
    "close_poll",
    "complete_upload_session",
    "consume_request_meta",
    "create_chat_folder",
    "create_direct_conversation",
    "create_group_conversation",
    "create_upload_session",
    "delete_ai_conversation",
    "delete_chat_folder",
    "delete_conversation",
    "delete_message",
    "delete_push_subscription",
    "delete_task_conversation",
    "download_attachment_preview_pdf",
    "edit_message",
    "forward_message",
    "get_attachment_for_download",
    "get_attachment_preview",
    "get_chat_folder",
    "get_conversation",
    "get_conversation_assets_summary",
    "get_conversation_member_ids",
    "get_conversation_summaries_for_users",
    "get_conversation_summary",
    "get_group_avatar_file_path",
    "get_health",
    "get_message",
    "get_message_by_client_id",
    "get_message_reactions",
    "get_message_read_delta",
    "get_message_reads",
    "get_messages",
    "get_messages_for_users",
    "get_or_create_notes_conversation",
    "get_presence",
    "get_push_config",
    "get_realtime_snapshot",
    "get_thread_bootstrap",
    "get_unread_summaries",
    "get_unread_summary",
    "get_upload_session",
    "group_max_members",
    "hydrate_thread_messages",
    "initialize_runtime",
    "invalidate_bucket_for_all_users",
    "invalidate_presence_cache",
    "leave_group",
    "list_available_users",
    "list_chat_folders",
    "list_conversation_attachments",
    "list_conversations",
    "list_shareable_tasks",
    "mark_read",
    "remove_chat_folder_conversation",
    "remove_group_member",
    "rename_ai_conversation",
    "resolve_user_for_address_book",
    "search_messages",
    "search_messages_global",
    "send_files",
    "send_message",
    "send_task_share",
    "set_chat_folder_conversations",
    "set_pinned_message",
    "admin_assign_group_owner",
    "admin_auto_assign_group_owners",
    "admin_get_group_structure",
    "admin_list_group_audit",
    "admin_list_ownerless_groups",
    "admin_remove_group_member",
    "create_group_invite",
    "create_support_conversation",
    "group_create_per_minute",
    "group_max_owned",
    "join_group_by_invite",
    "lift_group_member_restriction",
    "list_group_activity",
    "export_conversation",
    "list_group_join_requests",
    "list_message_reports",
    "report_message",
    "resolve_group_join_request",
    "set_group_join_approval",
    "resolve_message_report",
    "list_pinned_messages",
    "pin_message",
    "preview_group_invite",
    "restrict_group_member",
    "revoke_group_invites",
    "unpin_message",
    "start",
    "stop",
    "toggle_reaction",
    "transfer_group_ownership",
    "update_chat_folder",
    "update_conversation_settings",
    "update_group_avatar",
    "update_group_member_role",
    "update_group_profile",
    "upload_session_chunk",
    "upload_session_chunk_size_bytes",
    "upload_session_cleanup_interval_sec",
    "upload_session_ttl_sec",
    "upsert_push_subscription",
    "verify_conversation_access",
    "vote_poll",
})


def _public_methods(cls: type) -> set[str]:
    result: set[str] = set()
    for name, member in inspect.getmembers(cls, predicate=inspect.isfunction):
        if name.startswith("_"):
            continue
        result.add(name)
    for name, member in inspect.getmembers(cls, predicate=lambda item: isinstance(item, property)):
        if name.startswith("_"):
            continue
        result.add(name)
    return result


def test_chat_service_public_surface_contract() -> None:
    actual = _public_methods(ChatService)
    missing = sorted(EXPECTED_PUBLIC_METHODS - actual)
    unexpected = sorted(actual - EXPECTED_PUBLIC_METHODS)
    assert not missing, f"ChatService missing expected public methods: {missing}"
    assert not unexpected, f"ChatService has unexpected public methods (update contract): {unexpected}"
