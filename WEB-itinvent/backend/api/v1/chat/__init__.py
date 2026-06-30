"""Chat API backed by PostgreSQL and current web-users."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from backend.chat.realtime import chat_realtime
from backend.chat.service import chat_service

from backend.api.v1.chat import (
    ai,
    attachments,
    conversations,
    folders,
    health,
    link_preview,
    messages,
    push,
    uploads,
    users,
    ws,
)
from backend.api.v1.chat._common import (  # noqa: F401
    CHAT_WS_COMMAND_BURST,
    CHAT_WS_COMMANDS_PER_SEC,
    CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS,
    CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL,
    CHAT_WS_SESSION_REVALIDATE_SEC,
    _ChatWsCommandRateLimiter,
    _get_conversation_updates_for_users,
    _get_unread_summaries,
    _log_chat_background_task_failure,
    _log_request_timing,
    _log_ws_command_timing,
    _normalize_text,
    _publish_conversation_updated,
    _publish_deleted_conversation,
    _publish_group_conversation_change,
    _publish_message_created,
    _publish_message_created_after_send,
    _publish_message_deleted,
    _publish_message_deleted_after_soft_delete,
    _publish_message_read,
    _publish_message_read_after_mark_read,
    _publish_message_updated,
    _publish_message_updated_after_edit,
    _publish_presence_updated,
    _publish_unread_summary,
    _queue_ai_run_for_message,
    _raise_chat_http_error,
    _request_id_from_headers,
    _run_chat_call,
    _run_chat_call_with_meta,
    _schedule_ai_run_for_message,
    _schedule_chat_background_task,
    _schedule_chat_message_side_effects,
    _ws_error_code,
    _ws_is_connected,
    http_logger,
    logger,
    runtime_logger,
)
from backend.api.v1.chat.ai import (
    cancel_ai_action,
    confirm_ai_action,
    get_conversation_ai_status,
    list_ai_bots,
    open_ai_bot_conversation,
)
from backend.api.v1.chat.attachments import (
    download_chat_attachment,
    download_chat_attachment_preview_pdf,
    get_chat_attachment_preview,
    get_chat_message_reads,
)
from backend.api.v1.chat.conversations import (
    add_chat_group_members,
    create_direct_conversation,
    create_group_conversation,
    delete_chat_conversation,
    ensure_notes_conversation,
    get_chat_conversation,
    get_chat_conversations,
    get_chat_unread_summary,
    leave_chat_group,
    remove_chat_group_member,
    serve_group_avatar,
    transfer_chat_group_ownership,
    update_chat_conversation_settings,
    update_chat_group_member_role,
    update_chat_group_profile,
    upload_chat_group_avatar,
)
from backend.api.v1.chat.folders import (
    add_chat_folder_conversation,
    create_chat_folder,
    delete_chat_folder,
    get_chat_folder,
    list_chat_folders,
    remove_chat_folder_conversation,
    set_chat_folder_conversations,
    update_chat_folder,
)
from backend.api.v1.chat.health import get_chat_health
from backend.api.v1.chat.link_preview import get_link_preview
from backend.api.v1.chat.messages import (
    delete_chat_message,
    edit_chat_message,
    forward_chat_message,
    get_chat_conversation_assets_summary,
    get_chat_conversation_attachments,
    get_chat_messages,
    get_chat_shareable_tasks,
    get_chat_thread_bootstrap,
    mark_chat_conversation_read,
    search_chat_messages,
    send_chat_files,
    send_chat_message,
    send_chat_task_share,
    toggle_chat_message_reaction,
)
from backend.api.v1.chat.push import (
    delete_chat_push_subscription,
    get_chat_push_config,
    upsert_chat_push_subscription,
)
from backend.api.v1.chat.uploads import (
    cancel_chat_upload_session,
    complete_chat_upload_session,
    create_chat_upload_session,
    get_chat_upload_session,
    upload_chat_upload_session_chunk,
)
from backend.api.v1.chat.users import get_chat_users, resolve_chat_user_for_address_book
from backend.api.v1.chat.ws import chat_websocket

router = APIRouter()
router.include_router(link_preview.router)
router.include_router(health.router)
router.include_router(folders.router)
router.include_router(users.router)
router.include_router(conversations.router)
router.include_router(push.router)
router.include_router(messages.router)
router.include_router(ai.router)
router.include_router(uploads.router)
router.include_router(attachments.router)
router.include_router(ws.router)

__all__ = ["router", "chat_service", "chat_realtime", "run_in_threadpool"]
