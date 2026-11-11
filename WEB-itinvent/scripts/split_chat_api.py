"""Split backend/api/v1/chat.py into backend/api/v1/chat/ package."""
from __future__ import annotations

import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "backend" / "api" / "v1" / "chat.py"
OUT = ROOT / "backend" / "api" / "v1" / "chat"

lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)


def chunk(start: int, end: int) -> str:
    return "".join(lines[start:end])


OUT.mkdir(parents=True, exist_ok=True)

# --- _common.py ---
common_src = chunk(199, 909)
common_src = common_src.replace("chat_service.", "_chat_service().")
common_src = common_src.replace("chat_realtime.", "_chat_realtime().")
common_src = common_src.replace(
    "return await run_in_threadpool(func, *args, **kwargs)",
    "return await _pkg().run_in_threadpool(func, *args, **kwargs)",
)
common_src = common_src.replace(
    "return await run_in_threadpool(_invoke)",
    "return await _pkg().run_in_threadpool(_invoke)",
)

_common = textwrap.dedent(
    '''\
    """Shared helpers for chat API sub-routers."""
    from __future__ import annotations

    import asyncio
    import logging
    import os
    import sys
    import time
    from typing import Any, Optional

    from fastapi import HTTPException, Request
    from starlette.websockets import WebSocketState

    from backend.chat.db import ChatConfigurationError
    from backend.chat.realtime import ChatWsCommandRateLimiter, chat_realtime as _default_chat_realtime
    from backend.chat.realtime_side_effects import publish_message_created_after_send as publish_message_created_after_send_side_effects
    from backend.chat.service import chat_service as _default_chat_service

    logger = logging.getLogger("backend.chat.websocket")
    http_logger = logging.getLogger("backend.chat.api")
    logger.setLevel(logging.INFO)
    http_logger.setLevel(logging.INFO)
    runtime_logger = logging.getLogger("uvicorn.error")


    def _pkg():
        return sys.modules["backend.api.v1.chat"]


    def _chat_service():
        return _pkg().chat_service


    def _chat_realtime():
        return _pkg().chat_realtime

    '''
) + common_src + "\n\n# Backward-compatible alias for tests and internal imports.\n_ChatWsCommandRateLimiter = ChatWsCommandRateLimiter\n"
(OUT / "_common.py").write_text(_common, encoding="utf-8")

# --- link_preview.py ---
link_preview = textwrap.dedent(
    '''\
    """Link preview endpoint for chat."""
    from __future__ import annotations

    import logging
    import re
    import socket
    import urllib.request
    from urllib.parse import urlsplit

    from fastapi import APIRouter, Depends, HTTPException, Query

    from backend.api.deps import require_permission
    from backend.models.auth import User
    from backend.services.authorization_service import PERM_CHAT_READ

    router = APIRouter()
    http_logger = logging.getLogger("backend.chat.api")

    '''
) + chunk(90, 199)
(OUT / "link_preview.py").write_text(link_preview, encoding="utf-8")

# Shared imports for route modules
STD_IMPORTS = textwrap.dedent(
    '''\
    from __future__ import annotations

    import asyncio
    import json
    import logging
    import time
    from typing import Any, Optional

    from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import FileResponse, Response

    from backend.api.deps import ensure_user_permission, get_current_database_id, require_permission
    from backend.api.v1.chat._common import (
        _log_request_timing,
        _normalize_text,
        _publish_conversation_updated,
        _publish_deleted_conversation,
        _publish_group_conversation_change,
        _publish_message_created_after_send,
        _publish_message_deleted_after_soft_delete,
        _publish_message_read_after_mark_read,
        _publish_message_updated_after_edit,
        _publish_unread_summary,
        _raise_chat_http_error,
        _request_id_from_headers,
        _run_chat_call,
        _run_chat_call_with_meta,
        _schedule_ai_run_for_message,
        _schedule_chat_background_task,
        _schedule_chat_message_side_effects,
        http_logger,
    )
    from backend.chat.schemas import (
    '''
)

def route_module(extra_schema_imports: str, body: str, extra_imports: str = "") -> str:
    header = STD_IMPORTS + extra_schema_imports + "\n    )\n"
    header += textwrap.dedent(
        '''\
        from backend.chat.service import chat_service
        from backend.models.auth import User
        from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_TASKS_READ

        router = APIRouter()

        '''
    )
    if extra_imports:
        header = extra_imports + "\n" + header
    return header + body


# health
(OUT / "health.py").write_text(
    textwrap.dedent(
        '''\
        """Chat health endpoint."""
        from __future__ import annotations

        from fastapi import APIRouter, Depends

        from backend.api.deps import require_permission
        from backend.api.v1.chat._common import _run_chat_call
        from backend.chat.schemas import ChatHealthResponse
        from backend.chat.service import chat_service
        from backend.models.auth import User
        from backend.services.authorization_service import PERM_CHAT_READ

        router = APIRouter()

        '''
    )
    + chunk(909, 916),
    encoding="utf-8",
)

# folders
(OUT / "folders.py").write_text(
    route_module(
        "    ChatFolderCreateRequest,\n    ChatFolderListResponse,\n    ChatFolderMembershipUpdateRequest,\n    ChatFolderMutationResponse,\n    ChatFolderSummary,\n    ChatFolderUpdateRequest,",
        chunk(916, 1045),
    ),
    encoding="utf-8",
)

# users
(OUT / "users.py").write_text(
    route_module(
        "    ChatUserSummary,\n    ChatUsersResponse,",
        chunk(1045, 1082),
    ),
    encoding="utf-8",
)

# conversations (list + unread + mutations)
conv_imports = textwrap.dedent(
    '''\
    from __future__ import annotations

    import asyncio
    import io
    import time as _time
    from pathlib import Path
    from typing import Any, Optional

    from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import FileResponse

    from backend.api.deps import require_permission
    from backend.api.v1.chat._common import (
        _log_request_timing,
        _normalize_text,
        _publish_conversation_updated,
        _publish_deleted_conversation,
        _publish_group_conversation_change,
        _publish_unread_summary,
        _raise_chat_http_error,
        _request_id_from_headers,
        _run_chat_call,
        _run_chat_call_with_meta,
        _schedule_chat_background_task,
    )
    from backend.chat.schemas import (
        ChatConversationDetailResponse,
        ChatConversationListResponse,
        ChatConversationMembersRequest,
        ChatConversationSummary,
        ChatMemberRoleUpdateRequest,
        ChatOwnershipTransferRequest,
        ChatUnreadSummaryResponse,
        DirectConversationRequest,
        GroupConversationRequest,
        UpdateConversationProfileRequest,
        UpdateConversationSettingsRequest,
    )
    from backend.chat.service import chat_service
    from backend.models.auth import User
    from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

    router = APIRouter()

    '''
)
(OUT / "conversations.py").write_text(
    conv_imports + chunk(1082, 1128) + chunk(1175, 1539),
    encoding="utf-8",
)

# push
(OUT / "push.py").write_text(
    route_module(
        "    ChatPushConfigResponse,\n    ChatPushSubscriptionDeleteRequest,\n    ChatPushSubscriptionRequest,\n    ChatPushSubscriptionStatusResponse,",
        chunk(1128, 1175),
    ),
    encoding="utf-8",
)

# messages
msg_imports = textwrap.dedent(
    '''\
    from __future__ import annotations

    import asyncio
    import json
    import time
    from typing import Any, Optional

    from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile

    from backend.api.deps import ensure_user_permission, get_current_database_id, require_permission
    from backend.api.v1.chat._common import (
        _log_request_timing,
        _normalize_text,
        _publish_message_created_after_send,
        _publish_message_deleted_after_soft_delete,
        _publish_message_read_after_mark_read,
        _publish_message_updated_after_edit,
        _raise_chat_http_error,
        _request_id_from_headers,
        _run_chat_call,
        _run_chat_call_with_meta,
        _schedule_ai_run_for_message,
        _schedule_chat_background_task,
        _schedule_chat_message_side_effects,
        http_logger,
    )
    from backend.chat.realtime import chat_realtime
    from backend.chat.schemas import (
        ChatConversationAssetsSummaryResponse,
        ChatConversationAttachmentsResponse,
        ChatMessageListResponse,
        ChatMessageResponse,
        ChatMessageSearchResponse,
        ChatReactionToggleRequest,
        ChatReactionToggleResponse,
        ChatShareableTasksResponse,
        ChatThreadBootstrapResponse,
        EditMessageRequest,
        ForwardMessageRequest,
        MarkReadRequest,
        SendMessageRequest,
        TaskShareMessageRequest,
    )
    from backend.chat.service import chat_service
    from backend.models.auth import User
    from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_TASKS_READ

    router = APIRouter()

    '''
)
(OUT / "messages.py").write_text(
    msg_imports + chunk(1539, 1990) + chunk(2175, 2202),
    encoding="utf-8",
)

# ai
(OUT / "ai.py").write_text(
    textwrap.dedent(
        '''\
        """AI chat endpoints."""
        from __future__ import annotations

        from typing import Any

        from fastapi import APIRouter, Body, Depends, HTTPException

        from backend.api.deps import ensure_user_permission, require_permission
        from backend.api.v1.chat._common import _raise_chat_http_error, _run_chat_call
        from backend.ai_chat.schemas import AiBotListResponse, AiConversationStatusResponse
        from backend.chat.schemas import ChatConversationSummary
        from backend.models.auth import User
        from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ

        router = APIRouter()

        '''
    )
    + chunk(1990, 2074),
    encoding="utf-8",
)

# uploads
(OUT / "uploads.py").write_text(
    route_module(
        "    ChatUploadSessionCancelResponse,\n    ChatUploadSessionChunkResponse,\n    ChatUploadSessionCreateRequest,\n    ChatUploadSessionResponse,",
        chunk(2074, 2175),
        extra_imports="from backend.api.deps import get_current_database_id",
    ),
    encoding="utf-8",
)

# attachments
(OUT / "attachments.py").write_text(
    textwrap.dedent(
        '''\
        """Chat attachment download and preview endpoints."""
        from __future__ import annotations

        from typing import Optional

        from fastapi import APIRouter, Depends, HTTPException, Query
        from fastapi.responses import FileResponse, Response

        from backend.api.deps import require_permission
        from backend.api.v1.chat._common import _raise_chat_http_error, _run_chat_call
        from backend.chat.schemas import ChatMessageReadsResponse
        from backend.chat.service import chat_service
        from backend.models.auth import User
        from backend.services.authorization_service import PERM_CHAT_READ

        router = APIRouter()

        '''
    )
    + chunk(2202, 2287),
    encoding="utf-8",
)

# ws
ws_imports = textwrap.dedent(
    '''\
    """Chat WebSocket endpoint."""
    from __future__ import annotations

    import asyncio
    import json
    import logging
    import time
    from typing import Optional

    from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
    from fastapi.concurrency import run_in_threadpool
    from starlette.websockets import WebSocketState

    from backend.api.deps import (
        assert_access_token_still_valid,
        ensure_user_permission,
        extract_websocket_access_token,
        get_current_user_from_websocket,
    )
    from backend.api.v1.chat._common import (
        CHAT_WS_RATE_LIMIT_MAX_VIOLATIONS,
        CHAT_WS_SESSION_REVALIDATE_COMMAND_INTERVAL,
        CHAT_WS_SESSION_REVALIDATE_SEC,
        _log_ws_command_timing,
        _normalize_text,
        _publish_message_read_after_mark_read,
        _publish_presence_updated,
        _run_chat_call,
        _run_chat_call_with_meta,
        _schedule_ai_run_for_message,
        _schedule_chat_background_task,
        _schedule_chat_message_side_effects,
        _ws_is_connected,
        _ws_error_code,
        logger,
    )
    from backend.chat.realtime import chat_realtime
    from backend.chat.service import chat_service
    from backend.models.auth import User
    from backend.services.authorization_service import PERM_CHAT_READ, PERM_CHAT_WRITE

    router = APIRouter()

    '''
)
(OUT / "ws.py").write_text(ws_imports + chunk(2287, len(lines)), encoding="utf-8")

# __init__.py
init = textwrap.dedent(
    '''\
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
    '''
)
(OUT / "__init__.py").write_text(init, encoding="utf-8")

print(f"Created package at {OUT}")
print("Delete backend/api/v1/chat.py manually after verification")
