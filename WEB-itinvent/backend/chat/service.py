"""Chat service backed by PostgreSQL and current web-users."""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import mimetypes
import os
import re
import shutil
import struct
import time
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Optional
from uuid import uuid4

from fastapi import UploadFile
from PIL import UnidentifiedImageError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from backend.chat.attachment_media import ChatAttachmentMedia
from backend.chat.chat_cache import ChatCache
from backend.chat.chat_conversation_read_store import ChatConversationReadStore
from backend.chat.chat_delivery_state import (
    find_existing_client_message as _find_existing_client_message_impl,
    get_or_create_conversation_state as _get_or_create_conversation_state_impl,
    increment_unread_counters_for_recipients as _increment_unread_counters_for_recipients_impl,
    mark_sender_message_seen as _mark_sender_message_seen_impl,
)
from backend.chat.chat_folder_service import ChatFolderService
from backend.chat.chat_forward_materializer import ChatForwardMaterializer
from backend.chat.chat_group_service import ChatGroupService
from backend.chat.chat_membership import ChatMembership
from backend.chat.chat_notification_orchestrator import ChatNotificationOrchestrator
from backend.chat.chat_presence_service import ChatPresenceService
from backend.chat.chat_serialization import ChatSerialization
from backend.chat.chat_thread_read_store import ChatThreadReadStore
from backend.chat.chat_upload_orchestrator import ChatUploadOrchestrator
from backend.chat.db import (
    ChatConfigurationError,
    chat_session,
    get_chat_database_url,
    initialize_chat_schema,
    is_chat_enabled,
    ping_chat_database,
)
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatEventOutbox,
    ChatFolder,
    ChatFolderConversation,
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatMessageRead,
    ChatMessageReaction,
    ChatPushOutbox,
)
from backend.chat.message_persistence import (
    ChatFileMessagePersistence,
    ChatForwardMessagePersistence,
    ChatSystemMessagePersistence,
    ChatTaskShareMessagePersistence,
    ChatTextMessagePersistence,
    TaskShareSnapshot,
)
from backend.chat.notification_dispatcher import ChatNotificationDispatcher
from backend.chat.notification_planner import build_chat_notification_recipient_plans
from backend.chat.push_service import chat_push_service
from backend.chat.upload_session_completion import UploadSessionCompletionMaterializer
from backend.chat.upload_sessions import ChatUploadSessionStore
from backend.chat.upload_session_transfer import plan_upload_session_chunk
from backend.chat.utils import normalize_text as _normalize_text
from backend.services.hub_service import hub_service
from backend.services.session_service import session_service
from backend.services.user_service import user_service


logger = logging.getLogger("backend.chat.service")
logger.setLevel(logging.INFO)
runtime_logger = logging.getLogger("uvicorn.error")
_chat_request_meta_var: ContextVar[dict[str, Any] | None] = ContextVar("chat_request_meta", default=None)
_CHAT_UPLOAD_STREAM_CHUNK_BYTES = 1024 * 1024
_CHAT_IMAGE_DIMENSION_PROBE_BYTES = 2 * 1024 * 1024
_CHAT_UPLOAD_SESSION_CHUNK_BYTES = 2 * 1024 * 1024
_CHAT_UPLOAD_SESSION_TTL_DEFAULT = 2 * 60 * 60
_CHAT_UPLOAD_SESSION_CLEANUP_INTERVAL_DEFAULT = 10 * 60
_CHAT_ATTACHMENT_VARIANT_MAX_DIMENSIONS = {
    "thumb": 320,
    "preview": 1280,
}
_CHAT_MENTION_PATTERN = re.compile(r"(?<![\w@])@([0-9A-Za-zА-Яа-яЁё_.-]{1,64})", re.UNICODE)


CHAT_DELETED_MESSAGE_BODY = "Сообщение удалено"
CHAT_GROUP_ROLES = {"owner", "moderator", "member"}
CHAT_GROUP_MANAGER_ROLES = {"owner", "moderator"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_body_format(value: object, default: str = "plain") -> str:
    normalized = _normalize_text(value).lower() or default
    return normalized if normalized in {"plain", "markdown"} else "plain"


def _normalize_member_role(value: object) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in CHAT_GROUP_ROLES else "member"


def _display_user_name(user: Optional[dict]) -> str:
    payload = user or {}
    return (
        _normalize_text(payload.get("full_name"))
        or _normalize_text(payload.get("username"))
        or f"user-{int(payload.get('id', 0) or 0)}"
    )


def _normalize_mention_handle(value: object) -> str:
    return _normalize_text(value).lstrip("@").lower()


def _mention_handle_from_person_name(value: object) -> str:
    return re.sub(r"[^0-9A-Za-zА-Яа-яЁё_.-]+", "", _normalize_text(value).replace(" ", "_")).lower()


_MARKDOWN_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")


def _strip_markdown_preview(value: object) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    cleaned_lines: list[str] = []
    in_fence = False
    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^(?:```|~~~)", line):
            in_fence = not in_fence
            continue
        if _MARKDOWN_TABLE_SEPARATOR_RE.match(line):
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = [cell.strip() for cell in line.split("|") if cell.strip()]
            line = " | ".join(cells)
        line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        line = re.sub(r"^\s{0,3}>\s?", "", line)
        line = re.sub(r"^\s{0,3}- \[[ xX]\]\s+", "", line)
        line = re.sub(r"^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)", "", line)
        line = re.sub(r"\[([^\]\n]+)\]\([^)]+\)", r"\1", line)
        line = re.sub(r"(\*\*|__)(.*?)\1", r"\2", line)
        line = re.sub(r"`([^`]+)`", r"\1", line)
        line = re.sub(r"[*_~]{1,3}", "", line)
        line = re.sub(r"\s+", " ", line).strip()
        if line:
            cleaned_lines.append(line)
        if not in_fence and len(cleaned_lines) >= 3:
            break
    return " ".join(cleaned_lines).strip()


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _probe_image_dimensions(payload: bytes, mime_type: object) -> tuple[int | None, int | None]:
    normalized_mime_type = _normalize_text(mime_type).lower()
    if not normalized_mime_type.startswith("image/") or not payload:
        return None, None

    try:
        if payload.startswith(b"\x89PNG\r\n\x1a\n") and len(payload) >= 24:
            width, height = struct.unpack(">II", payload[16:24])
            return int(width), int(height)

        if payload[:6] in {b"GIF87a", b"GIF89a"} and len(payload) >= 10:
            width, height = struct.unpack("<HH", payload[6:10])
            return int(width), int(height)

        if payload.startswith(b"BM") and len(payload) >= 26:
            width = int.from_bytes(payload[18:22], "little", signed=True)
            height = abs(int.from_bytes(payload[22:26], "little", signed=True))
            if width > 0 and height > 0:
                return width, height

        if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP" and len(payload) >= 30:
            chunk_type = payload[12:16]
            if chunk_type == b"VP8X" and len(payload) >= 30:
                width = 1 + int.from_bytes(payload[24:27], "little")
                height = 1 + int.from_bytes(payload[27:30], "little")
                return int(width), int(height)
            if chunk_type == b"VP8L" and len(payload) >= 25:
                bits = int.from_bytes(payload[21:25], "little")
                width = (bits & 0x3FFF) + 1
                height = ((bits >> 14) & 0x3FFF) + 1
                return int(width), int(height)
            if chunk_type == b"VP8 " and len(payload) >= 30:
                width = int.from_bytes(payload[26:28], "little")
                height = int.from_bytes(payload[28:30], "little")
                return int(width), int(height)

        if payload.startswith(b"\xff\xd8"):
            offset = 2
            payload_length = len(payload)
            while offset + 9 < payload_length:
                if payload[offset] != 0xFF:
                    offset += 1
                    continue
                marker = payload[offset + 1]
                offset += 2
                if marker in {0xD8, 0xD9}:
                    continue
                if offset + 2 > payload_length:
                    break
                segment_length = int.from_bytes(payload[offset:offset + 2], "big")
                if segment_length < 2 or offset + segment_length > payload_length:
                    break
                if marker in {
                    0xC0, 0xC1, 0xC2, 0xC3,
                    0xC5, 0xC6, 0xC7,
                    0xC9, 0xCA, 0xCB,
                    0xCD, 0xCE, 0xCF,
                } and offset + 7 <= payload_length:
                    height = int.from_bytes(payload[offset + 3:offset + 5], "big")
                    width = int.from_bytes(payload[offset + 5:offset + 7], "big")
                    return int(width), int(height)
                offset += segment_length
    except Exception:
        return None, None

    return None, None


def _probe_video_dimensions(file_path: Path, mime_type: object) -> tuple[int | None, int | None]:
    normalized_mime_type = _normalize_text(mime_type).lower()
    if not normalized_mime_type.startswith("video/"):
        return None, None
    try:
        import cv2
        cap = cv2.VideoCapture(str(file_path))
        if cap.isOpened():
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()
            if width > 0 and height > 0:
                return width, height
        else:
            cap.release()
    except Exception:
        pass
    return None, None


def _direct_key(user_a: int, user_b: int) -> str:
    first, second = sorted((int(user_a), int(user_b)))
    return f"{first}:{second}"


def _notes_key(user_id: int) -> str:
    return f"notes:{int(user_id)}"


NOTES_CONVERSATION_TITLE = "Заметки"


CHAT_MAX_FILES_PER_MESSAGE = 5
CHAT_MAX_TOTAL_FILE_BYTES = 1024 * 1024 * 1024
CHAT_MAX_MESSAGE_BODY_LENGTH = 12000
CHAT_ALLOWED_TRANSFER_ENCODINGS = {"identity", "gzip"}
CHAT_ARCHIVE_EXTENSIONS = {
    ".zip", ".rar", ".7z", ".tar", ".gz",
}
CHAT_ARCHIVE_MIME_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar",
}
CHAT_ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
    ".mp4", ".mov", ".webm", ".m4v",
    ".ogg", ".mp3", ".wav", ".aac", ".m4a", ".opus", ".flac",
    ".pdf",
    ".doc", ".docx", ".docm", ".rtf", ".odt",
    ".xls", ".xlsx", ".xlsm", ".ods",
    ".ppt", ".pptx", ".pptm", ".odp",
    ".txt", ".csv", ".tsv", ".log", ".md", ".json", ".xml",
}
CHAT_ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/")
CHAT_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/rtf",
    "text/plain",
    "text/csv",
    "text/tab-separated-values",
    "text/rtf",
    "text/markdown",
    "application/json",
    "application/xml",
    "text/xml",
}
CHAT_PRESENCE_ONLINE_WINDOW = timedelta(minutes=2)


def _safe_file_name(value: object) -> str:
    raw = Path(str(value or "file.bin")).name.strip() or "file.bin"
    sanitized = re.sub(r"[^\w.() \-]", "_", raw, flags=re.UNICODE).strip(" .")
    return sanitized or "file.bin"


def _truncate_text(value: object, limit: int = 160) -> str:
    text = _normalize_text(value)
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)].rstrip()}..."


def _parse_dt(value: object) -> Optional[datetime]:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _log_chat_service_timing(operation_name: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"chat.service.{operation_name} took_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    logger.info(message)
    runtime_logger.info(message)


@dataclass
class ChatRuntimeStatus:
    enabled: bool
    configured: bool
    available: bool
    database_url_masked: Optional[str] = None


class ChatService:
    """Service layer for the built-in chat."""

    _CHAT_CACHE_TTL_SEC_DEFAULT = 15
    _PRESENCE_CACHE_TTL_SEC = 20
    _USERS_CACHE_TTL_SEC = 60

    def __init__(self) -> None:
        self._runtime_status: Optional[ChatRuntimeStatus] = None
        self._membership = ChatMembership(self)
        self._group_service = ChatGroupService(self)
        self._presence_service = ChatPresenceService(self)
        self._folder_service = ChatFolderService(self)
        self._notification_orchestrator = ChatNotificationOrchestrator(self)
        self._cache = ChatCache(self)
        self._serialization = ChatSerialization(self)
        self._upload_orchestrator = ChatUploadOrchestrator(self)
        self._forward_materializer = ChatForwardMaterializer(self)
        self._conversation_reads = ChatConversationReadStore(self)
        self._thread_reads = ChatThreadReadStore(self)

        self._attachments_root = Path(hub_service.data_dir) / "chat_message_attachments"
        self._attachments_root.mkdir(parents=True, exist_ok=True)
        self._attachment_media = ChatAttachmentMedia(
            attachments_root=lambda: self._attachments_root,
            logger=logger,
        )
        self._notification_dispatcher = ChatNotificationDispatcher(
            hub_service=hub_service,
            push_service=chat_push_service,
        )
        self._text_message_persistence = ChatTextMessagePersistence(
            session_factory=lambda: chat_session(),
            require_membership=lambda **kwargs: self._require_membership(**kwargs),
            lock_conversation_for_write=lambda **kwargs: self._lock_conversation_for_write(**kwargs),
            conversation_member_ids=lambda session, conversation_id: self._conversation_member_ids(session, conversation_id),
            resolve_reply_message=lambda **kwargs: self._resolve_reply_message(**kwargs),
            find_existing_client_message=lambda **kwargs: self._find_existing_client_message(**kwargs),
            build_message_payload_for_members=lambda **kwargs: self._build_message_payload_for_members(**kwargs),
            now=_utc_now,
        )
        self._file_message_persistence = ChatFileMessagePersistence(
            session_factory=lambda: chat_session(),
            require_membership=lambda **kwargs: self._require_membership(**kwargs),
            lock_conversation_for_write=lambda **kwargs: self._lock_conversation_for_write(**kwargs),
            conversation_member_ids=lambda session, conversation_id: self._conversation_member_ids(session, conversation_id),
            resolve_reply_message=lambda **kwargs: self._resolve_reply_message(**kwargs),
            build_message_payload_for_members=lambda **kwargs: self._build_message_payload_for_members(**kwargs),
            now=_utc_now,
        )
        self._forward_message_persistence = ChatForwardMessagePersistence(
            session_factory=lambda: chat_session(),
            require_membership=lambda **kwargs: self._require_membership(**kwargs),
            lock_conversation_for_write=lambda **kwargs: self._lock_conversation_for_write(**kwargs),
            conversation_member_ids=lambda session, conversation_id: self._conversation_member_ids(session, conversation_id),
            resolve_reply_message=lambda **kwargs: self._resolve_reply_message(**kwargs),
            build_message_payload_for_members=lambda **kwargs: self._build_message_payload_for_members(**kwargs),
            now=_utc_now,
        )
        self._system_message_persistence = ChatSystemMessagePersistence()
        self._task_share_message_persistence = ChatTaskShareMessagePersistence(
            session_factory=lambda: chat_session(),
            require_membership=lambda **kwargs: self._require_membership(**kwargs),
            lock_conversation_for_write=lambda **kwargs: self._lock_conversation_for_write(**kwargs),
            conversation_member_ids=lambda session, conversation_id: self._conversation_member_ids(session, conversation_id),
            resolve_reply_message=lambda **kwargs: self._resolve_reply_message(**kwargs),
            authorize_task_share=lambda **kwargs: self._authorize_task_share_for_members(**kwargs),
            build_message_payload_for_members=lambda **kwargs: self._build_message_payload_for_members(**kwargs),
            now=_utc_now,
        )
        self._upload_sessions_root = Path(hub_service.data_dir) / "chat_upload_sessions"
        self._upload_sessions_root.mkdir(parents=True, exist_ok=True)
        self._upload_sessions = ChatUploadSessionStore(
            upload_sessions_root=lambda: self._upload_sessions_root,
            chunk_size_bytes=lambda: self.upload_session_chunk_size_bytes,
            ttl_sec=lambda: self.upload_session_ttl_sec,
            cleanup_interval_sec=lambda: self.upload_session_cleanup_interval_sec,
            normalize_transfer_encoding=lambda value: self._normalize_transfer_encoding(value),
            now=_utc_now,
        )
        self._upload_session_completion = UploadSessionCompletionMaterializer(
            attachments_root=lambda: self._attachments_root,
            part_path=lambda session_id, file_id: self._upload_session_part_path(session_id, file_id),
            normalize_transfer_encoding=lambda value: self._normalize_transfer_encoding(value),
            write_decoded_transfer_payload=self._write_decoded_transfer_payload,
            probe_image_dimensions=_probe_image_dimensions,
        )
        self._cache_lock = RLock()
        self._runtime_cache: dict[str, tuple[datetime, Any]] = {}
        self._presence_cache: dict[str, tuple[datetime, dict]] = {}
        self._health_cache: tuple[float, dict[str, Any]] | None = None
        self._health_cache_ttl_sec = 10.0
        self._upload_cleanup_task: asyncio.Task | None = None
        self._upload_cleanup_stop_event: asyncio.Event | None = None

    @property
    def chat_cache_ttl_sec(self) -> int:
        raw = _normalize_text(os.getenv("CHAT_CACHE_TTL_SEC"), str(self._CHAT_CACHE_TTL_SEC_DEFAULT))
        try:
            return max(5, min(60, int(raw)))
        except Exception:
            return self._CHAT_CACHE_TTL_SEC_DEFAULT

    @property
    def upload_session_chunk_size_bytes(self) -> int:
        return _CHAT_UPLOAD_SESSION_CHUNK_BYTES

    @property
    def upload_session_ttl_sec(self) -> int:
        raw = _normalize_text(
            os.getenv("CHAT_UPLOAD_SESSION_TTL_SEC"),
            str(_CHAT_UPLOAD_SESSION_TTL_DEFAULT),
        )
        try:
            return max(300, min(24 * 60 * 60, int(raw)))
        except Exception:
            return _CHAT_UPLOAD_SESSION_TTL_DEFAULT

    @property
    def upload_session_cleanup_interval_sec(self) -> int:
        raw = _normalize_text(
            os.getenv("CHAT_UPLOAD_SESSION_CLEANUP_INTERVAL_SEC"),
            str(_CHAT_UPLOAD_SESSION_CLEANUP_INTERVAL_DEFAULT),
        )
        try:
            return max(60, min(60 * 60, int(raw)))
        except Exception:
            return _CHAT_UPLOAD_SESSION_CLEANUP_INTERVAL_DEFAULT

    @property
    def group_max_members(self) -> int:
        raw = _normalize_text(os.getenv("CHAT_GROUP_MAX_MEMBERS"), "128")
        try:
            return max(2, min(512, int(raw)))
        except Exception:
            return 128

    def _cache_key(self, *, user_id: int, bucket: str, extra: str = "") -> str:
        return self._cache._cache_key(user_id=user_id, bucket=bucket, extra=extra)
    def _cache_get(self, *, user_id: int, bucket: str, extra: str = "") -> Any:
        return self._cache._cache_get(user_id=user_id, bucket=bucket, extra=extra)
    def _cache_set(self, *, user_id: int, bucket: str, value: Any, extra: str = "", ttl_sec: int | None = None) -> Any:
        return self._cache._cache_set(user_id=user_id, bucket=bucket, value=value, extra=extra, ttl_sec=ttl_sec)
    def _invalidate_user_cache(self, *, user_id: int, bucket: str | None = None, extra_prefix: str = "") -> None:
        return self._cache._invalidate_user_cache(user_id=user_id, bucket=bucket, extra_prefix=extra_prefix)
    def invalidate_bucket_for_all_users(self, *, bucket: str) -> None:
        """Remove all cache entries for given bucket regardless of user_id."""
        normalized_bucket = _normalize_text(bucket)
        needle = f"::{normalized_bucket}::"
        from backend.chat.chat_read_cache_redis import chat_read_cache_redis

        if chat_read_cache_redis.supports_bucket(normalized_bucket):
            chat_read_cache_redis.invalidate_bucket(normalized_bucket)
        with self._cache_lock:
            for key in list(self._runtime_cache.keys()):
                if needle in key:
                    self._runtime_cache.pop(key, None)

    def invalidate_presence_cache(self, *, user_id: int) -> None:
        needle = str(int(user_id))
        with self._cache_lock:
            for key in list(self._presence_cache.keys()):
                if key == "__all__" or needle in key.split(","):
                    self._presence_cache.pop(key, None)

    def _invalidate_conversation_views_for_users(self, *, conversation_id: str, user_ids: list[int] | set[int] | tuple[int, ...]) -> None:
        return self._cache._invalidate_conversation_views_for_users(conversation_id=conversation_id, user_ids=user_ids)
    def _set_request_meta(self, **payload: Any) -> None:
        _chat_request_meta_var.set(dict(payload))

    def _update_request_meta(self, **payload: Any) -> None:
        current = dict(_chat_request_meta_var.get() or {})
        for key, value in payload.items():
            if isinstance(value, list) and isinstance(current.get(key), list):
                current[key] = [*list(current.get(key) or []), *value]
            else:
                current[key] = value
        _chat_request_meta_var.set(current)

    def consume_request_meta(self) -> dict[str, Any]:
        payload = dict(_chat_request_meta_var.get() or {})
        _chat_request_meta_var.set(None)
        return payload

    def initialize_runtime(self, *, force: bool = False) -> ChatRuntimeStatus:
        if self._runtime_status is not None and not force:
            return self._runtime_status
        if not is_chat_enabled():
            self._runtime_status = ChatRuntimeStatus(enabled=False, configured=False, available=False, database_url_masked=None)
            return self._runtime_status
        database_url = get_chat_database_url()
        if not database_url:
            self._runtime_status = ChatRuntimeStatus(enabled=True, configured=False, available=False, database_url_masked=None)
            return self._runtime_status
        try:
            initialize_chat_schema()
            ping_chat_database()
            self._runtime_status = ChatRuntimeStatus(
                enabled=True,
                configured=True,
                available=True,
                database_url_masked=self._mask_database_url(database_url),
            )
        except Exception:
            self._runtime_status = ChatRuntimeStatus(
                enabled=True,
                configured=True,
                available=False,
                database_url_masked=self._mask_database_url(database_url),
            )
        return self._runtime_status

    async def start(self) -> None:
        self.cleanup_expired_upload_sessions(force=True)
        try:
            from backend.chat.event_outbox_service import chat_event_outbox_service

            await chat_event_outbox_service.start()
        except Exception:
            logger.warning("Chat event outbox dispatcher failed to start", exc_info=True)
        try:
            from backend.chat.push_outbox_service import chat_push_outbox_service

            await chat_push_outbox_service.start()
        except Exception:
            logger.warning("Chat push outbox worker failed to start", exc_info=True)
        if self._upload_cleanup_task and not self._upload_cleanup_task.done():
            return
        self._upload_cleanup_stop_event = asyncio.Event()
        self._upload_cleanup_task = asyncio.create_task(
            self._run_upload_session_cleanup_loop(),
            name="chat-upload-session-cleanup",
        )

    async def stop(self) -> None:
        try:
            from backend.chat.event_outbox_service import chat_event_outbox_service

            await chat_event_outbox_service.stop()
        except Exception:
            logger.warning("Chat event outbox dispatcher failed to stop", exc_info=True)
        try:
            from backend.chat.push_outbox_service import chat_push_outbox_service

            await chat_push_outbox_service.stop()
        except Exception:
            logger.warning("Chat push outbox worker failed to stop", exc_info=True)
        if self._upload_cleanup_stop_event is not None:
            self._upload_cleanup_stop_event.set()
        if self._upload_cleanup_task:
            self._upload_cleanup_task.cancel()
            try:
                await self._upload_cleanup_task
            except asyncio.CancelledError:
                pass
        self._upload_cleanup_task = None
        self._upload_cleanup_stop_event = None

    async def _run_upload_session_cleanup_loop(self) -> None:
        while True:
            try:
                self.cleanup_expired_upload_sessions(force=True)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Chat upload session cleanup iteration failed", exc_info=True)
            try:
                assert self._upload_cleanup_stop_event is not None
                await asyncio.wait_for(
                    self._upload_cleanup_stop_event.wait(),
                    timeout=self.upload_session_cleanup_interval_sec,
                )
                return
            except asyncio.TimeoutError:
                continue

    def get_health(self) -> dict:
        now_mono = time.monotonic()
        with self._cache_lock:
            if self._health_cache is not None:
                cached_at, cached_payload = self._health_cache
                if (now_mono - cached_at) < self._health_cache_ttl_sec:
                    return dict(cached_payload)

        status = self.initialize_runtime(force=False)
        try:
            from backend.chat.push_outbox_service import chat_push_outbox_service
            push_outbox_snapshot = dict(chat_push_outbox_service.get_backlog_snapshot() or {})
        except Exception:
            push_outbox_snapshot = {}
        try:
            from backend.chat.event_outbox_service import chat_event_outbox_service

            event_outbox_snapshot = dict(chat_event_outbox_service.get_backlog_snapshot() or {})
        except Exception:
            event_outbox_snapshot = {}
        try:
            from backend.chat.realtime import get_chat_realtime_metrics
            realtime_metrics = dict(get_chat_realtime_metrics() or {})
        except Exception:
            realtime_metrics = {}
        try:
            from backend.ai_chat.retrieval_interface import ai_kb_retrieval
            ai_kb_metrics = dict(ai_kb_retrieval.get_metrics() or {})
        except Exception:
            ai_kb_metrics = {}
        try:
            from backend.ai_chat.service import get_ai_chat_runtime_metrics
            ai_runtime_metrics = dict(get_ai_chat_runtime_metrics() or {})
        except Exception:
            ai_runtime_metrics = {}
        try:
            from backend.chat.request_metrics import get_chat_route_metrics
            route_metrics = dict(get_chat_route_metrics() or {})
        except Exception:
            route_metrics = {}
        try:
            from backend.chat.chat_read_cache_redis import chat_read_cache_redis
            read_cache_metrics = dict(chat_read_cache_redis.get_metrics() or {})
        except Exception:
            read_cache_metrics = {}
        redis_available = bool(realtime_metrics.get("redis_available"))
        redis_configured = bool(realtime_metrics.get("redis_configured"))
        pubsub_subscribed = bool(realtime_metrics.get("pubsub_subscribed"))
        ai_worker_concurrency = 0
        try:
            ai_worker_concurrency = int(os.getenv("AI_CHAT_WORKER_CONCURRENCY", "2") or "2")
        except Exception:
            ai_worker_concurrency = 2
        realtime_mode = "redis" if (redis_available and pubsub_subscribed) else ("local_fallback" if redis_configured else "local")
        payload = {
            "enabled": bool(status.enabled),
            "configured": bool(status.configured),
            "available": bool(status.available),
            "database_url_masked": status.database_url_masked,
            "realtime_mode": realtime_mode,
            "redis_available": redis_available,
            "redis_configured": redis_configured,
            "pubsub_subscribed": pubsub_subscribed,
            "realtime_node_id": _normalize_text(realtime_metrics.get("realtime_node_id")) or None,
            "outbound_queue_depth": int(realtime_metrics.get("outbound_queue_depth", 0) or 0),
            "slow_consumer_disconnects": int(realtime_metrics.get("slow_consumer_disconnects", 0) or 0),
            "presence_watch_count": int(realtime_metrics.get("presence_watch_count", 0) or 0),
            "local_connection_count": int(realtime_metrics.get("local_connection_count", 0) or 0),
            "push_outbox_backlog": int(push_outbox_snapshot.get("queued", 0) or 0),
            "push_outbox_ready": int(push_outbox_snapshot.get("ready", 0) or 0),
            "push_outbox_processing": int(push_outbox_snapshot.get("processing", 0) or 0),
            "push_outbox_failed": int(push_outbox_snapshot.get("failed", 0) or 0),
            "push_outbox_oldest_queued_age_sec": float(push_outbox_snapshot.get("oldest_queued_age_sec", 0.0) or 0.0),
            "event_outbox_backlog": int(event_outbox_snapshot.get("queued", 0) or 0),
            "event_outbox_processing": int(event_outbox_snapshot.get("processing", 0) or 0),
            "event_outbox_failed": int(event_outbox_snapshot.get("failed", 0) or 0),
            "event_outbox_oldest_queued_age_sec": float(event_outbox_snapshot.get("oldest_queued_age_sec", 0.0) or 0.0),
            "event_dispatcher_active": bool(event_outbox_snapshot.get("dispatcher_active", 0)),
            "event_outbox_avg_job_ms": float(event_outbox_snapshot.get("avg_job_ms", 0.0) or 0.0),
            "ws_rate_limited_count": int(realtime_metrics.get("ws_rate_limited_count", 0) or 0),
            "ws_rate_limited_connections": int(realtime_metrics.get("ws_rate_limited_connections", 0) or 0),
            "ai_worker_concurrency": max(1, min(16, ai_worker_concurrency)),
            "ai_kb_index_age_sec": float(ai_kb_metrics.get("index_age_sec", 0.0) or 0.0),
            "ai_last_run_duration_ms": float(ai_runtime_metrics.get("last_run_duration_ms", 0.0) or 0.0),
            "route_metrics": route_metrics,
            "read_cache_metrics": read_cache_metrics,
        }
        with self._cache_lock:
            self._health_cache = (time.monotonic(), dict(payload))
        return payload

    def _get_upload_session_lock(self, session_id: str) -> RLock:
        return self._upload_sessions.lock_for(session_id)

    def _release_upload_session_lock(self, session_id: str) -> None:
        self._upload_sessions.release_lock(session_id)

    def _upload_session_dir(self, session_id: str) -> Path:
        return self._upload_orchestrator._upload_session_dir(session_id)
    def _upload_session_manifest_path(self, session_id: str) -> Path:
        return self._upload_orchestrator._upload_session_manifest_path(session_id)
    def _upload_session_part_path(self, session_id: str, file_id: str) -> Path:
        return self._upload_orchestrator._upload_session_part_path(session_id, file_id)
    def _load_upload_session_manifest(self, session_id: str) -> dict[str, Any]:
        return self._upload_sessions.load_manifest(session_id)

    def _write_upload_session_manifest(self, manifest: dict[str, Any]) -> None:
        self._upload_sessions.write_manifest(manifest)

    def _delete_upload_session_dir(self, session_id: str) -> None:
        self._upload_sessions.delete_session_dir(session_id)

    def _maybe_cleanup_upload_sessions(self, *, force: bool = False) -> None:
        self._upload_sessions.maybe_cleanup(force=force)

    def cleanup_expired_upload_sessions(self, *, force: bool = False, now: datetime | None = None) -> dict[str, int]:
        return self._upload_sessions.cleanup_expired(force=force, now=now)

    def _require_upload_session_access(self, manifest: dict[str, Any], *, current_user_id: int) -> None:
        session_owner_id = int(manifest.get("current_user_id", 0) or 0)
        if session_owner_id <= 0 or session_owner_id != int(current_user_id):
            raise PermissionError("Upload session not found")
        conversation_id = _normalize_text(manifest.get("conversation_id"))
        if not conversation_id:
            raise LookupError("Upload session not found")
        with chat_session() as session:
            self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )

    def _ensure_upload_session_active(self, manifest: dict[str, Any]) -> None:
        self._upload_sessions.ensure_active(manifest)

    def _serialize_upload_session_file(self, file_payload: dict[str, Any]) -> dict[str, Any]:
        return self._serialization._serialize_upload_session_file(file_payload)
    def _serialize_upload_session(self, manifest: dict[str, Any]) -> dict[str, Any]:
        return self._serialization._serialize_upload_session(manifest)
    def _find_upload_session_file(self, manifest: dict[str, Any], *, file_id: str) -> dict[str, Any]:
        return self._upload_sessions.find_file(manifest, file_id=file_id)

    def _normalize_transfer_encoding(self, value: object) -> str:
        return self._upload_orchestrator._normalize_transfer_encoding(value)
    def _normalize_media_kind(self, value: object) -> str | None:
        normalized = _normalize_text(value).lower()
        if not normalized:
            return None
        if normalized not in {"image", "video", "audio", "file"}:
            raise ValueError(f"Unsupported media kind: {normalized}")
        return normalized

    def _normalize_duration_seconds(self, value: object) -> int | None:
        if value is None or str(value).strip() == "":
            return None
        try:
            duration = int(round(float(value)))
        except (TypeError, ValueError) as exc:
            raise ValueError("duration_seconds must be a non-negative number") from exc
        if duration < 0:
            raise ValueError("duration_seconds must be a non-negative number")
        return min(duration, 86400)

    def _normalize_audio_mime_type(self, *, mime_type: str, file_name: str) -> str:
        if mime_type.startswith("audio/"):
            return mime_type
        suffix = Path(file_name).suffix.lower()
        if suffix == ".webm":
            return "audio/webm"
        if suffix in {".ogg", ".opus"}:
            return "audio/ogg"
        if suffix == ".m4a":
            return "audio/mp4"
        if suffix == ".mp3":
            return "audio/mpeg"
        if suffix == ".wav":
            return "audio/wav"
        if suffix == ".aac":
            return "audio/aac"
        if suffix == ".flac":
            return "audio/flac"
        return "audio/webm"

    def _is_archive_file_type(self, *, file_name: str, mime_type: str) -> bool:
        suffix = Path(file_name).suffix.lower()
        if suffix in CHAT_ARCHIVE_EXTENSIONS:
            return True
        return mime_type in CHAT_ARCHIVE_MIME_TYPES

    def _ensure_supported_upload_type(self, *, file_name: str, mime_type: str) -> None:
        if self._is_archive_file_type(file_name=file_name, mime_type=mime_type):
            raise ValueError(f"Archive files are not allowed: {file_name}")
        if not self._is_allowed_file_type(file_name=file_name, mime_type=mime_type):
            raise ValueError(f"Unsupported file type: {file_name}")

    def _normalize_upload_transfer_meta(self, meta: Any) -> dict[str, Any]:
        payload = meta if isinstance(meta, dict) else {}
        transfer_encoding = self._normalize_transfer_encoding(payload.get("transfer_encoding"))
        media_kind = self._normalize_media_kind(payload.get("media_kind"))
        duration_seconds = self._normalize_duration_seconds(payload.get("duration_seconds"))
        raw_original_size = payload.get("original_size")
        if raw_original_size is None or str(raw_original_size).strip() == "":
            return {
                "transfer_encoding": transfer_encoding,
                "original_size": None,
                "media_kind": media_kind,
                "duration_seconds": duration_seconds,
            }
        try:
            original_size = int(raw_original_size)
        except (TypeError, ValueError) as exc:
            raise ValueError("original_size must be a positive integer") from exc
        if original_size <= 0:
            raise ValueError("original_size must be a positive integer")
        return {
            "transfer_encoding": transfer_encoding,
            "original_size": original_size,
            "media_kind": media_kind,
            "duration_seconds": duration_seconds,
        }

    def _write_decoded_transfer_payload(
        self,
        *,
        source_stream,
        target_path: Path,
        transfer_encoding: str,
        expected_original_size: int | None,
        total_size: int,
    ) -> tuple[int, bytes, int]:
        normalized_transfer_encoding = self._normalize_transfer_encoding(transfer_encoding)
        probe_bytes = bytearray()
        file_size = 0
        reader = source_stream
        gzip_reader = None

        try:
            if normalized_transfer_encoding == "gzip":
                gzip_reader = gzip.GzipFile(fileobj=source_stream, mode="rb")
                reader = gzip_reader
            with target_path.open("wb") as target:
                while True:
                    chunk = reader.read(_CHAT_UPLOAD_STREAM_CHUNK_BYTES)
                    if not chunk:
                        break
                    if isinstance(chunk, str):
                        chunk = chunk.encode("utf-8")
                    chunk_size = len(chunk)
                    if chunk_size <= 0:
                        continue
                    next_file_size = file_size + chunk_size
                    if expected_original_size is not None and next_file_size > expected_original_size:
                        raise ValueError("Decoded file size exceeds original_size")
                    next_total_size = total_size + chunk_size
                    if next_total_size > CHAT_MAX_TOTAL_FILE_BYTES:
                        raise ValueError("Total upload size exceeds 1 GB")
                    file_size = next_file_size
                    total_size = next_total_size
                    target.write(chunk)
                    if len(probe_bytes) < _CHAT_IMAGE_DIMENSION_PROBE_BYTES:
                        remaining = _CHAT_IMAGE_DIMENSION_PROBE_BYTES - len(probe_bytes)
                        probe_bytes.extend(chunk[:remaining])
        except (OSError, EOFError, gzip.BadGzipFile) as exc:
            if normalized_transfer_encoding == "gzip":
                raise ValueError("Invalid gzip payload") from exc
            raise
        finally:
            if gzip_reader is not None:
                try:
                    gzip_reader.close()
                except Exception:
                    pass

        if expected_original_size is not None and file_size != expected_original_size:
            raise ValueError("Decoded file size does not match original_size")
        return file_size, bytes(probe_bytes), total_size

    def _build_upload_session_file_manifest(
        self,
        *,
        file_name: str,
        mime_type: str,
        size: int,
        original_size: int,
        transfer_encoding: str,
        media_kind: object = None,
        duration_seconds: object = None,
    ) -> dict[str, Any]:
        normalized_file_name = _safe_file_name(file_name)
        normalized_media_kind = self._normalize_media_kind(media_kind)
        normalized_duration_seconds = self._normalize_duration_seconds(duration_seconds)
        normalized_mime_type = self._normalize_mime_type(
            mime_type,
            file_name=normalized_file_name,
            media_kind=normalized_media_kind,
        )
        self._ensure_supported_upload_type(file_name=normalized_file_name, mime_type=normalized_mime_type)
        normalized_size = int(size or 0)
        normalized_original_size = int(original_size or normalized_size or 0)
        if normalized_size <= 0:
            raise ValueError(f"File is empty: {normalized_file_name}")
        if normalized_original_size <= 0:
            raise ValueError(f"original_size is required: {normalized_file_name}")
        normalized_transfer_encoding = self._normalize_transfer_encoding(transfer_encoding)
        if normalized_transfer_encoding == "identity" and normalized_size != normalized_original_size:
            raise ValueError(f"identity upload size mismatch: {normalized_file_name}")
        if normalized_transfer_encoding == "gzip" and normalized_size >= normalized_original_size:
            raise ValueError(f"gzip upload must be smaller than original_size: {normalized_file_name}")
        file_id = str(uuid4())
        chunk_count = max(1, (normalized_size + self.upload_session_chunk_size_bytes - 1) // self.upload_session_chunk_size_bytes)
        return {
            "file_id": file_id,
            "attachment_id": file_id,
            "file_name": normalized_file_name,
            "mime_type": normalized_mime_type,
            "media_kind": normalized_media_kind,
            "duration_seconds": normalized_duration_seconds,
            "size": normalized_size,
            "original_size": normalized_original_size,
            "transfer_encoding": normalized_transfer_encoding,
            "storage_name": f"{file_id}_{normalized_file_name}",
            "chunk_count": chunk_count,
            "received_bytes": 0,
            "received_chunks": [],
        }

    def _find_existing_upload_session_message_id(self, *, session, manifest: dict[str, Any]) -> str:
        attachment_ids = [
            _normalize_text(item.get("attachment_id") or item.get("file_id"))
            for item in list(manifest.get("files") or [])
            if _normalize_text(item.get("attachment_id") or item.get("file_id"))
        ]
        if not attachment_ids:
            return ""
        attachment = session.execute(
            select(ChatMessageAttachment).where(ChatMessageAttachment.id.in_(attachment_ids)).limit(1)
        ).scalar_one_or_none()
        if attachment is None:
            return ""
        return _normalize_text(getattr(attachment, "message_id", None))

    def list_available_users(self, *, current_user_id: int, q: str = "", limit: int = 50) -> list[dict]:
        from backend.services.ad_users_service import is_hub_service_account_login

        search = _normalize_text(q).lower()
        page_size = max(1, int(limit))
        users = []
        for item in user_service.list_users():
            user_id = int(item.get("id", 0) or 0)
            if user_id <= 0 or user_id == int(current_user_id):
                continue
            if not bool(item.get("is_active", True)):
                continue
            if is_hub_service_account_login(item.get("username")):
                continue
            haystack = " ".join([
                _normalize_text(item.get("username")),
                _normalize_text(item.get("full_name")),
                _normalize_text(item.get("email")),
                _normalize_text(item.get("mailbox_email")),
                _normalize_text(item.get("mailbox_login")),
            ]).lower()
            if search and search not in haystack:
                continue
            users.append(dict(item))
        users.sort(key=lambda item: ((_normalize_text(item.get("full_name")) or item["username"]).lower(), item["username"]))
        users = users[:page_size]
        presence_map = self._get_presence_map(
            user_ids=[int(item.get("id", 0) or 0) for item in users],
        )
        return [
            self._serialize_user(item, presence_map=presence_map)
            for item in users
        ]

    def resolve_user_for_address_book(
        self,
        *,
        current_user_id: int,
        email: str = "",
        full_name: str = "",
    ) -> dict:
        self._ensure_available()
        email_norm = _normalize_text(email).lower()
        name_norm = re.sub(r"\s+", " ", _normalize_text(full_name)).casefold()

        candidates: list[dict[str, Any]] = []
        from backend.services.ad_users_service import is_hub_service_account_login

        for item in user_service.list_users():
            user_id = int(item.get("id", 0) or 0)
            if user_id <= 0 or user_id == int(current_user_id):
                continue
            if not bool(item.get("is_active", True)):
                continue
            if is_hub_service_account_login(item.get("username")):
                continue
            candidates.append(dict(item))

        def _email_fields(item: dict[str, Any]) -> list[str]:
            values: list[str] = []
            for key in ("email", "mailbox_email", "mailbox_login", "username"):
                val = _normalize_text(item.get(key)).lower()
                if val:
                    values.append(val)
            return values

        def _serialize_match(item: dict[str, Any]) -> dict:
            presence_map = self._get_presence_map(user_ids=[int(item.get("id", 0) or 0)])
            return self._serialize_user(item, presence_map=presence_map)

        if email_norm:
            for item in candidates:
                if email_norm in _email_fields(item):
                    return _serialize_match(item)
            local_part = email_norm.split("@", 1)[0].strip()
            if local_part:
                username_matches = [
                    item
                    for item in candidates
                    if _normalize_text(item.get("username")).lower() == local_part
                ]
                if len(username_matches) == 1:
                    return _serialize_match(username_matches[0])

        if name_norm:
            exact_name_matches = [
                item
                for item in candidates
                if re.sub(r"\s+", " ", _normalize_text(item.get("full_name"))).casefold() == name_norm
            ]
            if len(exact_name_matches) == 1:
                return _serialize_match(exact_name_matches[0])

            name_tokens = [token for token in name_norm.split() if token]
            if len(name_tokens) >= 2:
                fuzzy_matches = []
                for item in candidates:
                    hub_name = re.sub(r"\s+", " ", _normalize_text(item.get("full_name"))).casefold()
                    if hub_name and all(token in hub_name for token in name_tokens[:2]):
                        fuzzy_matches.append(item)
                if len(fuzzy_matches) == 1:
                    return _serialize_match(fuzzy_matches[0])

        raise LookupError(
            "Сотрудник не найден в HUB-чате. Возможно, у него нет учётной записи или e-mail не совпадает."
        )

    def list_conversations(
        self,
        *,
        current_user_id: int,
        q: str = "",
        limit: int = 50,
        cursor: str = "",
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.list_conversations(
            current_user_id=int(current_user_id),
            q=q,
            limit=limit,
            cursor=cursor,
        )

    def list_shareable_tasks(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        q: str = "",
        limit: int = 50,
    ) -> list[dict]:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        page_size = max(1, min(int(limit), 200))

        with chat_session() as session:
            self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            participant_ids = self._conversation_member_ids(session, normalized_conversation_id)

        current_user_raw = user_service.get_by_id(int(current_user_id)) or {}
        allow_all_scope = self._is_admin_user(current_user_raw)
        candidates_payload = hub_service.list_tasks(
            user_id=int(current_user_id),
            scope="all" if allow_all_scope else "my",
            q=_normalize_text(q),
            limit=min(max(page_size * 5, page_size), 500),
            allow_all_scope=allow_all_scope,
        )

        items = []
        seen_task_ids: set[str] = set()
        for item in list(candidates_payload.get("items") or []):
            task_id = _normalize_text(item.get("id"))
            if not task_id or task_id in seen_task_ids:
                continue
            if not self._task_is_shareable_to_members(task_id=task_id, member_ids=participant_ids):
                continue
            items.append(self._build_task_preview(item))
            seen_task_ids.add(task_id)
            if len(items) >= page_size:
                break
        return items

    def get_unread_summary(self, *, current_user_id: int) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_unread_summary(current_user_id=int(current_user_id))

    def get_unread_summaries(
        self,
        *,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        self._ensure_available()
        return self._conversation_reads.get_unread_summaries(user_ids=user_ids)

    def get_push_config(self) -> dict:
        self._ensure_available()
        return chat_push_service.get_public_config()

    def upsert_push_subscription(
        self,
        *,
        current_user_id: int,
        endpoint: str,
        p256dh_key: str,
        auth_key: str,
        expiration_time: Optional[int] = None,
        user_agent: Optional[str] = None,
        platform: Optional[str] = None,
        browser_family: Optional[str] = None,
        install_mode: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        return chat_push_service.upsert_subscription(
            current_user_id=int(current_user_id),
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
            expiration_time=expiration_time,
            user_agent=user_agent,
            platform=platform,
            browser_family=browser_family,
            install_mode=install_mode,
        )

    def delete_push_subscription(
        self,
        *,
        current_user_id: int,
        endpoint: str,
    ) -> dict:
        self._ensure_available()
        return chat_push_service.delete_subscription(
            current_user_id=int(current_user_id),
            endpoint=endpoint,
        )

    def get_conversation_member_ids(self, *, conversation_id: str) -> list[int]:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            return []
        with chat_session() as session:
            return self._conversation_member_ids(session, normalized_conversation_id)

    def _delete_conversation_rows(self, *, session, conversation: ChatConversation) -> dict[str, Any]:
        conversation_id = _normalize_text(conversation.id)
        member_user_ids = self._conversation_member_ids(session, conversation_id)
        session.query(ChatPushOutbox).filter(
            ChatPushOutbox.conversation_id == conversation_id,
        ).delete(synchronize_session=False)
        session.query(ChatEventOutbox).filter(
            ChatEventOutbox.conversation_id == conversation_id,
        ).delete(synchronize_session=False)
        for model in (
            ChatMessageReaction,
            ChatMessageRead,
            ChatMessageAttachment,
            ChatFolderConversation,
            ChatConversationUserState,
            ChatMember,
            ChatMessage,
        ):
            session.query(model).filter(
                model.conversation_id == conversation_id,
            ).delete(synchronize_session=False)
        session.query(ChatConversation).filter(
            ChatConversation.id == conversation_id,
        ).delete(synchronize_session=False)
        return {
            "conversation_id": conversation_id,
            "member_user_ids": member_user_ids,
        }

    def _cleanup_deleted_conversation_storage(self, *, conversation_id: str, member_user_ids: list[int]) -> None:
        self._invalidate_conversation_views_for_users(
            conversation_id=conversation_id,
            user_ids=member_user_ids,
        )
        shutil.rmtree(self._attachments_root / conversation_id, ignore_errors=True)
        self._upload_sessions.delete_for_conversation(conversation_id)
        try:
            hub_service.delete_notifications_for_entity(
                entity_type="chat",
                entity_id=conversation_id,
            )
        except Exception:
            logger.warning(
                "chat.delete_conversation notification cleanup failed conversation_id=%s",
                conversation_id,
                exc_info=True,
            )

    def delete_conversation(self, *, current_user_id: int, conversation_id: str) -> dict[str, Any]:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation_kind = _normalize_text(conversation.kind).lower()
            if conversation_kind == "task":
                raise ValueError("Task discussion can only be deleted together with the task")
            if conversation_kind == "ai":
                raise ValueError("AI conversations cannot be deleted from the chat list")
            if conversation_kind == "group":
                membership = self._get_active_membership(
                    session=session,
                    conversation_id=conversation.id,
                    user_id=int(current_user_id),
                )
                if membership is None or _normalize_member_role(membership.member_role) != "owner":
                    raise PermissionError("Only group owner can delete the conversation")
            deleted = self._delete_conversation_rows(session=session, conversation=conversation)

        self._cleanup_deleted_conversation_storage(
            conversation_id=deleted["conversation_id"],
            member_user_ids=deleted["member_user_ids"],
        )
        return deleted

    def delete_task_conversation(self, *, task_id: str) -> Optional[dict[str, Any]]:
        self._ensure_available()
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            return None

        with chat_session() as session:
            conversation = session.execute(
                select(ChatConversation).where(
                    ChatConversation.kind == "task",
                    ChatConversation.task_id == normalized_task_id,
                ).limit(1)
            ).scalar_one_or_none()
            if conversation is None:
                return None
            deleted = self._delete_conversation_rows(session=session, conversation=conversation)

        self._cleanup_deleted_conversation_storage(
            conversation_id=deleted["conversation_id"],
            member_user_ids=deleted["member_user_ids"],
        )
        return deleted

    def _extract_mention_handles(self, body: object) -> set[str]:
        text = _normalize_text(body)
        if "@" not in text:
            return set()
        return {
            _normalize_mention_handle(match.group(1))
            for match in _CHAT_MENTION_PATTERN.finditer(text)
            if _normalize_mention_handle(match.group(1))
        }

    def _resolve_mentioned_member_user_ids(
        self,
        *,
        member_user_ids: list[int] | set[int] | tuple[int, ...],
        sender_user_id: int,
        body: object,
    ) -> set[int]:
        handles = self._extract_mention_handles(body)
        if not handles:
            return set()
        candidate_user_ids = sorted({
            int(item)
            for item in list(member_user_ids or [])
            if int(item) > 0 and int(item) != int(sender_user_id)
        })
        if not candidate_user_ids:
            return set()
        try:
            users_by_id = user_service.get_users_map_by_ids(candidate_user_ids)
        except Exception:
            users_by_id = {}
        result: set[int] = set()
        for user_id in candidate_user_ids:
            user = users_by_id.get(int(user_id)) or {}
            candidate_handles = {
                _normalize_mention_handle(user.get("username")),
                _mention_handle_from_person_name(user.get("full_name")),
            }
            if handles.intersection({item for item in candidate_handles if item}):
                result.add(int(user_id))
        return result

    def get_conversation(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_conversation(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
        )

    def get_conversation_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_conversation_summary(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
        )

    def verify_conversation_access(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> None:
        self._ensure_available()
        with chat_session() as session:
            self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )

    def get_conversation_summaries_for_users(
        self,
        *,
        conversation_id: str,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        self._ensure_available()
        return self._conversation_reads.get_conversation_summaries_for_users(
            conversation_id=conversation_id,
            user_ids=user_ids,
        )

    def get_conversation_assets_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        recent_limit: int = 8,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.get_conversation_assets_summary(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            recent_limit=recent_limit,
        )

    def list_conversation_attachments(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        kind: str,
        limit: int = 20,
        before_attachment_id: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        return self._conversation_reads.list_conversation_attachments(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            kind=kind,
            limit=limit,
            before_attachment_id=before_attachment_id,
        )

    def get_message(
        self,
        *,
        current_user_id: int,
        message_id: str,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message(
            current_user_id=int(current_user_id),
            message_id=message_id,
        )

    def get_messages_for_users(
        self,
        *,
        message_id: str,
        user_ids: list[int],
    ) -> dict[int, dict]:
        self._ensure_available()
        return self._thread_reads.get_messages_for_users(
            message_id=message_id,
            user_ids=user_ids,
        )

    def get_presence(self, *, user_id: int) -> dict:
        self._ensure_available()
        return self._presence_service.get_presence(user_id=user_id)

    def get_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        before_message_id: Optional[str] = None,
        after_message_id: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.get_messages(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            before_message_id=before_message_id,
            after_message_id=after_message_id,
            limit=limit,
        )

    def get_thread_bootstrap(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        focus_message_id: Optional[str] = None,
        limit: int = 40,
        lightweight: bool = True,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._thread_reads.get_thread_bootstrap(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            focus_message_id=focus_message_id,
            limit=limit,
            lightweight=bool(lightweight),
        )

    def hydrate_thread_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_ids: list[str],
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._thread_reads.hydrate_thread_messages(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            message_ids=message_ids,
        )

    def search_messages(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        q: str,
        limit: int = 20,
        before_message_id: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        return self._thread_reads.search_messages(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            q=q,
            limit=limit,
            before_message_id=before_message_id,
        )

    def get_message_reads(self, *, current_user_id: int, message_id: str) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message_reads(
            current_user_id=int(current_user_id),
            message_id=message_id,
        )

    def toggle_reaction(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_id: str,
        emoji: str,
    ) -> dict:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        normalized_emoji = _normalize_text(emoji)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        if not normalized_message_id or not normalized_emoji:
            raise ValueError("message_id and emoji are required")
        if len(normalized_emoji) > 32:
            raise ValueError("emoji too long")
        with chat_session() as session:
            self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            message = session.execute(
                select(ChatMessage).where(
                    ChatMessage.id == normalized_message_id,
                    ChatMessage.conversation_id == normalized_conversation_id,
                )
            ).scalar_one_or_none()
            if message is None:
                raise LookupError(f"Message {normalized_message_id!r} not found")
            existing = session.execute(
                select(ChatMessageReaction).where(
                    ChatMessageReaction.message_id == normalized_message_id,
                    ChatMessageReaction.user_id == int(current_user_id),
                    ChatMessageReaction.emoji == normalized_emoji,
                )
            ).scalar_one_or_none()
            if existing is not None:
                session.delete(existing)
                session.flush()
                action = "removed"
            else:
                reaction = ChatMessageReaction(
                    message_id=normalized_message_id,
                    conversation_id=message.conversation_id,
                    user_id=int(current_user_id),
                    emoji=normalized_emoji,
                )
                session.add(reaction)
                session.flush()
                action = "added"
            rows = session.execute(
                select(ChatMessageReaction).where(
                    ChatMessageReaction.message_id == normalized_message_id,
                )
            ).scalars().all()
            reactions_map: dict[str, list[int]] = {}
            for row in rows:
                reactions_map.setdefault(row.emoji, []).append(row.user_id)
            return {
                "message_id": normalized_message_id,
                "conversation_id": message.conversation_id,
                "action": action,
                "emoji": normalized_emoji,
                "user_id": int(current_user_id),
                "reactions": [
                    {"emoji": e, "user_ids": uids, "count": len(uids)}
                    for e, uids in reactions_map.items()
                ],
            }

    def get_message_reactions(self, *, message_id: str) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")
        with chat_session() as session:
            rows = session.execute(
                select(ChatMessageReaction).where(
                    ChatMessageReaction.message_id == normalized_message_id,
                )
            ).scalars().all()
            reactions_map: dict[str, list[int]] = {}
            for row in rows:
                reactions_map.setdefault(row.emoji, []).append(row.user_id)
            return {
                "message_id": normalized_message_id,
                "reactions": [
                    {"emoji": e, "user_ids": uids, "count": len(uids)}
                    for e, uids in reactions_map.items()
                ],
            }

    def get_message_read_delta(self, *, conversation_id: str, message_id: str) -> dict:
        self._ensure_available()
        return self._thread_reads.get_message_read_delta(
            conversation_id=conversation_id,
            message_id=message_id,
        )

    def send_task_share(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        task_id: str,
        reply_to_message_id: Optional[str] = None,
        defer_push_notifications: bool = False,
    ) -> dict:
        self._ensure_available()
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            raise ValueError("task_id is required")

        persisted_task = self._task_share_message_persistence.persist_task_share_message(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            task_id=normalized_task_id,
            reply_to_message_id=reply_to_message_id,
        )
        payload = persisted_task.payload
        task_preview = persisted_task.task_preview
        notification_stats = self._create_chat_notifications(
            sender_user_id=int(current_user_id),
            conversation_id=_normalize_text(payload.get("conversation_id")),
            message_id=_normalize_text(payload.get("id")),
            event_type="chat.task_shared",
            title="Поделились задачей в чате",
            body=_normalize_text(task_preview.get("title")) or "Откройте чат, чтобы посмотреть карточку задачи.",
            defer_push_notifications=defer_push_notifications,
        )
        return payload

    def send_files(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: Optional[str] = None,
        uploads: list[UploadFile],
        files_meta: Optional[list[dict[str, Any]]] = None,
        reply_to_message_id: Optional[str] = None,
        defer_push_notifications: bool = False,
    ) -> dict:
        self._ensure_available()
        return self._upload_orchestrator.send_files(current_user_id=current_user_id, conversation_id=conversation_id, body=body, uploads=uploads, files_meta=files_meta, reply_to_message_id=reply_to_message_id, defer_push_notifications=defer_push_notifications)
    def _postprocess_file_message(
        self,
        *,
        current_user_id: int,
        payload: dict[str, Any],
        prepared: list[dict[str, Any]],
        body: str,
        defer_push_notifications: bool = False,
    ) -> None:
        file_names = [_normalize_text(item.get("file_name")) for item in prepared]
        notification_body = file_names[0] if len(file_names) == 1 else f"Files: {len(file_names)}"
        notification_body = _normalize_text(body) or notification_body
        member_user_ids = self.get_conversation_member_ids(
            conversation_id=_normalize_text(payload.get("conversation_id")),
        )
        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("conversation_id")),
            user_ids=member_user_ids,
        )
        mentioned_user_ids = self._resolve_mentioned_member_user_ids(
            member_user_ids=member_user_ids,
            sender_user_id=int(current_user_id),
            body=body,
        )
        notification_stats = self._create_chat_notifications(
            sender_user_id=int(current_user_id),
            conversation_id=_normalize_text(payload.get("conversation_id")),
            message_id=_normalize_text(payload.get("id")),
            event_type="chat.file_shared",
            title="Files were sent to chat",
            body=notification_body,
            defer_push_notifications=defer_push_notifications,
            mentioned_user_ids=mentioned_user_ids,
        )

    def create_upload_session(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        files: list[dict[str, Any]],
        body: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._upload_orchestrator.create_upload_session(current_user_id=current_user_id, conversation_id=conversation_id, files=files, body=body, reply_to_message_id=reply_to_message_id)
    def get_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._upload_orchestrator.get_upload_session(current_user_id=current_user_id, session_id=session_id)
    def upload_session_chunk(
        self,
        *,
        current_user_id: int,
        session_id: str,
        file_id: str,
        chunk_index: int,
        offset: int,
        payload: bytes,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._upload_orchestrator.upload_session_chunk(
            current_user_id=current_user_id,
            session_id=session_id,
            file_id=file_id,
            chunk_index=chunk_index,
            offset=offset,
            payload=payload,
        )

    def complete_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
        defer_push_notifications: bool = False,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._upload_orchestrator.complete_upload_session(current_user_id=current_user_id, session_id=session_id, defer_push_notifications=defer_push_notifications)
    def cancel_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
    ) -> dict[str, Any]:
        self._ensure_available()
        return self._upload_orchestrator.cancel_upload_session(current_user_id=current_user_id, session_id=session_id)
    def get_attachment_for_download(
        self,
        *,
        current_user_id: int,
        message_id: str,
        attachment_id: str,
        variant: Optional[str] = None,
    ) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        normalized_attachment_id = _normalize_text(attachment_id)
        normalized_variant = _normalize_text(variant).lower()
        if not normalized_message_id or not normalized_attachment_id:
            raise ValueError("message_id and attachment_id are required")

        with chat_session() as session:
            attachment = session.get(ChatMessageAttachment, normalized_attachment_id)
            if attachment is None or attachment.message_id != normalized_message_id:
                raise LookupError("Attachment not found")
            message = session.get(ChatMessage, attachment.message_id)
            if message is None:
                raise LookupError("Message not found")
            self._require_membership(
                session=session,
                conversation_id=message.conversation_id,
                current_user_id=int(current_user_id),
            )
            file_path = self._resolve_attachment_path(
                conversation_id=message.conversation_id,
                storage_name=attachment.storage_name,
            )
            if not file_path.exists() or not file_path.is_file():
                raise LookupError("Attachment file not found")
            file_path = self._repair_gzipped_image_attachment_if_needed(
                session=session,
                conversation_id=message.conversation_id,
                attachment=attachment,
                file_path=file_path,
            )
            try:
                if normalized_variant in {"thumb", "preview"} and _normalize_text(attachment.mime_type).lower().startswith("image/"):
                    return self._ensure_image_variant(
                        conversation_id=message.conversation_id,
                        attachment=attachment,
                        source_path=file_path,
                        variant=normalized_variant,
                    )
                if normalized_variant == "poster" and _normalize_text(attachment.mime_type).lower().startswith("video/"):
                    return self._ensure_video_poster_variant(
                        conversation_id=message.conversation_id,
                        attachment=attachment,
                        source_path=file_path,
                    )
            except (OSError, ValueError, UnidentifiedImageError):
                logger.exception(
                    "chat.media_variant_failed attachment_id=%s variant=%s conversation_id=%s",
                    attachment.id,
                    normalized_variant or "-",
                    message.conversation_id,
                )
            return {
                "path": str(file_path),
                "file_name": attachment.file_name,
                "mime_type": _normalize_text(attachment.mime_type) or "application/octet-stream",
            }

    def _read_attachment_content(
        self,
        *,
        current_user_id: int,
        message_id: str,
        attachment_id: str,
    ) -> tuple[str, str, bytes]:
        meta = self.get_attachment_for_download(
            current_user_id=int(current_user_id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
        file_path = Path(str(meta.get("path") or ""))
        if not file_path.exists() or not file_path.is_file():
            raise LookupError("Attachment file not found")
        return (
            str(meta.get("file_name") or "attachment.bin"),
            _normalize_text(meta.get("mime_type")) or "application/octet-stream",
            file_path.read_bytes(),
        )

    def get_attachment_preview(
        self,
        *,
        current_user_id: int,
        message_id: str,
        attachment_id: str,
    ) -> dict:
        from backend.services.mail_attachment_preview_service import (
            MailAttachmentPreviewError,
            build_office_preview_artifact,
            build_preview_metadata,
            classify_office_source,
        )

        filename, content_type, content = self._read_attachment_content(
            current_user_id=int(current_user_id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
        if not classify_office_source(filename=filename, content_type=content_type):
            raise ValueError("Attachment type is not supported for Office preview.")
        try:
            artifact = build_office_preview_artifact(
                filename=filename,
                content_type=content_type,
                content=content,
            )
        except MailAttachmentPreviewError as exc:
            raise ValueError(str(exc)) from exc
        preview_pdf_path = (
            f"/api/v1/chat/messages/{message_id}/attachments/{attachment_id}/preview/pdf"
        )
        return build_preview_metadata(
            filename=filename,
            content_type=content_type,
            artifact=artifact,
            preview_pdf_path=preview_pdf_path,
        )

    def download_attachment_preview_pdf(
        self,
        *,
        current_user_id: int,
        message_id: str,
        attachment_id: str,
    ) -> tuple[str, bytes]:
        from backend.services.mail_attachment_preview_service import (
            MailAttachmentPreviewError,
            build_office_preview_artifact,
            classify_office_source,
        )

        filename, content_type, content = self._read_attachment_content(
            current_user_id=int(current_user_id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
        if not classify_office_source(filename=filename, content_type=content_type):
            raise ValueError("Attachment type is not supported for Office preview.")
        try:
            artifact = build_office_preview_artifact(
                filename=filename,
                content_type=content_type,
                content=content,
            )
        except MailAttachmentPreviewError as exc:
            raise ValueError(str(exc)) from exc
        return artifact.pdf_filename, artifact.pdf_bytes

    def create_direct_conversation(self, *, current_user_id: int, peer_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.create_direct_conversation(current_user_id=current_user_id, peer_user_id=peer_user_id)

    def get_or_create_notes_conversation(self, *, current_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.get_or_create_notes_conversation(current_user_id=current_user_id)

    def create_group_conversation(self, *, current_user_id: int, title: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        return self._group_service.create_group_conversation(current_user_id=current_user_id, title=title, member_user_ids=member_user_ids)

    def add_group_members(self, *, current_user_id: int, conversation_id: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        return self._group_service.add_group_members(current_user_id=current_user_id, conversation_id=conversation_id, member_user_ids=member_user_ids)

    def remove_group_member(self, *, current_user_id: int, conversation_id: str, target_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.remove_group_member(current_user_id=current_user_id, conversation_id=conversation_id, target_user_id=target_user_id)

    def update_group_member_role(self, *, current_user_id: int, conversation_id: str, target_user_id: int, member_role: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_member_role(
            current_user_id=current_user_id,
            conversation_id=conversation_id,
            target_user_id=target_user_id,
            member_role=member_role,
        )

    def transfer_group_ownership(self, *, current_user_id: int, conversation_id: str, owner_user_id: int) -> dict:
        self._ensure_available()
        return self._group_service.transfer_group_ownership(current_user_id=current_user_id, conversation_id=conversation_id, owner_user_id=owner_user_id)

    def leave_group(self, *, current_user_id: int, conversation_id: str) -> dict:
        self._ensure_available()
        return self._group_service.leave_group(current_user_id=current_user_id, conversation_id=conversation_id)

    def update_group_profile(self, *, current_user_id: int, conversation_id: str, title: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_profile(current_user_id=current_user_id, conversation_id=conversation_id, title=title)

    def update_group_avatar(self, *, current_user_id: int, conversation_id: str, avatar_url: str) -> dict:
        self._ensure_available()
        return self._group_service.update_group_avatar(current_user_id=current_user_id, conversation_id=conversation_id, avatar_url=avatar_url)

    def get_group_avatar_file_path(self, *, current_user_id: int, filename: str) -> Path:
        self._ensure_available()
        return self._group_service.get_group_avatar_file_path(current_user_id=current_user_id, filename=filename)

    def send_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: str,
        body_format: str = "plain",
        client_message_id: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
        defer_push_notifications: bool = False,
    ) -> dict:
        self._ensure_available()
        normalized_body = _normalize_text(body)
        normalized_body_format = _normalize_body_format(body_format)
        normalized_client_message_id = _normalize_text(client_message_id) or None
        if not normalized_body:
            raise ValueError("Message body is required")

        member_user_ids: list[int] = []
        send_started_at = time.perf_counter()
        stage_metrics: dict[str, float] = {}
        message_id = ""
        notification_stats: dict[str, Any] = {}
        persisted = self._text_message_persistence.persist_text_message(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
            body=normalized_body,
            body_format=normalized_body_format,
            client_message_id=normalized_client_message_id,
            reply_to_message_id=reply_to_message_id,
        )
        payload = persisted.payload
        message_id = persisted.message_id
        member_user_ids = persisted.member_user_ids
        dedup_hit = persisted.dedup_hit
        stage_metrics.update(persisted.stage_metrics)

        stage_started_at = time.perf_counter()
        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("conversation_id")),
            user_ids=member_user_ids,
        )
        stage_metrics["invalidate_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

        if not dedup_hit:
            stage_started_at = time.perf_counter()
            mentioned_user_ids = self._resolve_mentioned_member_user_ids(
                member_user_ids=member_user_ids,
                sender_user_id=int(current_user_id),
                body=normalized_body,
            )
            notification_stats = self._create_chat_notifications(
                sender_user_id=int(current_user_id),
                conversation_id=_normalize_text(payload.get("conversation_id")),
                message_id=_normalize_text(payload.get("id")),
                event_type="chat.message_received",
                title="Новое сообщение в чате",
                body=_truncate_text(normalized_body),
                defer_push_notifications=defer_push_notifications,
                mentioned_user_ids=mentioned_user_ids,
            )
            stage_metrics["notifications_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
        else:
            stage_metrics["notifications_ms"] = 0.0

        _log_chat_service_timing(
            "send_message",
            send_started_at,
            current_user_id=int(current_user_id),
            conversation_id=_normalize_text(payload.get("conversation_id")) or conversation_id,
            message_id=message_id or _normalize_text(payload.get("id")) or None,
            member_count=len(member_user_ids),
            body_len=len(normalized_body),
            client_message_id=normalized_client_message_id or None,
            dedup_hit=int(dedup_hit),
            has_reply=int(bool(_normalize_text(reply_to_message_id))),
            membership_ms=f"{stage_metrics.get('membership_ms', 0.0):.1f}",
            prepare_write_ms=f"{stage_metrics.get('prepare_write_ms', 0.0):.1f}",
            flush_ms=f"{stage_metrics.get('flush_ms', 0.0):.1f}",
            serialize_ms=f"{stage_metrics.get('serialize_ms', 0.0):.1f}",
            invalidate_ms=f"{stage_metrics.get('invalidate_ms', 0.0):.1f}",
            notifications_ms=f"{stage_metrics.get('notifications_ms', 0.0):.1f}",
            notification_recipients=notification_stats.get("recipient_count"),
            notification_hub_ms=notification_stats.get("hub_notifications_ms"),
            notification_push_ms=notification_stats.get("push_notifications_ms"),
        )
        return payload

    def forward_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        source_message_id: str,
        body: Optional[str] = None,
        body_format: str = "plain",
        reply_to_message_id: Optional[str] = None,
        defer_push_notifications: bool = False,
    ) -> dict[str, Any]:
        self._ensure_available()
        normalized_source_message_id = _normalize_text(source_message_id)
        if not normalized_source_message_id:
            raise ValueError("source_message_id is required")

        written_paths: list[Path] = []
        payload: dict[str, Any] | None = None
        source_kind = "text"
        source_body = ""
        source_attachments: list[ChatMessageAttachment] = []
        source_task_preview: dict | None = None
        task_id: str | None = None

        try:
            source_snapshot, prepared_attachments, written_paths, materialized = (
                self._forward_materializer.materialize_forward(
                    current_user_id=int(current_user_id),
                    conversation_id=conversation_id,
                    source_message_id=normalized_source_message_id,
                    reply_to_message_id=reply_to_message_id,
                )
            )
            source_kind = str(materialized.get("source_kind") or "text")
            source_body = _normalize_text(materialized.get("source_body"))
            source_attachments = list(materialized.get("source_attachments") or [])
            source_task_preview = materialized.get("source_task_preview")
            task_id = materialized.get("task_id")

            def _validate_forward_member_access(member_user_ids: list[int]) -> None:
                if source_kind != "task_share" or not task_id:
                    return
                if not self._task_is_shareable_to_members(task_id=task_id, member_ids=member_user_ids):
                    raise PermissionError("Task is not available to all chat participants")

            persisted = self._forward_message_persistence.persist_forward_message(
                current_user_id=int(current_user_id),
                conversation_id=conversation_id,
                source=source_snapshot,
                prepared_attachments=prepared_attachments,
                reply_to_message_id=reply_to_message_id,
                validate_member_user_ids=_validate_forward_member_access,
            )
            payload = persisted.payload
        except Exception:
            for path in written_paths:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
            raise

        if payload is None:
            raise ValueError("Forward payload is missing")

        preview_body = source_body
        if source_kind == "task_share":
            if not preview_body:
                preview_body = _normalize_text((source_task_preview or {}).get("title")) or "Поделились задачей"
        elif source_kind == "file" and not preview_body:
            if len(source_attachments) == 1:
                preview_body = _normalize_text(getattr(source_attachments[0], "file_name", None)) or "Файл"
            elif len(source_attachments) > 1:
                preview_body = f"Файлы: {len(source_attachments)}"
            else:
                preview_body = "Файлы"

        member_user_ids = self.get_conversation_member_ids(
            conversation_id=_normalize_text(payload.get("conversation_id")),
        )
        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("conversation_id")),
            user_ids=member_user_ids,
        )
        notification_stats = self._create_chat_notifications(
            sender_user_id=int(current_user_id),
            conversation_id=_normalize_text(payload.get("conversation_id")),
            message_id=_normalize_text(payload.get("id")),
            event_type="chat.message_forwarded",
            title="Пересланное сообщение в чате",
            body=_truncate_text(preview_body or "Откройте чат, чтобы посмотреть пересланное сообщение."),
            defer_push_notifications=defer_push_notifications,
        )
        return payload

    def update_conversation_settings(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        is_pinned: Optional[bool] = None,
        is_muted: Optional[bool] = None,
        is_archived: Optional[bool] = None,
    ) -> dict:
        self._ensure_available()
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            state = self._get_or_create_conversation_state(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
            )
            state.updated_at = _utc_now()
            if is_pinned is not None:
                state.is_pinned = bool(is_pinned)
            if is_muted is not None:
                state.is_muted = bool(is_muted)
            if is_archived is not None:
                state.is_archived = bool(is_archived)
            session.flush()
            payload = self._build_conversation_payload(session, conversation, int(current_user_id))
        self._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations")
        return payload

    def delete_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_id: str,
    ) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        system_message_id: str | None = None
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            message = session.get(ChatMessage, normalized_message_id)
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")
            if self._normalize_message_kind(getattr(message, "kind", "text")) == "system":
                raise ValueError("System messages cannot be deleted")

            is_group = _normalize_text(conversation.kind) == "group"
            actor_member = self._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=int(current_user_id),
            ) if is_group else None
            actor_role = _normalize_member_role(actor_member.member_role) if actor_member else "member"
            is_own_message = int(getattr(message, "sender_user_id", 0) or 0) == int(current_user_id)
            if is_group:
                if not is_own_message and actor_role not in CHAT_GROUP_MANAGER_ROLES:
                    raise PermissionError("Message delete access denied")
            elif not is_own_message:
                raise PermissionError("Message delete access denied")

            now = _utc_now()
            if not bool(getattr(message, "is_deleted", False)):
                message.is_deleted = True
                message.deleted_at = now
                message.deleted_by_user_id = int(current_user_id)
                message.deleted_reason = "self" if is_own_message else "moderated"

                if is_group:
                    actor = self._require_active_user(int(current_user_id))
                    member_user_ids = self._conversation_member_ids(session, conversation.id)
                    system_message = self._append_system_message(
                        session=session,
                        conversation=conversation,
                        actor_user_id=int(current_user_id),
                        body=f"{_display_user_name(actor)} удалил(а) сообщение",
                        member_user_ids=member_user_ids,
                        now=now,
                    )
                    system_message_id = system_message.id
                    affected_user_ids.update(member_user_ids)
                else:
                    member_user_ids = self._conversation_member_ids(session, conversation.id)
                    affected_user_ids.update(member_user_ids)
            else:
                member_user_ids = self._conversation_member_ids(session, conversation.id)
                affected_user_ids.update(member_user_ids)

            session.flush()
            payload = self._build_message_payload_for_members(
                session=session,
                conversation=conversation,
                message=message,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
            )

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        if system_message_id:
            payload["_system_message_id"] = system_message_id
        return payload

    def edit_message(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        message_id: str,
        body: str,
        body_format: str = "plain",
    ) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        normalized_body = _normalize_text(body)
        normalized_body_format = _normalize_body_format(body_format)
        if not normalized_message_id:
            raise ValueError("message_id is required")
        if not normalized_body:
            raise ValueError("Message body is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            message = session.get(ChatMessage, normalized_message_id)
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")
            if self._normalize_message_kind(getattr(message, "kind", "text")) != "text":
                raise ValueError("Only text messages can be edited")
            if bool(getattr(message, "is_deleted", False)):
                raise ValueError("Deleted messages cannot be edited")
            if int(getattr(message, "sender_user_id", 0) or 0) != int(current_user_id):
                raise PermissionError("Message edit access denied")

            member_user_ids = self._conversation_member_ids(session, conversation.id)
            affected_user_ids.update(member_user_ids)
            now = _utc_now()
            message.body = normalized_body
            message.body_format = normalized_body_format
            message.edited_at = now
            conversation.updated_at = now
            session.flush()
            payload = self._build_message_payload_for_members(
                session=session,
                conversation=conversation,
                message=message,
                current_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
            )

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def mark_read(self, *, current_user_id: int, conversation_id: str, message_id: str) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        member_user_ids: list[int] = []
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            message = session.get(ChatMessage, normalized_message_id)
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")

            now = _utc_now()
            state = self._get_or_create_conversation_state(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
            )
            current_last_read_seq = int(getattr(state, "last_read_seq", 0) or 0)
            target_seq = int(getattr(message, "conversation_seq", 0) or 0)
            next_last_read_seq = max(current_last_read_seq, target_seq)
            if target_seq >= current_last_read_seq:
                state.last_read_message_id = message.id
                state.last_read_at = message.created_at
            state.last_read_seq = next_last_read_seq
            state.unread_count = max(0, int(getattr(conversation, "last_message_seq", 0) or 0) - next_last_read_seq)
            state.opened_at = now
            state.updated_at = now

            existing_read = session.execute(
                select(ChatMessageRead).where(
                    ChatMessageRead.conversation_id == conversation.id,
                    ChatMessageRead.user_id == int(current_user_id),
                    ChatMessageRead.message_id == message.id,
                )
            ).scalar_one_or_none()
            if existing_read is None:
                session.add(
                    ChatMessageRead(
                        conversation_id=conversation.id,
                        user_id=int(current_user_id),
                        message_id=message.id,
                        read_at=now,
                    )
                )
            session.flush()
            payload = {"conversation_id": conversation.id, "message_id": message.id, "read_at": _iso(now)}

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("conversation_id")),
            user_ids=member_user_ids,
        )
        try:
            hub_service.mark_chat_notifications_read(
                conversation_id=_normalize_text(payload.get("conversation_id")),
                user_id=int(current_user_id),
            )
        except Exception:
            logger.warning(
                "chat.mark_read: failed to clear hub notifications conversation_id=%s user_id=%s",
                _normalize_text(payload.get("conversation_id")),
                int(current_user_id),
                exc_info=True,
            )
        return payload

    def _build_conversation_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        return self._serialization._build_conversation_payload(session, conversation, current_user_id, users_override=users_override)
    def _build_conversation_summary_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        return self._serialization._build_conversation_summary_payload(session, conversation, current_user_id, users_override=users_override)
    def _build_conversation_detail_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        return self._serialization._build_conversation_detail_payload(session, conversation, current_user_id, users_override=users_override)
    def _serialize_conversation_members(
        self,
        *,
        members: list[ChatMember],
        users_by_id: dict[int, dict],
    ) -> list[dict]:
        return self._serialization._serialize_conversation_members(members=members, users_by_id=users_by_id)
    def _serialize_conversation(
        self,
        *,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        users_by_id: dict[int, dict],
        members: list[ChatMember],
        state: Optional[ChatConversationUserState],
        last_message: Optional[ChatMessage],
        unread_count: Optional[int] = None,
        last_message_attachments: Optional[list[ChatMessageAttachment]] = None,
        task_exists_map: Optional[dict[str, bool]] = None,
        task_payloads_by_id: Optional[dict[str, dict]] = None,
        reads_by_message_id: Optional[dict[str, list]] = None,
        states_by_user_id: Optional[dict[int, ChatConversationUserState]] = None,
    ) -> dict:
        return self._serialization._serialize_conversation(
            session=session,
            conversation=conversation,
            current_user_id=current_user_id,
            users_by_id=users_by_id,
            members=members,
            state=state,
            last_message=last_message,
            unread_count=unread_count,
            last_message_attachments=last_message_attachments,
            task_exists_map=task_exists_map,
            task_payloads_by_id=task_payloads_by_id,
            reads_by_message_id=reads_by_message_id,
            states_by_user_id=states_by_user_id,
        )
    def _collect_message_payload_user_ids(
        self,
        *,
        session,
        message: ChatMessage,
        current_user_id: int,
    ) -> list[int]:
        return self._serialization._collect_message_payload_user_ids(session=session, message=message, current_user_id=current_user_id)
    def _serialize_message(
        self,
        *,
        conversation_kind: str = "direct",
        message: ChatMessage,
        current_user_id: int,
        users_by_id: dict[int, dict],
        member_ids: Optional[list[int]] = None,
        states_by_user_id: Optional[dict[int, ChatConversationUserState]] = None,
        reads_by_message_id: Optional[dict[str, list[ChatMessageRead]]] = None,
        reply_previews: Optional[dict[str, dict]] = None,
        forward_previews: Optional[dict[str, dict]] = None,
        attachments: Optional[list[dict] | list[ChatMessageAttachment]] = None,
        reactions_by_message_id: Optional[dict[str, list[dict]]] = None,
        action_cards_by_message_id: Optional[dict[str, dict]] = None,
    ) -> dict:
        return self._serialization._serialize_message(conversation_kind=conversation_kind, message=message, current_user_id=current_user_id, users_by_id=users_by_id, member_ids=member_ids, states_by_user_id=states_by_user_id, reads_by_message_id=reads_by_message_id, reply_previews=reply_previews, forward_previews=forward_previews, attachments=attachments, reactions_by_message_id=reactions_by_message_id, action_cards_by_message_id=action_cards_by_message_id)
    def _batch_action_cards_for_messages(self, *, session, message_ids: list[str]) -> dict[str, dict]:
        from backend.ai_chat.action_cards import get_action_cards_for_messages

        normalized_ids = [
            _normalize_text(message_id)
            for message_id in list(message_ids or [])
            if _normalize_text(message_id)
        ]
        if not normalized_ids:
            return {}
        return get_action_cards_for_messages(normalized_ids)

    def _get_message_action_card(self, *, message_id: str) -> dict | None:
        return self._serialization._get_message_action_card(message_id=message_id)
    def _build_conversation_message_preview(
        self,
        *,
        session,
        last_message: Optional[ChatMessage],
        current_user_id: int,
        users_by_id: dict[int, dict],
        conversation_kind: str,
        attachments: Optional[list[ChatMessageAttachment]] = None,
    ) -> str:
        return self._serialization._build_conversation_message_preview(session=session, last_message=last_message, current_user_id=current_user_id, users_by_id=users_by_id, conversation_kind=conversation_kind, attachments=attachments)
    def _build_reply_previews(
        self,
        *,
        session,
        reply_to_message_ids: list[object],
        users_by_id: dict[int, dict],
    ) -> dict[str, dict]:
        return self._serialization._build_reply_previews(session=session, reply_to_message_ids=reply_to_message_ids, users_by_id=users_by_id)
    def _build_forward_previews(
        self,
        *,
        session,
        forward_from_message_ids: list[object],
        users_by_id: Optional[dict[int, dict]] = None,
    ) -> dict[str, dict]:
        return self._serialization._build_forward_previews(session=session, forward_from_message_ids=forward_from_message_ids, users_by_id=users_by_id)
    def _reply_preview_payload(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> dict:
        return self._message_reference_preview_payload(
            message=message,
            attachments=attachments,
            users_by_id=users_by_id,
            sender_fallback={},
        )

    def _forward_preview_payload(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> dict:
        return self._message_reference_preview_payload(
            message=message,
            attachments=attachments,
            users_by_id=users_by_id,
            sender_fallback={
                "id": int(message.sender_user_id),
                "username": f"user-{message.sender_user_id}",
                "full_name": None,
            },
        )

    def _message_reference_preview_payload(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
        sender_fallback: dict,
    ) -> dict:
        sender = users_by_id.get(int(message.sender_user_id)) or sender_fallback
        sender_name = self._get_short_user_name(sender) or f"user-{message.sender_user_id}"
        message_kind = self._normalize_message_kind(getattr(message, "kind", "text"))
        is_deleted = bool(getattr(message, "is_deleted", False))
        body = (
            CHAT_DELETED_MESSAGE_BODY
            if is_deleted
            else _truncate_text(_strip_markdown_preview(getattr(message, "body", "")), limit=120)
        )
        task_title = None
        attachments_count = 0 if is_deleted else len(list(attachments or []))
        if is_deleted:
            task_title = None
        elif message_kind == "task_share":
            task_preview = self._deserialize_task_preview(getattr(message, "task_preview_json", None))
            task_title = _normalize_text((task_preview or {}).get("title")) or None
            body = task_title or "Карточка задачи"
        elif message_kind == "file" and not body:
            if attachments_count == 1:
                body = _normalize_text(attachments[0].file_name) or "Файл"
            elif attachments_count > 1:
                body = f"Файлы: {attachments_count}"
            else:
                body = "Файлы"
        return {
            "id": message.id,
            "sender_name": sender_name,
            "kind": message_kind,
            "body": body,
            "task_title": task_title,
            "attachments_count": attachments_count,
        }

    def _build_message_search_haystack(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> str:
        return self._serialization._build_message_search_haystack(message=message, attachments=attachments, users_by_id=users_by_id)
    def _resolve_reply_message(
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

    def _get_or_create_conversation_state(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
    ) -> ChatConversationUserState:
        return _get_or_create_conversation_state_impl(
            session=session,
            conversation_id=conversation_id,
            current_user_id=current_user_id,
        )

    @staticmethod
    def _get_short_user_name(user_payload: Optional[dict]) -> str:
        full_name = _normalize_text((user_payload or {}).get("full_name"))
        if full_name:
            return full_name.split()[0]
        return _normalize_text((user_payload or {}).get("username"))

    def _count_unread_messages(self, *, session, conversation_id: str, current_user_id: int, last_read_at: Optional[datetime]) -> int:
        query = select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.sender_user_id != int(current_user_id),
        )
        if last_read_at is not None:
            query = query.where(ChatMessage.created_at > last_read_at)
        return int(session.execute(query).scalar_one() or 0)

    def _lock_conversation_for_write(self, *, session, conversation_id: str) -> ChatConversation:
        return self._membership._lock_conversation_for_write(session=session, conversation_id=conversation_id)

    def _require_membership(self, *, session, conversation_id: str, current_user_id: int) -> ChatConversation:
        return self._membership._require_membership(session=session, conversation_id=conversation_id, current_user_id=current_user_id)

    def _get_active_membership(self, *, session, conversation_id: str, user_id: int) -> ChatMember | None:
        return self._membership._get_active_membership(session=session, conversation_id=conversation_id, user_id=user_id)

    def _require_group_membership(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_membership(session=session, conversation_id=conversation_id, current_user_id=current_user_id)

    def _require_group_manager(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_manager(session=session, conversation_id=conversation_id, current_user_id=current_user_id)

    def _require_group_owner(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        return self._membership._require_group_owner(session=session, conversation_id=conversation_id, current_user_id=current_user_id)

    def _append_system_message(
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

    def _message_before_anchor_condition(self, *, anchor: ChatMessage):
        anchor_seq = int(getattr(anchor, "conversation_seq", 0) or 0)
        if anchor_seq > 0:
            return ChatMessage.conversation_seq < anchor_seq
        return or_(
            ChatMessage.created_at < anchor.created_at,
            and_(
                ChatMessage.created_at == anchor.created_at,
                ChatMessage.id < anchor.id,
            ),
        )

    def _message_after_anchor_condition(self, *, anchor: ChatMessage):
        anchor_seq = int(getattr(anchor, "conversation_seq", 0) or 0)
        if anchor_seq > 0:
            return ChatMessage.conversation_seq > anchor_seq
        return or_(
            ChatMessage.created_at > anchor.created_at,
            and_(
                ChatMessage.created_at == anchor.created_at,
                ChatMessage.id > anchor.id,
            ),
        )

    @staticmethod
    def _message_order_desc():
        return (
            ChatMessage.conversation_seq.desc(),
            ChatMessage.created_at.desc(),
            ChatMessage.id.desc(),
        )

    @staticmethod
    def _message_order_asc():
        return (
            ChatMessage.conversation_seq.asc(),
            ChatMessage.created_at.asc(),
            ChatMessage.id.asc(),
        )

    def _has_message_before(self, *, session, conversation_id: str, anchor: ChatMessage | None) -> bool:
        if anchor is None:
            return False
        row = session.execute(
            select(ChatMessage.id).where(
                ChatMessage.conversation_id == conversation_id,
                self._message_before_anchor_condition(anchor=anchor),
            ).limit(1)
        ).scalar_one_or_none()
        return row is not None

    def _has_message_after(self, *, session, conversation_id: str, anchor: ChatMessage | None) -> bool:
        if anchor is None:
            return False
        row = session.execute(
            select(ChatMessage.id).where(
                ChatMessage.conversation_id == conversation_id,
                self._message_after_anchor_condition(anchor=anchor),
            ).limit(1)
        ).scalar_one_or_none()
        return row is not None

    def _find_first_unread_message(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
        viewer_last_read_message_id: Optional[str],
        viewer_last_read_seq: int = 0,
    ) -> ChatMessage | None:
        normalized_last_read_message_id = _normalize_text(viewer_last_read_message_id)
        anchor = session.get(ChatMessage, normalized_last_read_message_id) if normalized_last_read_message_id else None
        query = (
            select(ChatMessage)
            .where(
                ChatMessage.conversation_id == conversation_id,
                ChatMessage.sender_user_id != int(current_user_id),
            )
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .limit(1)
        )
        normalized_last_read_seq = int(viewer_last_read_seq or 0)
        if normalized_last_read_seq > 0:
            query = query.where(ChatMessage.conversation_seq > normalized_last_read_seq)
            query = query.order_by(ChatMessage.conversation_seq.asc(), ChatMessage.id.asc())
        elif anchor is not None and anchor.conversation_id == conversation_id:
            query = query.where(self._message_after_anchor_condition(anchor=anchor))
        return session.execute(query).scalar_one_or_none()

    def _serialize_thread_messages_payload(
        self,
        *,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        messages: list[ChatMessage],
        has_older: bool,
        has_newer: bool,
        lightweight: bool = False,
    ) -> dict[str, Any]:
        return self._thread_reads._serialize_thread_messages_payload(
            session=session,
            conversation=conversation,
            current_user_id=int(current_user_id),
            messages=messages,
            has_older=has_older,
            has_newer=has_newer,
            lightweight=lightweight,
        )

    def _require_active_user(self, user_id: int) -> dict:
        raw = user_service.get_by_id(int(user_id))
        if not raw:
            raise LookupError("User not found")
        if not bool(raw.get("is_active", True)):
            raise ValueError("User is inactive")
        return user_service.to_public_user(raw)

    def _conversation_member_ids(self, session, conversation_id: str) -> list[int]:
        return self._membership._conversation_member_ids(session, conversation_id)

    @staticmethod
    def _is_admin_user(user: Optional[dict]) -> bool:
        return _normalize_text((user or {}).get("role")).lower() == "admin"

    def _get_hub_task_for_user(self, *, task_id: str, user_id: int) -> Optional[dict]:
        raw_user = user_service.get_by_id(int(user_id)) or {}
        try:
            return hub_service.get_task(
                _normalize_text(task_id),
                user_id=int(user_id),
                is_admin=self._is_admin_user(raw_user),
            )
        except (LookupError, PermissionError):
            return None

    def _batch_hub_task_metadata_for_user(
        self,
        *,
        task_ids: list[str],
        user_id: int,
    ) -> tuple[dict[str, bool], dict[str, dict]]:
        normalized_ids = [_normalize_text(task_id) for task_id in list(task_ids or []) if _normalize_text(task_id)]
        if not normalized_ids:
            return {}, {}
        raw_user = user_service.get_by_id(int(user_id)) or {}
        is_admin = self._is_admin_user(raw_user)
        exists_map = hub_service.tasks_exist_batch(normalized_ids)
        tasks_map = hub_service.get_tasks_for_user_batch(
            normalized_ids,
            user_id=int(user_id),
            is_admin=is_admin,
        )
        return exists_map, tasks_map

    def _authorize_task_share_for_members(
        self,
        *,
        task_id: str,
        current_user_id: int,
        member_user_ids: list[int],
    ) -> TaskShareSnapshot:
        normalized_task_id = _normalize_text(task_id)
        task = self._get_hub_task_for_user(task_id=normalized_task_id, user_id=int(current_user_id))
        if task is None:
            raise LookupError("Task not found")
        if not self._task_is_shareable_to_members(task_id=normalized_task_id, member_ids=member_user_ids):
            raise PermissionError("Task is not available to all chat participants")
        return TaskShareSnapshot(
            task_id=normalized_task_id,
            preview=self._build_task_preview(task),
        )

    def _task_is_shareable_to_members(self, *, task_id: str, member_ids: list[int]) -> bool:
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            return False
        for member_id in list(member_ids or []):
            if self._get_hub_task_for_user(task_id=normalized_task_id, user_id=int(member_id)) is None:
                return False
        return True

    def _build_task_preview(self, task: dict) -> dict:
        return {
            "id": _normalize_text(task.get("id")),
            "title": _normalize_text(task.get("title")) or "Задача",
            "status": _normalize_text(task.get("status")) or "new",
            "priority": _normalize_text(task.get("priority")) or "normal",
            "assignee_full_name": _normalize_text(task.get("assignee_full_name")) or None,
            "assignee_username": _normalize_text(task.get("assignee_username")) or None,
            "due_at": _normalize_text(task.get("due_at")) or None,
            "is_overdue": bool(task.get("is_overdue")),
        }

    @staticmethod
    def _normalize_message_kind(value: object) -> str:
        normalized = _normalize_text(value).lower()
        if normalized == "task_share":
            return "task_share"
        if normalized == "file":
            return "file"
        if normalized == "system":
            return "system"
        return "text"

    def _deserialize_task_preview(self, raw_value: object) -> Optional[dict]:
        text = _normalize_text(raw_value)
        if not text:
            return None
        try:
            payload = json.loads(text)
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        task_id = _normalize_text(payload.get("id"))
        if not task_id:
            return None
        return {
            "id": task_id,
            "title": _normalize_text(payload.get("title")) or "Задача",
            "status": _normalize_text(payload.get("status")) or "new",
            "priority": _normalize_text(payload.get("priority")) or "normal",
            "assignee_full_name": _normalize_text(payload.get("assignee_full_name")) or None,
            "assignee_username": _normalize_text(payload.get("assignee_username")) or None,
            "due_at": _normalize_text(payload.get("due_at")) or None,
            "is_overdue": bool(payload.get("is_overdue")),
        }

    def _prepare_uploads(
        self,
        uploads: list[UploadFile],
        *,
        conversation_id: str,
        files_meta: Optional[list[dict[str, Any]]] = None,
    ) -> list[dict]:
        return self._upload_orchestrator._prepare_uploads(uploads, conversation_id=conversation_id, files_meta=files_meta)
    def _normalize_mime_type(self, raw_value: object, *, file_name: str, media_kind: object = None) -> str:
        value = _normalize_text(raw_value).lower()
        if ";" in value:
            value = value.split(";", 1)[0].strip()
        normalized_media_kind = self._normalize_media_kind(media_kind)
        if normalized_media_kind == "audio":
            return self._normalize_audio_mime_type(mime_type=value, file_name=file_name)
        if value and value != "application/octet-stream":
            return value
        guessed, _ = mimetypes.guess_type(file_name)
        guessed_value = _normalize_text(guessed).lower()
        if ";" in guessed_value:
            guessed_value = guessed_value.split(";", 1)[0].strip()
        return guessed_value or "application/octet-stream"

    def _is_allowed_file_type(self, *, file_name: str, mime_type: str) -> bool:
        suffix = Path(file_name).suffix.lower()
        if suffix in CHAT_ALLOWED_EXTENSIONS:
            return True
        if any(mime_type.startswith(prefix) for prefix in CHAT_ALLOWED_MIME_PREFIXES):
            return True
        return mime_type in CHAT_ALLOWED_MIME_TYPES

    def _list_attachments_by_message(self, *, session, message_ids: list[str]) -> dict[str, list[ChatMessageAttachment]]:
        normalized_ids = [_normalize_text(item) for item in list(message_ids or []) if _normalize_text(item)]
        if not normalized_ids:
            return {}
        attachments = list(
            session.execute(
                select(ChatMessageAttachment)
                .where(ChatMessageAttachment.message_id.in_(normalized_ids))
                .order_by(ChatMessageAttachment.created_at.asc(), ChatMessageAttachment.file_name.asc())
            ).scalars()
        )
        result: dict[str, list[ChatMessageAttachment]] = {}
        for item in attachments:
            result.setdefault(item.message_id, []).append(item)
        return result

    def _build_attachment_variant_url(self, *, message_id: str, attachment_id: str, variant: str) -> str:
        return self._attachment_media.build_variant_url(
            message_id=message_id,
            attachment_id=attachment_id,
            variant=variant,
        )

    def _build_attachment_variant_urls(self, attachment: ChatMessageAttachment) -> dict[str, str]:
        return self._attachment_media.build_variant_urls(attachment)

    def _resolve_attachment_variant_path(self, *, conversation_id: str, attachment_id: str, variant: str) -> Path:
        return self._attachment_media.resolve_variant_path(
            conversation_id=conversation_id,
            attachment_id=attachment_id,
            variant=variant,
        )

    def _ensure_image_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        source_path: Path,
        variant: str,
    ) -> dict[str, str]:
        return self._attachment_media.ensure_image_variant(
            conversation_id=conversation_id,
            attachment=attachment,
            source_path=source_path,
            variant=variant,
        )

    def _ensure_video_poster_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        source_path: Path | None = None,
    ) -> dict[str, str]:
        return self._attachment_media.ensure_video_poster_variant(
            conversation_id=conversation_id,
            attachment=attachment,
            source_path=source_path,
        )

    def _attachment_to_payload(self, attachment: ChatMessageAttachment) -> dict:
        return self._attachment_media.to_payload(attachment)

    @staticmethod
    def _get_attachment_kind(mime_type: object, media_kind: object = None) -> str:
        return ChatAttachmentMedia.get_kind(mime_type, media_kind)

    def _normalize_attachment_kind_filter(self, value: object) -> str:
        return ChatAttachmentMedia.normalize_kind_filter(value)

    def _apply_attachment_kind_filter(self, *, query, kind: str):
        return ChatAttachmentMedia.apply_kind_filter(query=query, kind=kind)

    def _conversation_attachment_to_payload(self, attachment: ChatMessageAttachment, *, kind: Optional[str] = None) -> dict:
        return self._attachment_media.conversation_to_payload(attachment, kind=kind)

    def _resolve_attachment_path(self, *, conversation_id: str, storage_name: str) -> Path:
        return self._attachment_media.resolve_path(
            conversation_id=conversation_id,
            storage_name=storage_name,
        )

    def _repair_gzipped_image_attachment_if_needed(
        self,
        *,
        session,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        file_path: Path,
    ) -> Path:
        return self._attachment_media.repair_gzipped_image_if_needed(
            session=session,
            conversation_id=conversation_id,
            attachment=attachment,
            file_path=file_path,
        )

    def _mark_sender_message_seen(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
        message_id: str,
        conversation_seq: int,
        seen_at: datetime,
    ) -> None:
        return _mark_sender_message_seen_impl(
            session=session,
            conversation_id=conversation_id,
            current_user_id=current_user_id,
            message_id=message_id,
            conversation_seq=conversation_seq,
            seen_at=seen_at,
        )

    def _increment_unread_counters_for_recipients(
        self,
        *,
        session,
        conversation_id: str,
        sender_user_id: int,
        member_user_ids: list[int],
        seen_at: datetime,
    ) -> None:
        return _increment_unread_counters_for_recipients_impl(
            session=session,
            conversation_id=conversation_id,
            sender_user_id=sender_user_id,
            member_user_ids=member_user_ids,
            seen_at=seen_at,
        )

    def _find_existing_client_message(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
        client_message_id: str,
    ) -> ChatMessage | None:
        return _find_existing_client_message_impl(
            session=session,
            conversation_id=conversation_id,
            current_user_id=current_user_id,
            client_message_id=client_message_id,
        )
    def _build_message_payload_for_members(
        self,
        *,
        session,
        conversation: ChatConversation,
        message: ChatMessage,
        current_user_id: int,
        member_user_ids: list[int],
        attachments: Optional[list[dict] | list[ChatMessageAttachment]] = None,
    ) -> dict[str, Any]:
        return self._serialization._build_message_payload_for_members(session=session, conversation=conversation, message=message, current_user_id=current_user_id, member_user_ids=member_user_ids, attachments=attachments)
    def _upsert_chat_push_outbox_job(
        self,
        *,
        session,
        recipient_user_id: int,
        conversation_id: str,
        message_id: str,
        channel: str,
        title: str,
        body: str,
        now: datetime,
        is_mention: bool = False,
    ) -> bool:
        return self._notification_dispatcher.upsert_push_outbox_job(
            session=session,
            recipient_user_id=int(recipient_user_id),
            conversation_id=conversation_id,
            message_id=message_id,
            channel=channel,
            title=title,
            body=body,
            is_mention=bool(is_mention),
            now=now,
        )

    def _create_chat_notifications(
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

    def _get_presence_map(self, *, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        return self._presence_service._get_presence_map(user_ids=user_ids)

    def _build_presence_payload(
        self,
        *,
        is_online: bool,
        last_seen_at: Optional[datetime],
        now: Optional[datetime] = None,
        typing_in_conversation_id: Optional[str] = None,
    ) -> dict:
        payload = self._presence_service._build_presence_payload(
            is_online=is_online,
            last_seen_at=last_seen_at,
            now=now,
        )
        if typing_in_conversation_id is not None:
            payload["typing_in_conversation_id"] = _normalize_text(typing_in_conversation_id) or None
        return payload

    def _build_message_read_receipts(
        self,
        *,
        message: ChatMessage,
        reader_user_ids: list[int],
        states_by_user_id: dict[int, ChatConversationUserState],
        reads_by_user_id: dict[int, ChatMessageRead],
    ) -> list[dict]:
        return self._presence_service._build_message_read_receipts(
            message=message,
            reader_user_ids=reader_user_ids,
            states_by_user_id=states_by_user_id,
            reads_by_user_id=reads_by_user_id,
        )

    def _get_users_map(self, *, presence_map: Optional[dict[int, dict]] = None, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        return self._presence_service._get_users_map(presence_map=presence_map, user_ids=user_ids)

    def _serialize_user(self, item: dict, *, presence_map: Optional[dict[int, dict]] = None) -> dict:
        return self._presence_service._serialize_user(item=item, presence_map=presence_map)

    def _mask_database_url(self, value: object) -> str:
        return self._presence_service._mask_database_url(value=value)

    def list_chat_folders(self, *, current_user_id: int) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.list_chat_folders(current_user_id=current_user_id)

    def create_chat_folder(self, *, current_user_id: int, name: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.create_chat_folder(current_user_id=current_user_id, name=name)

    def update_chat_folder(self, *, current_user_id: int, folder_id: str, name: Optional[str] = None, sort_order: Optional[int] = None) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.update_chat_folder(
            current_user_id=current_user_id,
            folder_id=folder_id,
            name=name,
            sort_order=sort_order,
        )

    def delete_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.delete_chat_folder(current_user_id=current_user_id, folder_id=folder_id)

    def get_chat_folder(self, *, current_user_id: int, folder_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.get_chat_folder(current_user_id=current_user_id, folder_id=folder_id)

    def set_chat_folder_conversations(self, *, current_user_id: int, folder_id: str, conversation_ids: list[str]) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.set_chat_folder_conversations(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_ids=conversation_ids,
        )

    def add_chat_folder_conversation(self, *, current_user_id: int, folder_id: str, conversation_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.add_chat_folder_conversation(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_id=conversation_id,
        )

    def remove_chat_folder_conversation(self, *, current_user_id: int, folder_id: str, conversation_id: str) -> dict[str, Any]:
        self._ensure_available()
        return self._folder_service.remove_chat_folder_conversation(
            current_user_id=current_user_id,
            folder_id=folder_id,
            conversation_id=conversation_id,
        )

    def _ensure_available(self) -> None:
        status = self.initialize_runtime(force=not bool(self._runtime_status and self._runtime_status.available))
        if not status.enabled:
            raise ChatConfigurationError("Chat module is disabled")
        if not status.configured:
            raise ChatConfigurationError("CHAT_DATABASE_URL is not configured")
        if not status.available:
            raise ChatConfigurationError("Chat database is unavailable")


chat_service = ChatService()