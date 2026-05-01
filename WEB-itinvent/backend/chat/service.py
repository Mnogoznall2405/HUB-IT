"""Chat service backed by PostgreSQL and current web-users."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
import gzip
import io
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
from PIL import Image, ImageDraw, ImageOps, UnidentifiedImageError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

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
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatMessageRead,
    ChatPushOutbox,
)
from backend.chat.push_service import chat_push_service
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


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


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


def _direct_key(user_a: int, user_b: int) -> str:
    first, second = sorted((int(user_a), int(user_b)))
    return f"{first}:{second}"


CHAT_MAX_FILES_PER_MESSAGE = 5
CHAT_MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024
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
    ".pdf",
    ".doc", ".docx", ".docm", ".rtf", ".odt",
    ".xls", ".xlsx", ".xlsm", ".ods",
    ".ppt", ".pptx", ".pptm", ".odp",
    ".txt", ".csv", ".tsv", ".log", ".md", ".json", ".xml",
}
CHAT_ALLOWED_MIME_PREFIXES = ("image/", "video/")
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

    def __init__(self) -> None:
        self._runtime_status: Optional[ChatRuntimeStatus] = None
        self._attachments_root = Path(hub_service.data_dir) / "chat_message_attachments"
        self._attachments_root.mkdir(parents=True, exist_ok=True)
        self._upload_sessions_root = Path(hub_service.data_dir) / "chat_upload_sessions"
        self._upload_sessions_root.mkdir(parents=True, exist_ok=True)
        self._cache_lock = RLock()
        self._runtime_cache: dict[str, tuple[datetime, Any]] = {}
        self._upload_session_locks_lock = RLock()
        self._upload_session_locks: dict[str, RLock] = {}
        self._upload_cleanup_task: asyncio.Task | None = None
        self._upload_cleanup_stop_event: asyncio.Event | None = None
        self._last_upload_session_cleanup_at: datetime | None = None

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
        return f"{int(user_id)}::{_normalize_text(bucket)}::{_normalize_text(extra)}"

    def _cache_get(self, *, user_id: int, bucket: str, extra: str = "") -> Any:
        key = self._cache_key(user_id=int(user_id), bucket=bucket, extra=extra)
        with self._cache_lock:
            payload = self._runtime_cache.get(key)
            if not payload:
                return None
            expires_at, value = payload
            if expires_at <= datetime.now(timezone.utc):
                self._runtime_cache.pop(key, None)
                return None
            return value

    def _cache_set(self, *, user_id: int, bucket: str, value: Any, extra: str = "", ttl_sec: int | None = None) -> Any:
        ttl = max(1, int(ttl_sec or self.chat_cache_ttl_sec))
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
        key = self._cache_key(user_id=int(user_id), bucket=bucket, extra=extra)
        with self._cache_lock:
            self._runtime_cache[key] = (expires_at, value)
        return value

    def _invalidate_user_cache(self, *, user_id: int, bucket: str | None = None, extra_prefix: str = "") -> None:
        user_prefix = f"{int(user_id)}::"
        bucket_prefix = f"{user_prefix}{_normalize_text(bucket)}::" if bucket else user_prefix
        normalized_extra_prefix = _normalize_text(extra_prefix)
        with self._cache_lock:
            for key in list(self._runtime_cache.keys()):
                if not key.startswith(bucket_prefix):
                    continue
                if normalized_extra_prefix:
                    extra = key[len(bucket_prefix):]
                    if not extra.startswith(normalized_extra_prefix):
                        continue
                self._runtime_cache.pop(key, None)

    def _invalidate_conversation_views_for_users(self, *, conversation_id: str, user_ids: list[int] | set[int] | tuple[int, ...]) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            return
        for user_id in {int(item) for item in list(user_ids or []) if int(item) > 0}:
            self._invalidate_user_cache(user_id=user_id, bucket="conversations")
            self._invalidate_user_cache(
                user_id=user_id,
                bucket="thread_latest",
                extra_prefix=f"{normalized_conversation_id}|",
            )
            self._invalidate_user_cache(
                user_id=user_id,
                bucket="thread_bootstrap",
                extra_prefix=f"{normalized_conversation_id}|",
            )

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
        status = self.initialize_runtime(force=True)
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
        redis_available = bool(realtime_metrics.get("redis_available"))
        redis_configured = bool(realtime_metrics.get("redis_configured"))
        pubsub_subscribed = bool(realtime_metrics.get("pubsub_subscribed"))
        ai_worker_concurrency = 0
        try:
            ai_worker_concurrency = int(os.getenv("AI_CHAT_WORKER_CONCURRENCY", "2") or "2")
        except Exception:
            ai_worker_concurrency = 2
        realtime_mode = "redis" if (redis_available and pubsub_subscribed) else ("local_fallback" if redis_configured else "local")
        return {
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
        }

    def _get_upload_session_lock(self, session_id: str) -> RLock:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            raise ValueError("session_id is required")
        with self._upload_session_locks_lock:
            lock = self._upload_session_locks.get(normalized_session_id)
            if lock is None:
                lock = RLock()
                self._upload_session_locks[normalized_session_id] = lock
            return lock

    def _release_upload_session_lock(self, session_id: str) -> None:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            return
        with self._upload_session_locks_lock:
            self._upload_session_locks.pop(normalized_session_id, None)

    def _upload_session_dir(self, session_id: str) -> Path:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            raise ValueError("session_id is required")
        session_dir = (self._upload_sessions_root / normalized_session_id).resolve()
        try:
            session_dir.relative_to(self._upload_sessions_root.resolve())
        except ValueError as exc:
            raise ValueError("Invalid upload session path") from exc
        return session_dir

    def _upload_session_manifest_path(self, session_id: str) -> Path:
        return self._upload_session_dir(session_id) / "manifest.json"

    def _upload_session_part_path(self, session_id: str, file_id: str) -> Path:
        return self._upload_session_dir(session_id) / f"{_normalize_text(file_id)}.part"

    def _load_upload_session_manifest(self, session_id: str) -> dict[str, Any]:
        manifest_path = self._upload_session_manifest_path(session_id)
        if not manifest_path.exists() or not manifest_path.is_file():
            raise LookupError("Upload session not found")
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise LookupError("Upload session not found") from exc
        if not isinstance(payload, dict):
            raise LookupError("Upload session not found")
        return payload

    def _write_upload_session_manifest(self, manifest: dict[str, Any]) -> None:
        session_id = _normalize_text(manifest.get("session_id"))
        if not session_id:
            raise ValueError("Upload session manifest is missing session_id")
        session_dir = self._upload_session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = session_dir / "manifest.json"
        temp_path = session_dir / "manifest.json.tmp"
        temp_path.write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temp_path.replace(manifest_path)

    def _delete_upload_session_dir(self, session_id: str) -> None:
        session_dir = self._upload_session_dir(session_id)
        shutil.rmtree(session_dir, ignore_errors=True)
        self._release_upload_session_lock(session_id)

    def _maybe_cleanup_upload_sessions(self, *, force: bool = False) -> None:
        now = _utc_now()
        if not force and self._last_upload_session_cleanup_at is not None:
            elapsed = (now - self._last_upload_session_cleanup_at).total_seconds()
            if elapsed < self.upload_session_cleanup_interval_sec:
                return
        self.cleanup_expired_upload_sessions(force=True, now=now)

    def cleanup_expired_upload_sessions(self, *, force: bool = False, now: datetime | None = None) -> dict[str, int]:
        current_now = now or _utc_now()
        deleted = 0
        if not force and self._last_upload_session_cleanup_at is not None:
            elapsed = (current_now - self._last_upload_session_cleanup_at).total_seconds()
            if elapsed < self.upload_session_cleanup_interval_sec:
                return {"deleted": 0}
        self._upload_sessions_root.mkdir(parents=True, exist_ok=True)
        for session_dir in list(self._upload_sessions_root.iterdir()):
            if not session_dir.is_dir():
                continue
            session_id = _normalize_text(session_dir.name)
            lock = self._get_upload_session_lock(session_id)
            with lock:
                try:
                    manifest = self._load_upload_session_manifest(session_id)
                except LookupError:
                    self._delete_upload_session_dir(session_id)
                    deleted += 1
                    continue
                status = _normalize_text(manifest.get("status")).lower() or "pending"
                expires_at = _parse_dt(manifest.get("expires_at"))
                if status == "pending" and expires_at and expires_at <= current_now:
                    self._delete_upload_session_dir(session_id)
                    deleted += 1
        self._last_upload_session_cleanup_at = current_now
        return {"deleted": deleted}

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
        if _normalize_text(manifest.get("status")).lower() == "completed":
            return
        session_id = _normalize_text(manifest.get("session_id"))
        expires_at = _parse_dt(manifest.get("expires_at"))
        if expires_at is None or expires_at > _utc_now():
            return
        self._delete_upload_session_dir(session_id)
        raise LookupError("Upload session not found")

    def _serialize_upload_session_file(self, file_payload: dict[str, Any]) -> dict[str, Any]:
        received_chunks = sorted({
            int(item)
            for item in list(file_payload.get("received_chunks") or [])
            if isinstance(item, int) or str(item).strip().isdigit()
        })
        return {
            "file_id": _normalize_text(file_payload.get("file_id")),
            "file_name": _normalize_text(file_payload.get("file_name")),
            "mime_type": _normalize_text(file_payload.get("mime_type")) or None,
            "size": int(file_payload.get("size", 0) or 0),
            "original_size": int(file_payload.get("original_size", 0) or 0),
            "transfer_encoding": self._normalize_transfer_encoding(file_payload.get("transfer_encoding")),
            "chunk_count": int(file_payload.get("chunk_count", 0) or 0),
            "received_bytes": int(file_payload.get("received_bytes", 0) or 0),
            "received_chunks": received_chunks,
        }

    def _serialize_upload_session(self, manifest: dict[str, Any]) -> dict[str, Any]:
        return {
            "session_id": _normalize_text(manifest.get("session_id")),
            "chunk_size_bytes": int(manifest.get("chunk_size_bytes", self.upload_session_chunk_size_bytes) or self.upload_session_chunk_size_bytes),
            "expires_at": _normalize_text(manifest.get("expires_at")),
            "status": "completed" if _normalize_text(manifest.get("status")).lower() == "completed" else "pending",
            "message_id": _normalize_text(manifest.get("message_id")) or None,
            "files": [
                self._serialize_upload_session_file(item)
                for item in list(manifest.get("files") or [])
                if isinstance(item, dict)
            ],
        }

    def _find_upload_session_file(self, manifest: dict[str, Any], *, file_id: str) -> dict[str, Any]:
        normalized_file_id = _normalize_text(file_id)
        for item in list(manifest.get("files") or []):
            if _normalize_text(item.get("file_id")) == normalized_file_id:
                return item
        raise LookupError("Upload session file not found")

    def _normalize_transfer_encoding(self, value: object) -> str:
        normalized = _normalize_text(value, "identity").lower()
        if normalized not in CHAT_ALLOWED_TRANSFER_ENCODINGS:
            raise ValueError(f"Unsupported transfer encoding: {normalized or 'unknown'}")
        return normalized

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
        raw_original_size = payload.get("original_size")
        if raw_original_size is None or str(raw_original_size).strip() == "":
            return {
                "transfer_encoding": transfer_encoding,
                "original_size": None,
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
                        raise ValueError("Total upload size exceeds 25 MB")
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
    ) -> dict[str, Any]:
        normalized_file_name = _safe_file_name(file_name)
        normalized_mime_type = self._normalize_mime_type(mime_type, file_name=normalized_file_name)
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
        search = _normalize_text(q).lower()
        page_size = max(1, int(limit))
        users = []
        for item in user_service.list_users():
            user_id = int(item.get("id", 0) or 0)
            if user_id <= 0 or user_id == int(current_user_id):
                continue
            if not bool(item.get("is_active", True)):
                continue
            haystack = " ".join([
                _normalize_text(item.get("username")),
                _normalize_text(item.get("full_name")),
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

    def list_conversations(self, *, current_user_id: int, q: str = "", limit: int = 50) -> list[dict]:
        self._ensure_available()
        search = _normalize_text(q).lower()
        page_size = max(1, min(int(limit), 200))
        if not search:
            cached = self._cache_get(
                user_id=int(current_user_id),
                bucket="conversations",
                extra=str(page_size),
            )
            if cached is not None:
                self._set_request_meta(
                    route="conversations",
                    cache_hit=True,
                    limit=page_size,
                    query=None,
                    items_count=len(list(cached or [])),
                )
                return cached
        with chat_session() as session:
            conversation_ids = list(
                session.execute(
                    select(ChatMember.conversation_id).where(
                        ChatMember.user_id == int(current_user_id),
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            if not conversation_ids:
                if not search:
                    self._cache_set(
                        user_id=int(current_user_id),
                        bucket="conversations",
                        extra=str(page_size),
                        value=[],
                    )
                self._set_request_meta(
                    route="conversations",
                    cache_hit=False,
                    limit=page_size,
                    query=None,
                    items_count=0,
                )
                return []

            conversations = list(
                session.execute(
                    select(ChatConversation).where(
                        ChatConversation.id.in_(conversation_ids),
                        ChatConversation.is_archived.is_(False),
                    )
                ).scalars()
            )
            if not conversations:
                if not search:
                    self._cache_set(
                        user_id=int(current_user_id),
                        bucket="conversations",
                        extra=str(page_size),
                        value=[],
                    )
                self._set_request_meta(
                    route="conversations",
                    cache_hit=False,
                    limit=page_size,
                    query=None,
                    items_count=0,
                )
                return []

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id.in_(conversation_ids),
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id.in_(conversation_ids),
                        ChatConversationUserState.user_id == int(current_user_id),
                    )
                ).scalars()
            )
            last_message_ids = [item.last_message_id for item in conversations if _normalize_text(item.last_message_id)]
            messages = []
            if last_message_ids:
                messages = list(session.execute(select(ChatMessage).where(ChatMessage.id.in_(last_message_ids))).scalars())
            attachments_by_last_message = self._list_attachments_by_message(
                session=session,
                message_ids=last_message_ids,
            ) if last_message_ids else {}

            unread_by_conversation = {
                _normalize_text(item.conversation_id): max(0, int(getattr(item, "unread_count", 0) or 0))
                for item in states
                if _normalize_text(getattr(item, "conversation_id", None))
            }

            participant_ids = {
                int(member.user_id)
                for member in members
                if int(member.user_id) > 0
            }
            presence_map = self._get_presence_map(user_ids=participant_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            members_by_conversation: dict[str, list[ChatMember]] = {}
            for member in members:
                members_by_conversation.setdefault(member.conversation_id, []).append(member)
            states_by_conversation = {item.conversation_id: item for item in states}
            messages_by_id = {item.id: item for item in messages}

            items = []
            for conversation in conversations:
                summary = self._serialize_conversation(
                    session=session,
                    conversation=conversation,
                    current_user_id=int(current_user_id),
                    users_by_id=users_by_id,
                    members=members_by_conversation.get(conversation.id, []),
                    state=states_by_conversation.get(conversation.id),
                    last_message=messages_by_id.get(conversation.last_message_id),
                    unread_count=unread_by_conversation.get(conversation.id, 0),
                    last_message_attachments=attachments_by_last_message.get(
                        _normalize_text(conversation.last_message_id),
                        [],
                    ),
                )
                haystack = " ".join([
                    summary["title"],
                    _normalize_text(summary.get("last_message_preview")),
                ]).lower()
                if search and search not in haystack:
                    continue
                items.append(summary)

            items.sort(
                key=lambda item: (
                    item.get("last_message_at") or item.get("updated_at") or item.get("created_at") or "",
                    item.get("title") or "",
                ),
                reverse=True,
            )
            items.sort(key=lambda item: bool(item.get("is_archived")))
            items.sort(key=lambda item: not bool(item.get("is_pinned")))
            result = items[:page_size]
            if not search:
                self._cache_set(
                    user_id=int(current_user_id),
                    bucket="conversations",
                    extra=str(page_size),
                    value=result,
                )
            self._set_request_meta(
                route="conversations",
                cache_hit=False,
                limit=page_size,
                query=search or None,
                items_count=len(result),
            )
            return result

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
        payload = self.get_unread_summaries(user_ids=[int(current_user_id)]).get(int(current_user_id))
        if isinstance(payload, dict):
            return payload
        return {
            "messages_unread_total": 0,
            "conversations_unread": 0,
        }

    def get_unread_summaries(
        self,
        *,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        self._ensure_available()
        normalized_user_ids = sorted({
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        })
        if not normalized_user_ids:
            return {}

        result = {
            int(user_id): {
                "messages_unread_total": 0,
                "conversations_unread": 0,
            }
            for user_id in normalized_user_ids
        }
        with chat_session() as session:
            unread_rows = session.execute(
                select(
                    ChatConversationUserState.user_id,
                    func.coalesce(func.sum(ChatConversationUserState.unread_count), 0),
                    func.count(ChatConversationUserState.conversation_id),
                ).where(
                    ChatConversationUserState.user_id.in_(normalized_user_ids),
                    ChatConversationUserState.unread_count > 0,
                    ChatConversationUserState.is_archived.is_(False),
                ).group_by(ChatConversationUserState.user_id)
            ).all()
        for user_id, messages_unread_total, conversations_unread in unread_rows:
            normalized_user_id = int(user_id or 0)
            if normalized_user_id <= 0:
                continue
            result[normalized_user_id] = {
                "messages_unread_total": max(0, int(messages_unread_total or 0)),
                "conversations_unread": max(0, int(conversations_unread or 0)),
            }
        return result

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
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            return self._build_conversation_detail_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
            )

    def get_conversation_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
    ) -> dict:
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
            return self._build_conversation_summary_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
            )

    def get_conversation_summaries_for_users(
        self,
        *,
        conversation_id: str,
        user_ids: list[int] | set[int] | tuple[int, ...],
    ) -> dict[int, dict]:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_user_ids = sorted({
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        })
        if not normalized_conversation_id or not normalized_user_ids:
            return {}

        with chat_session() as session:
            conversation = session.get(ChatConversation, normalized_conversation_id)
            if conversation is None:
                raise LookupError("Conversation not found")
            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [
                int(item.user_id)
                for item in members
                if int(item.user_id) > 0
            ]
            allowed_user_ids = [item for item in normalized_user_ids if item in member_ids]
            if not allowed_user_ids:
                return {}
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(allowed_user_ids),
                    )
                ).scalars()
            )
            states_by_user_id = {int(item.user_id): item for item in states}
            last_message = None
            if _normalize_text(conversation.last_message_id):
                last_message = session.get(ChatMessage, conversation.last_message_id)
            last_message_attachments = self._list_attachments_by_message(
                session=session,
                message_ids=[last_message.id],
            ).get(last_message.id, []) if last_message is not None else []
            presence_map = self._get_presence_map(user_ids=member_ids)
            users_by_id = self._get_users_map(
                presence_map=presence_map,
                user_ids=member_ids,
            )
            return {
                int(user_id): self._serialize_conversation(
                    session=session,
                    conversation=conversation,
                    current_user_id=int(user_id),
                    users_by_id=users_by_id,
                    members=members,
                    state=states_by_user_id.get(int(user_id)),
                    last_message=last_message,
                    unread_count=max(0, int(getattr(states_by_user_id.get(int(user_id)), "unread_count", 0) or 0)),
                    last_message_attachments=last_message_attachments,
                )
                for user_id in allowed_user_ids
            }

    def get_conversation_assets_summary(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        recent_limit: int = 8,
    ) -> dict:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        max_recent = max(1, min(int(recent_limit), 12))

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            attachments = list(
                session.execute(
                    select(ChatMessageAttachment)
                    .where(ChatMessageAttachment.conversation_id == conversation.id)
                    .order_by(ChatMessageAttachment.created_at.desc(), ChatMessageAttachment.id.desc())
                ).scalars()
            )
            shared_tasks_count = int(
                session.execute(
                    select(func.count(ChatMessage.id)).where(
                        ChatMessage.conversation_id == conversation.id,
                        ChatMessage.kind == "task_share",
                    )
                ).scalar_one()
                or 0
            )

            summary = {
                "photos_count": 0,
                "videos_count": 0,
                "files_count": 0,
                "audio_count": 0,
                "shared_tasks_count": shared_tasks_count,
                "recent_photos": [],
                "recent_videos": [],
                "recent_files": [],
                "recent_audio": [],
            }

            for attachment in attachments:
                kind = self._get_attachment_kind(attachment.mime_type)
                payload = self._conversation_attachment_to_payload(attachment, kind=kind)
                if kind == "image":
                    summary["photos_count"] += 1
                    if len(summary["recent_photos"]) < max_recent:
                        summary["recent_photos"].append(payload)
                elif kind == "video":
                    summary["videos_count"] += 1
                    if len(summary["recent_videos"]) < max_recent:
                        summary["recent_videos"].append(payload)
                elif kind == "audio":
                    summary["audio_count"] += 1
                    if len(summary["recent_audio"]) < max_recent:
                        summary["recent_audio"].append(payload)
                else:
                    summary["files_count"] += 1
                    if len(summary["recent_files"]) < max_recent:
                        summary["recent_files"].append(payload)

            return summary

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
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_kind = self._normalize_attachment_kind_filter(kind)
        normalized_before_attachment_id = _normalize_text(before_attachment_id)
        page_size = max(1, min(int(limit), 100))

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )

            query = select(ChatMessageAttachment).where(
                ChatMessageAttachment.conversation_id == conversation.id,
            )
            query = self._apply_attachment_kind_filter(query=query, kind=normalized_kind)

            if normalized_before_attachment_id:
                anchor = session.get(ChatMessageAttachment, normalized_before_attachment_id)
                if anchor is None or anchor.conversation_id != conversation.id:
                    raise LookupError("Attachment cursor not found")
                query = query.where(
                    or_(
                        ChatMessageAttachment.created_at < anchor.created_at,
                        and_(
                            ChatMessageAttachment.created_at == anchor.created_at,
                            ChatMessageAttachment.id < anchor.id,
                        ),
                    )
                )

            rows = list(
                session.execute(
                    query.order_by(ChatMessageAttachment.created_at.desc(), ChatMessageAttachment.id.desc()).limit(page_size + 1)
                ).scalars()
            )
            has_more = len(rows) > page_size
            visible_rows = rows[:page_size]

            return {
                "items": [
                    self._conversation_attachment_to_payload(item, kind=normalized_kind)
                    for item in visible_rows
                ],
                "has_more": has_more,
                "next_before_attachment_id": visible_rows[-1].id if has_more and visible_rows else None,
            }

    def get_message(
        self,
        *,
        current_user_id: int,
        message_id: str,
    ) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")
            conversation = self._require_membership(
                session=session,
                conversation_id=message.conversation_id,
                current_user_id=int(current_user_id),
            )
            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            attachments_by_message = self._list_attachments_by_message(
                session=session,
                message_ids=[message.id],
            )
            reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            for item in read_rows:
                reads_by_message_id.setdefault(item.message_id, []).append(item)
            participant_ids = {int(item) for item in member_ids if int(item) > 0}
            presence_map = self._get_presence_map(user_ids=participant_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            reply_previews = self._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            )
            forward_previews = self._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
            )
            return self._serialize_message(
                conversation_kind=conversation.kind,
                message=message,
                current_user_id=int(current_user_id),
                users_by_id=users_by_id,
                member_ids=member_ids,
                states_by_user_id={int(item.user_id): item for item in states},
                reads_by_message_id=reads_by_message_id,
                reply_previews=reply_previews,
                forward_previews=forward_previews,
                attachments=attachments_by_message.get(message.id, []),
            )

    def get_messages_for_users(
        self,
        *,
        message_id: str,
        user_ids: list[int],
    ) -> dict[int, dict]:
        """Get the same message serialized for multiple users (batch optimization)."""
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")
        if not user_ids:
            return {}

        results: dict[int, dict] = {}

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")

            # Get conversation and verify all users are members
            conversation = session.execute(
                select(ChatConversation).where(ChatConversation.id == message.conversation_id)
            ).scalar_one_or_none()
            if conversation is None:
                raise LookupError("Conversation not found")

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.user_id.in_([int(uid) for uid in user_ids]),
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            valid_member_ids = sorted({
                int(item.user_id)
                for item in members
                if int(item.user_id) > 0
            })
            if not valid_member_ids:
                return {}

            attachments_by_message = self._list_attachments_by_message(
                session=session,
                message_ids=[message.id],
            )
            payload_user_ids = self._collect_message_payload_user_ids(
                session=session,
                message=message,
                current_user_id=int(getattr(message, "sender_user_id", 0) or 0),
            )
            presence_map = self._get_presence_map(user_ids=payload_user_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=payload_user_ids)

            reply_previews = self._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            )
            forward_previews = self._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
            )
            attachments = attachments_by_message.get(message.id, [])

            sender_user_id = int(getattr(message, "sender_user_id", 0) or 0)
            has_sender_view = sender_user_id in valid_member_ids
            recipient_view_user_ids = [
                int(user_id)
                for user_id in valid_member_ids
                if int(user_id) != sender_user_id
            ]

            if has_sender_view:
                states = list(
                    session.execute(
                        select(ChatConversationUserState).where(
                            ChatConversationUserState.conversation_id == conversation.id,
                            ChatConversationUserState.user_id.in_(valid_member_ids),
                        )
                    ).scalars()
                )
                read_rows = list(
                    session.execute(
                        select(ChatMessageRead).where(
                            ChatMessageRead.conversation_id == conversation.id,
                            ChatMessageRead.message_id == message.id,
                            ChatMessageRead.user_id.in_(valid_member_ids),
                        )
                    ).scalars()
                )
                reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
                for item in read_rows:
                    reads_by_message_id.setdefault(item.message_id, []).append(item)
                sender_payload = self._serialize_message(
                    conversation_kind=conversation.kind,
                    message=message,
                    current_user_id=sender_user_id,
                    users_by_id=users_by_id,
                    member_ids=valid_member_ids,
                    states_by_user_id={int(item.user_id): item for item in states},
                    reads_by_message_id=reads_by_message_id,
                    reply_previews=reply_previews,
                    forward_previews=forward_previews,
                    attachments=attachments,
                )
                results[sender_user_id] = sender_payload

            if recipient_view_user_ids:
                recipient_payload = self._serialize_message(
                    conversation_kind=conversation.kind,
                    message=message,
                    current_user_id=int(recipient_view_user_ids[0]),
                    users_by_id=users_by_id,
                    member_ids=valid_member_ids,
                    states_by_user_id={},
                    reads_by_message_id={},
                    reply_previews=reply_previews,
                    forward_previews=forward_previews,
                    attachments=attachments,
                )
                for user_id in recipient_view_user_ids:
                    results[int(user_id)] = recipient_payload

        return results

    def get_presence(self, *, user_id: int) -> dict:
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return self._build_presence_payload(is_online=False, last_seen_at=None)
        return self._get_presence_map(user_ids=[normalized_user_id]).get(
            normalized_user_id,
            self._build_presence_payload(is_online=False, last_seen_at=None),
        )

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
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_before = _normalize_text(before_message_id)
        normalized_after = _normalize_text(after_message_id)
        if normalized_before and normalized_after:
            raise ValueError("before_message_id and after_message_id cannot be used together")
        page_size = max(1, min(int(limit), 200))
        latest_cache_extra = f"{normalized_conversation_id}|{page_size}"

        if normalized_conversation_id and not normalized_before and not normalized_after:
            cached = self._cache_get(
                user_id=int(current_user_id),
                bucket="thread_latest",
                extra=latest_cache_extra,
            )
            if cached is not None:
                self._set_request_meta(
                    route="messages",
                    cache_hit=True,
                    conversation_id=normalized_conversation_id,
                    limit=page_size,
                    direction="latest",
                    before_message_id=None,
                    after_message_id=None,
                    cursor_invalid=bool((cached or {}).get("cursor_invalid")),
                    items_count=len(list((cached or {}).get("items") or [])),
                )
                return cached

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            anchor = None
            direction = "latest"
            query = None
            if normalized_before:
                direction = "before"
                anchor = session.get(ChatMessage, normalized_before)
                if anchor is None or anchor.conversation_id != conversation.id:
                    payload = self._serialize_thread_messages_payload(
                        session=session,
                        conversation=conversation,
                        current_user_id=int(current_user_id),
                        messages=[],
                        has_older=False,
                        has_newer=False,
                    )
                    payload["cursor_invalid"] = True
                    self._set_request_meta(
                        route="messages",
                        cache_hit=False,
                        conversation_id=conversation.id,
                        limit=page_size,
                        direction=direction,
                        before_message_id=normalized_before or None,
                        after_message_id=None,
                        cursor_invalid=True,
                        items_count=0,
                    )
                    return payload
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._message_order_desc())
                    .limit(page_size + 1)
                )
                query = query.where(self._message_before_anchor_condition(anchor=anchor))
            elif normalized_after:
                direction = "after"
                anchor = session.get(ChatMessage, normalized_after)
                if anchor is None or anchor.conversation_id != conversation.id:
                    payload = self._serialize_thread_messages_payload(
                        session=session,
                        conversation=conversation,
                        current_user_id=int(current_user_id),
                        messages=[],
                        has_older=False,
                        has_newer=False,
                    )
                    payload["cursor_invalid"] = True
                    self._set_request_meta(
                        route="messages",
                        cache_hit=False,
                        conversation_id=conversation.id,
                        limit=page_size,
                        direction=direction,
                        before_message_id=None,
                        after_message_id=normalized_after or None,
                        cursor_invalid=True,
                        items_count=0,
                    )
                    return payload
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._message_order_asc())
                    .limit(page_size + 1)
                )
                query = query.where(self._message_after_anchor_condition(anchor=anchor))
            else:
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._message_order_desc())
                    .limit(page_size + 1)
                )

            raw_messages = list(session.execute(query).scalars())
            if direction == "after":
                messages = raw_messages[:page_size]
            else:
                messages = list(reversed(raw_messages[:page_size]))

            has_older = False
            has_newer = False
            if direction == "latest":
                has_older = len(raw_messages) > page_size
            elif direction == "before":
                has_older = len(raw_messages) > page_size
                has_newer = bool(anchor) or self._has_message_after(
                    session=session,
                    conversation_id=conversation.id,
                    anchor=messages[-1] if messages else None,
                )
            else:
                has_newer = len(raw_messages) > page_size
                has_older = bool(anchor) or self._has_message_before(
                    session=session,
                    conversation_id=conversation.id,
                    anchor=messages[0] if messages else None,
                )

            if messages:
                if not has_older:
                    has_older = self._has_message_before(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[0],
                    )
                if not has_newer:
                    has_newer = self._has_message_after(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[-1],
                    )

            payload = self._serialize_thread_messages_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
                messages=messages,
                has_older=has_older,
                has_newer=has_newer,
            )
            if direction == "latest":
                self._cache_set(
                    user_id=int(current_user_id),
                    bucket="thread_latest",
                    extra=latest_cache_extra,
                    value=payload,
                )
            self._set_request_meta(
                route="messages",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                direction=direction,
                before_message_id=normalized_before or None,
                after_message_id=normalized_after or None,
                cursor_invalid=bool(payload.get("cursor_invalid")),
                items_count=len(payload["items"]),
            )
            return payload

    def get_thread_bootstrap(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        focus_message_id: Optional[str] = None,
        limit: int = 40,
    ) -> dict[str, Any]:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_focus_message_id = _normalize_text(focus_message_id)
        page_size = max(1, min(int(limit), 100))
        bootstrap_cache_extra = (
            f"{normalized_conversation_id}|{page_size}|focus:{normalized_focus_message_id}"
            if normalized_focus_message_id
            else f"{normalized_conversation_id}|{page_size}"
        )
        cached = self._cache_get(
            user_id=int(current_user_id),
            bucket="thread_bootstrap",
            extra=bootstrap_cache_extra,
        )
        if cached is not None:
            self._set_request_meta(
                route="thread_bootstrap",
                cache_hit=True,
                conversation_id=normalized_conversation_id,
                limit=page_size,
                items_count=len(list((cached or {}).get("items") or [])),
                initial_anchor_mode=_normalize_text((cached or {}).get("initial_anchor_mode")) or "bottom",
            )
            return cached

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            initial_anchor_mode = "bottom"
            initial_anchor_message_id = None
            messages: list[ChatMessage] = []
            has_older = False
            has_newer = False

            focus_anchor = (
                session.get(ChatMessage, normalized_focus_message_id)
                if normalized_focus_message_id
                else None
            )
            if focus_anchor is not None and focus_anchor.conversation_id == conversation.id:
                initial_anchor_mode = "message"
                initial_anchor_message_id = focus_anchor.id
                older_limit = min(max(0, page_size - 1), max(0, (page_size - 1) // 2))
                newer_limit = max(1, page_size - older_limit)
                older_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(
                            ChatMessage.conversation_id == conversation.id,
                            self._message_before_anchor_condition(anchor=focus_anchor),
                        )
                        .order_by(*self._message_order_desc())
                        .limit(older_limit + 1)
                    ).scalars()
                )
                newer_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(
                            ChatMessage.conversation_id == conversation.id,
                            or_(
                                ChatMessage.id == focus_anchor.id,
                                self._message_after_anchor_condition(anchor=focus_anchor),
                            ),
                        )
                        .order_by(*self._message_order_asc())
                        .limit(newer_limit + 1)
                    ).scalars()
                )
                older_messages = list(reversed(older_raw[:older_limit]))
                newer_messages = newer_raw[:newer_limit]
                messages = [*older_messages, *newer_messages]
                has_older = bool(len(older_raw) > older_limit or (
                    messages and self._has_message_before(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[0],
                    )
                ))
                has_newer = bool(len(newer_raw) > newer_limit or (
                    messages and self._has_message_after(
                        session=session,
                        conversation_id=conversation.id,
                        anchor=messages[-1],
                    )
                ))
            else:
                latest_raw = list(
                    session.execute(
                        select(ChatMessage)
                        .where(ChatMessage.conversation_id == conversation.id)
                        .order_by(*self._message_order_desc())
                        .limit(page_size + 1)
                    ).scalars()
                )
                messages = list(reversed(latest_raw[:page_size]))
                has_older = len(latest_raw) > page_size
                has_newer = False

            payload = self._serialize_thread_messages_payload(
                session=session,
                conversation=conversation,
                current_user_id=int(current_user_id),
                messages=messages,
                has_older=has_older,
                has_newer=has_newer,
            )
            payload["initial_anchor_mode"] = initial_anchor_mode
            payload["initial_anchor_message_id"] = initial_anchor_message_id
            self._cache_set(
                user_id=int(current_user_id),
                bucket="thread_bootstrap",
                extra=bootstrap_cache_extra,
                value=payload,
            )
            self._set_request_meta(
                route="thread_bootstrap",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                items_count=len(payload["items"]),
                initial_anchor_mode=initial_anchor_mode,
            )
            return payload

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
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_query = _normalize_text(q).lower()
        normalized_before = _normalize_text(before_message_id)
        page_size = max(1, min(int(limit), 100))
        if not normalized_query:
            return {"items": [], "has_more": False}

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=normalized_conversation_id,
                current_user_id=int(current_user_id),
            )
            anchor_message = None
            if normalized_before:
                anchor = session.get(ChatMessage, normalized_before)
                if anchor and anchor.conversation_id == conversation.id:
                    anchor_message = anchor

            matched_messages = []

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
            participant_ids = {int(item) for item in member_ids if int(item) > 0}
            presence_map = self._get_presence_map(user_ids=participant_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=participant_ids)
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            states_by_user_id = {int(item.user_id): item for item in states}

            all_reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
            all_reply_previews: dict[str, dict] = {}
            all_forward_previews: dict[str, dict] = {}
            all_attachments_by_message: dict[str, list] = {}

            chunk_size = 200

            while len(matched_messages) <= page_size:
                query = (
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == conversation.id)
                    .order_by(*self._message_order_desc())
                    .limit(chunk_size)
                )
                if anchor_message is not None:
                    query = query.where(self._message_before_anchor_condition(anchor=anchor_message))

                candidates = list(session.execute(query).scalars())
                if not candidates:
                    break

                anchor_message = candidates[-1]

                candidate_ids = [item.id for item in candidates]
                attachments_by_message = self._list_attachments_by_message(
                    session=session,
                    message_ids=candidate_ids,
                )
                all_attachments_by_message.update(attachments_by_message)

                read_rows = list(
                    session.execute(
                        select(ChatMessageRead).where(
                            ChatMessageRead.conversation_id == conversation.id,
                            ChatMessageRead.message_id.in_(candidate_ids),
                            ChatMessageRead.user_id.in_(member_ids),
                        )
                    ).scalars()
                ) if candidate_ids and member_ids else []

                for item in read_rows:
                    all_reads_by_message_id.setdefault(item.message_id, []).append(item)

                reply_previews = self._build_reply_previews(
                    session=session,
                    reply_to_message_ids=[
                        _normalize_text(getattr(item, "reply_to_message_id", None))
                        for item in candidates
                    ],
                    users_by_id=users_by_id,
                )
                all_reply_previews.update(reply_previews)
                forward_previews = self._build_forward_previews(
                    session=session,
                    forward_from_message_ids=[
                        _normalize_text(getattr(item, "forward_from_message_id", None))
                        for item in candidates
                    ],
                )
                all_forward_previews.update(forward_previews)

                for message in candidates:
                    haystack = self._build_message_search_haystack(
                        message=message,
                        attachments=attachments_by_message.get(message.id, []),
                        users_by_id=users_by_id,
                    )
                    if normalized_query in haystack:
                        matched_messages.append(message)
                    if len(matched_messages) >= page_size + 1:
                        break

            has_more = len(matched_messages) > page_size
            matched_messages = matched_messages[:page_size]
            payload = {
                "items": [
                    self._serialize_message(
                        conversation_kind=conversation.kind,
                        message=item,
                        current_user_id=int(current_user_id),
                        users_by_id=users_by_id,
                        member_ids=member_ids,
                        states_by_user_id=states_by_user_id,
                        reads_by_message_id=all_reads_by_message_id,
                        reply_previews=all_reply_previews,
                        forward_previews=all_forward_previews,
                        attachments=all_attachments_by_message.get(item.id, []),
                    )
                    for item in matched_messages
                ],
                "has_more": has_more,
            }
            self._set_request_meta(
                route="search",
                cache_hit=False,
                conversation_id=conversation.id,
                limit=page_size,
                before_message_id=normalized_before or None,
                items_count=len(payload["items"]),
                query=normalized_query or None,
            )
            return payload

    def get_message_reads(self, *, current_user_id: int, message_id: str) -> dict:
        self._ensure_available()
        normalized_message_id = _normalize_text(message_id)
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            message = session.get(ChatMessage, normalized_message_id)
            if message is None:
                raise LookupError("Message not found")

            conversation = self._require_membership(
                session=session,
                conversation_id=message.conversation_id,
                current_user_id=int(current_user_id),
            )
            if int(message.sender_user_id) != int(current_user_id):
                raise PermissionError("Read receipts are available only for your own messages")

            members = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.left_at.is_(None),
                    )
                ).scalars()
            )
            member_ids = [
                int(item.user_id)
                for item in members
                if int(item.user_id) > 0 and int(item.user_id) != int(current_user_id)
            ]
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_ids),
                    )
                ).scalars()
            ) if member_ids else []

            states_by_user_id = {int(item.user_id): item for item in states}
            reads_by_user_id = {int(item.user_id): item for item in read_rows}
            presence_map = self._get_presence_map(user_ids=member_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=member_ids)

            receipts = self._build_message_read_receipts(
                message=message,
                reader_user_ids=member_ids,
                states_by_user_id=states_by_user_id,
                reads_by_user_id=reads_by_user_id,
            )
            items = []
            for receipt in receipts:
                user_payload = users_by_id.get(int(receipt["user_id"]))
                if user_payload is None:
                    continue
                items.append(
                    {
                        "user": user_payload,
                        "read_at": _iso(receipt["read_at"]) or "",
                    }
                )
            items.sort(key=lambda item: item.get("read_at") or "", reverse=True)
            return {"items": items}

    def get_message_read_delta(self, *, conversation_id: str, message_id: str) -> dict:
        self._ensure_available()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        if not normalized_conversation_id:
            raise ValueError("conversation_id is required")
        if not normalized_message_id:
            raise ValueError("message_id is required")

        with chat_session() as session:
            conversation = session.get(ChatConversation, normalized_conversation_id)
            if conversation is None:
                raise LookupError("Conversation not found")
            message = session.get(ChatMessage, normalized_message_id)
            if message is None or message.conversation_id != conversation.id:
                raise LookupError("Message not found")
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            states = list(
                session.execute(
                    select(ChatConversationUserState).where(
                        ChatConversationUserState.conversation_id == conversation.id,
                        ChatConversationUserState.user_id.in_(member_user_ids),
                    )
                ).scalars()
            ) if member_user_ids else []
            read_rows = list(
                session.execute(
                    select(ChatMessageRead).where(
                        ChatMessageRead.conversation_id == conversation.id,
                        ChatMessageRead.message_id == message.id,
                        ChatMessageRead.user_id.in_(member_user_ids),
                    )
                ).scalars()
            ) if member_user_ids else []
            read_receipts = self._build_message_read_receipts(
                message=message,
                reader_user_ids=[
                    int(user_id)
                    for user_id in member_user_ids
                    if int(user_id) > 0 and int(user_id) != int(message.sender_user_id)
                ],
                states_by_user_id={int(item.user_id): item for item in states},
                reads_by_user_id={
                    int(item.user_id): item
                    for item in read_rows
                    if int(item.user_id) != int(message.sender_user_id)
                },
            )
        read_by_count = len(read_receipts)
        return {
            "conversation_id": message.conversation_id,
            "message_id": message.id,
            "read_by_count": read_by_count,
            "delivery_status": "read" if read_by_count > 0 else "sent",
        }

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

        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            participant_ids = self._conversation_member_ids(session, conversation.id)
            member_user_ids = [int(item) for item in participant_ids if int(item) > 0]

            task = self._get_hub_task_for_user(task_id=normalized_task_id, user_id=int(current_user_id))
            if task is None:
                raise LookupError("Task not found")
            if not self._task_is_shareable_to_members(task_id=normalized_task_id, member_ids=participant_ids):
                raise PermissionError("Task is not available to all chat participants")
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )

            task_preview = self._build_task_preview(task)
            now = _utc_now()
            next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
            message = ChatMessage(
                id=str(uuid4()),
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                kind="task_share",
                body=task_preview["title"],
                conversation_seq=next_conversation_seq,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                task_id=normalized_task_id,
                task_preview_json=json.dumps(task_preview, ensure_ascii=False),
                created_at=now,
            )
            session.add(message)
            conversation.last_message_id = message.id
            conversation.last_message_seq = next_conversation_seq
            conversation.last_message_at = now
            conversation.updated_at = now
            self._mark_sender_message_seen(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                message_id=message.id,
                conversation_seq=next_conversation_seq,
                seen_at=now,
            )
            self._increment_unread_counters_for_recipients(
                session=session,
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                seen_at=now,
            )
            session.flush()
            presence_map = self._get_presence_map(user_ids=member_user_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=member_user_ids)
            payload = self._serialize_message(
                conversation_kind=conversation.kind,
                message=message,
                current_user_id=int(current_user_id),
                users_by_id=users_by_id,
                member_ids=member_user_ids,
                reply_previews=self._build_reply_previews(
                    session=session,
                    reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                    users_by_id=users_by_id,
                ),
                forward_previews=self._build_forward_previews(
                    session=session,
                    forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                ),
            )
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
        normalized_body = _normalize_text(body)
        if len(normalized_body) > CHAT_MAX_MESSAGE_BODY_LENGTH:
            raise ValueError(f"Message body must be at most {CHAT_MAX_MESSAGE_BODY_LENGTH} characters")
        prepared: list[dict[str, Any]] = []
        written_paths: list[Path] = []

        try:
            normalized_conversation_id = ""
            with chat_session() as session:
                conversation = self._require_membership(
                    session=session,
                    conversation_id=conversation_id,
                    current_user_id=int(current_user_id),
                )
                normalized_conversation_id = conversation.id
            prepared = self._prepare_uploads(
                list(uploads or []),
                conversation_id=normalized_conversation_id,
                files_meta=files_meta,
            )
            written_paths.extend(
                item["path"]
                for item in prepared
                if isinstance(item.get("path"), Path)
            )
            payload = self._create_file_message_from_prepared(
                current_user_id=int(current_user_id),
                conversation_id=normalized_conversation_id,
                body=normalized_body,
                prepared=prepared,
                reply_to_message_id=reply_to_message_id,
            )
        except Exception:
            for path in written_paths:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
            raise

        self._postprocess_file_message(
            current_user_id=int(current_user_id),
            payload=payload,
            prepared=prepared,
            body=normalized_body,
            defer_push_notifications=defer_push_notifications,
        )
        return payload

    def _create_file_message_from_prepared(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        body: str,
        prepared: list[dict[str, Any]],
        reply_to_message_id: Optional[str] = None,
        forward_from_message_id: Optional[str] = None,
    ) -> dict[str, Any]:
        normalized_body = _normalize_text(body)
        member_user_ids: list[int] = []
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            now = _utc_now()
            next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
            message = ChatMessage(
                id=str(uuid4()),
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                kind="file",
                body=normalized_body,
                conversation_seq=next_conversation_seq,
                reply_to_message_id=getattr(reply_to_message, "id", None),
                forward_from_message_id=_normalize_text(forward_from_message_id) or None,
                created_at=now,
            )
            session.add(message)

            for item in prepared:
                session.add(
                    ChatMessageAttachment(
                        id=item["attachment_id"],
                        message_id=message.id,
                        conversation_id=conversation.id,
                        storage_name=item["storage_name"],
                        file_name=item["file_name"],
                        mime_type=item["mime_type"],
                        file_size=int(item["file_size"]),
                        width=int(item["width"]) if item.get("width") is not None else None,
                        height=int(item["height"]) if item.get("height") is not None else None,
                        uploaded_by_user_id=int(current_user_id),
                        created_at=now,
                    )
                )

            conversation.last_message_id = message.id
            conversation.last_message_seq = next_conversation_seq
            conversation.last_message_at = now
            conversation.updated_at = now
            self._mark_sender_message_seen(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                message_id=message.id,
                conversation_seq=next_conversation_seq,
                seen_at=now,
            )
            self._increment_unread_counters_for_recipients(
                session=session,
                conversation_id=conversation.id,
                sender_user_id=int(current_user_id),
                member_user_ids=member_user_ids,
                seen_at=now,
            )
            session.flush()
            presence_map = self._get_presence_map(user_ids=member_user_ids)
            users_by_id = self._get_users_map(presence_map=presence_map, user_ids=member_user_ids)
            return self._serialize_message(
                conversation_kind=conversation.kind,
                message=message,
                current_user_id=int(current_user_id),
                users_by_id=users_by_id,
                member_ids=member_user_ids,
                reply_previews=self._build_reply_previews(
                    session=session,
                    reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                    users_by_id=users_by_id,
                ),
                forward_previews=self._build_forward_previews(
                    session=session,
                    forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                ),
                attachments=[
                    {
                        "id": item["attachment_id"],
                        "file_name": item["file_name"],
                        "mime_type": item["mime_type"],
                        "file_size": int(item["file_size"]),
                        "width": int(item["width"]) if item.get("width") is not None else None,
                        "height": int(item["height"]) if item.get("height") is not None else None,
                        "created_at": _iso(now) or "",
                    }
                    for item in prepared
                ],
            )

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
        self._maybe_cleanup_upload_sessions()
        normalized_body = _normalize_text(body)
        if len(normalized_body) > CHAT_MAX_MESSAGE_BODY_LENGTH:
            raise ValueError(f"Message body must be at most {CHAT_MAX_MESSAGE_BODY_LENGTH} characters")
        file_items = list(files or [])
        if not file_items:
            raise ValueError("At least one file is required")
        if len(file_items) > CHAT_MAX_FILES_PER_MESSAGE:
            raise ValueError(f"You can upload at most {CHAT_MAX_FILES_PER_MESSAGE} files at a time")

        prepared_files: list[dict[str, Any]] = []
        total_size = 0
        normalized_conversation_id = ""
        normalized_reply_to_message_id: str | None = None
        with chat_session() as session:
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            normalized_conversation_id = conversation.id
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            normalized_reply_to_message_id = getattr(reply_to_message, "id", None)
            for item in file_items:
                prepared_item = self._build_upload_session_file_manifest(
                    file_name=_normalize_text(item.get("file_name")) or "file.bin",
                    mime_type=_normalize_text(item.get("mime_type")),
                    size=int(item.get("size", 0) or 0),
                    original_size=int(item.get("original_size", 0) or 0),
                    transfer_encoding=_normalize_text(item.get("transfer_encoding"), "identity"),
                )
                total_size += int(prepared_item["original_size"])
                if total_size > CHAT_MAX_TOTAL_FILE_BYTES:
                    raise ValueError("Total upload size exceeds 25 MB")
                prepared_files.append(prepared_item)

        session_id = str(uuid4())
        now = _utc_now()
        manifest = {
            "session_id": session_id,
            "conversation_id": normalized_conversation_id,
            "current_user_id": int(current_user_id),
            "body": normalized_body,
            "reply_to_message_id": normalized_reply_to_message_id,
            "chunk_size_bytes": self.upload_session_chunk_size_bytes,
            "created_at": _iso(now) or "",
            "updated_at": _iso(now) or "",
            "expires_at": _iso(now + timedelta(seconds=self.upload_session_ttl_sec)) or "",
            "status": "pending",
            "message_id": "",
            "files": prepared_files,
        }
        self._write_upload_session_manifest(manifest)
        return self._serialize_upload_session(manifest)

    def get_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
    ) -> dict[str, Any]:
        self._ensure_available()
        self._maybe_cleanup_upload_sessions()
        lock = self._get_upload_session_lock(session_id)
        with lock:
            manifest = self._load_upload_session_manifest(session_id)
            self._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            self._ensure_upload_session_active(manifest)
            return self._serialize_upload_session(manifest)

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
        self._maybe_cleanup_upload_sessions()
        normalized_payload = bytes(payload or b"")
        if not normalized_payload:
            raise ValueError("Chunk payload is required")
        if len(normalized_payload) > self.upload_session_chunk_size_bytes:
            raise ValueError("Chunk payload exceeds session chunk size")
        if int(chunk_index) < 0:
            raise ValueError("chunk_index must be non-negative")
        if int(offset) < 0:
            raise ValueError("offset must be non-negative")

        lock = self._get_upload_session_lock(session_id)
        with lock:
            manifest = self._load_upload_session_manifest(session_id)
            self._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            self._ensure_upload_session_active(manifest)
            if _normalize_text(manifest.get("status")).lower() == "completed":
                raise ValueError("Upload session is already completed")

            file_payload = self._find_upload_session_file(manifest, file_id=file_id)
            expected_size = int(file_payload.get("size", 0) or 0)
            received_chunks = sorted({
                int(item)
                for item in list(file_payload.get("received_chunks") or [])
                if isinstance(item, int) or str(item).strip().isdigit()
            })
            received_bytes = int(file_payload.get("received_bytes", 0) or 0)
            normalized_chunk_index = int(chunk_index)
            normalized_offset = int(offset)
            chunk_count = int(file_payload.get("chunk_count", 0) or 0)
            if normalized_chunk_index >= chunk_count:
                raise ValueError("chunk_index is out of range")

            expected_chunk_size = min(
                self.upload_session_chunk_size_bytes,
                max(0, expected_size - (normalized_chunk_index * self.upload_session_chunk_size_bytes)),
            )
            if expected_chunk_size <= 0:
                raise ValueError("Chunk does not match file size")
            if len(normalized_payload) != expected_chunk_size:
                raise ValueError("Chunk payload size does not match the expected size")

            if normalized_chunk_index in received_chunks:
                return {
                    "session_id": _normalize_text(manifest.get("session_id")),
                    "file_id": _normalize_text(file_payload.get("file_id")),
                    "chunk_index": normalized_chunk_index,
                    "already_present": True,
                    "received_bytes": received_bytes,
                    "received_chunks": received_chunks,
                    "file_complete": received_bytes >= expected_size,
                }

            if normalized_chunk_index != len(received_chunks):
                raise ValueError("Unexpected chunk_index for upload session file")
            if normalized_offset != received_bytes:
                raise ValueError("Unexpected chunk offset for upload session file")

            part_path = self._upload_session_part_path(session_id, _normalize_text(file_payload.get("file_id")))
            part_path.parent.mkdir(parents=True, exist_ok=True)
            with part_path.open("ab") as target:
                target.write(normalized_payload)

            next_received_bytes = received_bytes + len(normalized_payload)
            file_payload["received_bytes"] = next_received_bytes
            file_payload["received_chunks"] = received_chunks + [normalized_chunk_index]
            now = _utc_now()
            manifest["updated_at"] = _iso(now) or ""
            manifest["expires_at"] = _iso(now + timedelta(seconds=self.upload_session_ttl_sec)) or ""
            self._write_upload_session_manifest(manifest)
            return {
                "session_id": _normalize_text(manifest.get("session_id")),
                "file_id": _normalize_text(file_payload.get("file_id")),
                "chunk_index": normalized_chunk_index,
                "already_present": False,
                "received_bytes": next_received_bytes,
                "received_chunks": list(file_payload.get("received_chunks") or []),
                "file_complete": next_received_bytes >= expected_size,
            }

    def complete_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
        defer_push_notifications: bool = False,
    ) -> dict[str, Any]:
        self._ensure_available()
        self._maybe_cleanup_upload_sessions()
        lock = self._get_upload_session_lock(session_id)
        with lock:
            manifest = self._load_upload_session_manifest(session_id)
            self._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            self._ensure_upload_session_active(manifest)
            if _normalize_text(manifest.get("status")).lower() == "completed":
                message_id = _normalize_text(manifest.get("message_id"))
                if message_id:
                    self._set_request_meta(upload_session_completed_now=False)
                    return self.get_message(current_user_id=int(current_user_id), message_id=message_id)

            with chat_session() as session:
                existing_message_id = self._find_existing_upload_session_message_id(session=session, manifest=manifest)
            if existing_message_id:
                manifest["status"] = "completed"
                manifest["message_id"] = existing_message_id
                manifest["updated_at"] = _iso(_utc_now()) or ""
                self._write_upload_session_manifest(manifest)
                self._set_request_meta(upload_session_completed_now=False)
                return self.get_message(current_user_id=int(current_user_id), message_id=existing_message_id)

            conversation_id = _normalize_text(manifest.get("conversation_id"))
            conversation_dir = self._attachments_root / conversation_id
            conversation_dir.mkdir(parents=True, exist_ok=True)
            prepared: list[dict[str, Any]] = []
            moved_paths: list[Path] = []
            total_decoded_size = 0
            try:
                for file_payload in list(manifest.get("files") or []):
                    expected_size = int(file_payload.get("size", 0) or 0)
                    original_size = int(file_payload.get("original_size", 0) or 0)
                    received_bytes = int(file_payload.get("received_bytes", 0) or 0)
                    chunk_count = int(file_payload.get("chunk_count", 0) or 0)
                    received_chunks = list(file_payload.get("received_chunks") or [])
                    transfer_encoding = self._normalize_transfer_encoding(file_payload.get("transfer_encoding"))
                    if received_bytes != expected_size or len(received_chunks) != chunk_count:
                        raise ValueError("Upload session is incomplete")

                    part_path = self._upload_session_part_path(session_id, _normalize_text(file_payload.get("file_id")))
                    if not part_path.exists() or not part_path.is_file():
                        raise ValueError("Upload session file is missing")
                    if int(part_path.stat().st_size) != expected_size:
                        raise ValueError("Upload session file size mismatch")

                    storage_name = _normalize_text(file_payload.get("storage_name"))
                    final_path = conversation_dir / Path(storage_name).name
                    if final_path.exists():
                        final_path.unlink(missing_ok=True)

                    try:
                        with part_path.open("rb") as source:
                            file_size, probe_bytes, total_decoded_size = self._write_decoded_transfer_payload(
                                source_stream=source,
                                target_path=final_path,
                                transfer_encoding=transfer_encoding,
                                expected_original_size=original_size,
                                total_size=total_decoded_size,
                            )
                    except Exception:
                        final_path.unlink(missing_ok=True)
                        raise

                    width, height = _probe_image_dimensions(
                        probe_bytes,
                        _normalize_text(file_payload.get("mime_type")),
                    )
                    part_path.unlink(missing_ok=True)
                    moved_paths.append(final_path)
                    prepared.append(
                        {
                            "attachment_id": _normalize_text(file_payload.get("attachment_id") or file_payload.get("file_id")),
                            "file_name": _normalize_text(file_payload.get("file_name")),
                            "mime_type": _normalize_text(file_payload.get("mime_type")),
                            "file_size": file_size,
                            "width": width,
                            "height": height,
                            "storage_name": storage_name,
                            "path": final_path,
                        }
                    )

                payload = self._create_file_message_from_prepared(
                    current_user_id=int(current_user_id),
                    conversation_id=conversation_id,
                    body=_normalize_text(manifest.get("body")),
                    prepared=prepared,
                    reply_to_message_id=_normalize_text(manifest.get("reply_to_message_id")) or None,
                )
            except Exception:
                for path in moved_paths:
                    try:
                        path.unlink(missing_ok=True)
                    except Exception:
                        pass
                raise

            manifest["status"] = "completed"
            manifest["message_id"] = _normalize_text(payload.get("id"))
            manifest["updated_at"] = _iso(_utc_now()) or ""
            self._write_upload_session_manifest(manifest)
            self._set_request_meta(upload_session_completed_now=True)
            self._postprocess_file_message(
                current_user_id=int(current_user_id),
                payload=payload,
                prepared=prepared,
                body=_normalize_text(manifest.get("body")),
                defer_push_notifications=defer_push_notifications,
            )
            return payload

    def cancel_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
    ) -> dict[str, Any]:
        self._ensure_available()
        lock = self._get_upload_session_lock(session_id)
        with lock:
            manifest = self._load_upload_session_manifest(session_id)
            self._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            if _normalize_text(manifest.get("status")).lower() == "completed":
                return {"ok": True}
            self._delete_upload_session_dir(session_id)
            return {"ok": True}

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

    def create_direct_conversation(self, *, current_user_id: int, peer_user_id: int) -> dict:
        self._ensure_available()
        creator = self._require_active_user(int(current_user_id))
        peer = self._require_active_user(int(peer_user_id))
        if int(current_user_id) == int(peer_user_id):
            raise ValueError("Cannot create a direct conversation with yourself")

        direct_key = _direct_key(int(current_user_id), int(peer_user_id))
        with chat_session() as session:
            existing = session.execute(
                select(ChatConversation).where(
                    ChatConversation.kind == "direct",
                    ChatConversation.direct_key == direct_key,
                )
            ).scalar_one_or_none()
            if existing:
                return self._build_conversation_payload(session, existing, int(current_user_id))

            now = _utc_now()
            conversation = ChatConversation(
                id=str(uuid4()),
                kind="direct",
                direct_key=direct_key,
                title=None,
                created_by_user_id=int(current_user_id),
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.flush()
            session.add_all(
                [
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=int(current_user_id),
                        member_role="owner",
                        joined_at=now,
                    ),
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=int(peer["id"]),
                        member_role="member",
                        joined_at=now,
                    ),
                ]
            )
            session.add_all(
                [
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=int(current_user_id),
                        opened_at=now,
                        updated_at=now,
                    ),
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=int(peer["id"]),
                        updated_at=now,
                    ),
                ]
            )
            session.flush()
            participant_ids = {int(current_user_id), int(peer["id"])}
            presence_map = self._get_presence_map(user_ids=participant_ids)
            payload = self._build_conversation_payload(
                session,
                conversation,
                int(current_user_id),
                users_override={
                    int(current_user_id): self._serialize_user(creator, presence_map=presence_map),
                    int(peer["id"]): self._serialize_user(peer, presence_map=presence_map),
                },
            )
        self._invalidate_user_cache(user_id=int(current_user_id), bucket="conversations")
        self._invalidate_user_cache(user_id=int(peer["id"]), bucket="conversations")
        return payload

    def create_group_conversation(self, *, current_user_id: int, title: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        normalized_title = _normalize_text(title)
        if not normalized_title:
            raise ValueError("Group title is required")

        unique_member_ids = {int(item) for item in list(member_user_ids or []) if int(item) > 0}
        unique_member_ids.add(int(current_user_id))
        if len(unique_member_ids) > self.group_max_members:
            raise ValueError(f"Group member limit exceeded ({self.group_max_members})")
        members = [self._require_active_user(item) for item in sorted(unique_member_ids)]
        now = _utc_now()

        with chat_session() as session:
            conversation = ChatConversation(
                id=str(uuid4()),
                kind="group",
                title=normalized_title,
                direct_key=None,
                created_by_user_id=int(current_user_id),
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.flush()
            for member in members:
                user_id = int(member["id"])
                session.add(
                    ChatMember(
                        conversation_id=conversation.id,
                        user_id=user_id,
                        member_role="owner" if user_id == int(current_user_id) else "member",
                        joined_at=now,
                    )
                )
                session.add(
                    ChatConversationUserState(
                        conversation_id=conversation.id,
                        user_id=user_id,
                        opened_at=now if user_id == int(current_user_id) else None,
                        updated_at=now,
                    )
                )
            session.flush()
            participant_ids = {int(item["id"]) for item in members if int(item["id"]) > 0}
            presence_map = self._get_presence_map(user_ids=participant_ids)
            users_override = {int(item["id"]): self._serialize_user(item, presence_map=presence_map) for item in members}
            payload = self._build_conversation_payload(session, conversation, int(current_user_id), users_override=users_override)
        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(payload.get("id")),
            user_ids=[int(item["id"]) for item in members],
        )
        return payload

    def add_group_members(self, *, current_user_id: int, conversation_id: str, member_user_ids: list[int]) -> dict:
        self._ensure_available()
        requested_user_ids = sorted({
            int(item)
            for item in list(member_user_ids or [])
            if int(item) > 0 and int(item) != int(current_user_id)
        })
        if not requested_user_ids:
            raise ValueError("member_user_ids is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, actor_member = self._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            actor = self._require_active_user(int(current_user_id))
            active_member_ids = set(self._conversation_member_ids(session, conversation.id))
            candidate_user_ids = [user_id for user_id in requested_user_ids if user_id not in active_member_ids]
            if len(active_member_ids) + len(candidate_user_ids) > self.group_max_members:
                raise ValueError(f"Group member limit exceeded ({self.group_max_members})")

            existing_rows = list(
                session.execute(
                    select(ChatMember).where(
                        ChatMember.conversation_id == conversation.id,
                        ChatMember.user_id.in_(requested_user_ids),
                    )
                ).scalars()
            )
            existing_by_user_id = {int(item.user_id): item for item in existing_rows}
            added_users: list[dict] = []
            now = _utc_now()
            for user_id in candidate_user_ids:
                user = self._require_active_user(int(user_id))
                existing_member = existing_by_user_id.get(int(user_id))
                if existing_member is not None:
                    existing_member.left_at = None
                    existing_member.member_role = "member"
                    existing_member.joined_at = now
                else:
                    session.add(
                        ChatMember(
                            conversation_id=conversation.id,
                            user_id=int(user_id),
                            member_role="member",
                            joined_at=now,
                        )
                    )
                state = self._get_or_create_conversation_state(
                    session=session,
                    conversation_id=conversation.id,
                    current_user_id=int(user_id),
                )
                state.is_archived = False
                state.updated_at = now
                added_users.append(user)
                affected_user_ids.add(int(user_id))

            if added_users:
                member_ids_after = self._conversation_member_ids(session, conversation.id)
                added_names = ", ".join(_display_user_name(user) for user in added_users)
                self._append_system_message(
                    session=session,
                    conversation=conversation,
                    actor_user_id=int(current_user_id),
                    body=f"{_display_user_name(actor)} добавил(а): {added_names}",
                    member_user_ids=member_ids_after,
                    now=now,
                )
                affected_user_ids.update(member_ids_after)
            else:
                conversation.updated_at = now
            session.flush()
            payload = self._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def remove_group_member(self, *, current_user_id: int, conversation_id: str, target_user_id: int) -> dict:
        self._ensure_available()
        normalized_target_user_id = int(target_user_id)
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")
        if normalized_target_user_id == int(current_user_id):
            raise ValueError("Use leave endpoint to leave group")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            conversation, actor_member = self._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            actor_role = _normalize_member_role(actor_member.member_role)
            target_member = self._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target_user_id,
            )
            if target_member is None:
                raise LookupError("Group member not found")
            target_role = _normalize_member_role(target_member.member_role)
            if target_role == "owner":
                raise PermissionError("Owner cannot be removed")
            if target_role == "moderator" and actor_role != "owner":
                raise PermissionError("Only owner can remove moderators")

            actor = self._require_active_user(int(current_user_id))
            target = self._require_active_user(normalized_target_user_id)
            now = _utc_now()
            target_member.left_at = now
            member_ids_after = self._conversation_member_ids(session, conversation.id)
            self._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} исключил(а) {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def update_group_member_role(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        target_user_id: int,
        member_role: str,
    ) -> dict:
        self._ensure_available()
        normalized_target_user_id = int(target_user_id)
        next_role = _normalize_member_role(member_role)
        if next_role not in {"moderator", "member"}:
            raise ValueError("member_role must be moderator or member")
        if normalized_target_user_id <= 0:
            raise ValueError("target_user_id is required")
        if normalized_target_user_id == int(current_user_id):
            raise PermissionError("Owner role must be transferred through ownership endpoint")

        affected_user_ids: set[int] = {int(current_user_id), normalized_target_user_id}
        with chat_session() as session:
            conversation, _ = self._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            target_member = self._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target_user_id,
            )
            if target_member is None:
                raise LookupError("Group member not found")
            if _normalize_member_role(target_member.member_role) == "owner":
                raise PermissionError("Owner role cannot be changed here")
            if _normalize_member_role(target_member.member_role) == next_role:
                return self._build_conversation_detail_payload(session, conversation, int(current_user_id))

            actor = self._require_active_user(int(current_user_id))
            target = self._require_active_user(normalized_target_user_id)
            now = _utc_now()
            target_member.member_role = next_role
            member_ids_after = self._conversation_member_ids(session, conversation.id)
            action = "назначил(а) модератором" if next_role == "moderator" else "снял(а) модератора"
            self._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} {action}: {_display_user_name(target)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def transfer_group_ownership(self, *, current_user_id: int, conversation_id: str, owner_user_id: int) -> dict:
        self._ensure_available()
        next_owner_user_id = int(owner_user_id)
        if next_owner_user_id <= 0:
            raise ValueError("owner_user_id is required")
        if next_owner_user_id == int(current_user_id):
            raise ValueError("User is already owner")

        affected_user_ids: set[int] = {int(current_user_id), next_owner_user_id}
        with chat_session() as session:
            conversation, actor_member = self._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            next_owner_member = self._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=next_owner_user_id,
            )
            if next_owner_member is None:
                raise LookupError("New owner must be an active group member")

            actor = self._require_active_user(int(current_user_id))
            next_owner = self._require_active_user(next_owner_user_id)
            now = _utc_now()
            actor_member.member_role = "moderator"
            next_owner_member.member_role = "owner"
            member_ids_after = self._conversation_member_ids(session, conversation.id)
            self._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} передал(а) права владельца: {_display_user_name(next_owner)}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

    def leave_group(self, *, current_user_id: int, conversation_id: str) -> dict:
        self._ensure_available()
        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, actor_member = self._require_group_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            if _normalize_member_role(actor_member.member_role) == "owner":
                raise PermissionError("Transfer ownership before leaving the group")

            actor = self._require_active_user(int(current_user_id))
            now = _utc_now()
            actor_member.left_at = now
            member_ids_after = self._conversation_member_ids(session, conversation.id)
            self._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} вышел(а) из группы",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return {"conversation_id": _normalize_text(conversation_id), "left": True}

    def update_group_profile(self, *, current_user_id: int, conversation_id: str, title: Optional[str] = None) -> dict:
        self._ensure_available()
        normalized_title = _normalize_text(title)
        if not normalized_title:
            raise ValueError("Group title is required")

        affected_user_ids: set[int] = {int(current_user_id)}
        with chat_session() as session:
            conversation, _ = self._require_group_owner(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            if _normalize_text(conversation.title) == normalized_title:
                return self._build_conversation_detail_payload(session, conversation, int(current_user_id))

            actor = self._require_active_user(int(current_user_id))
            now = _utc_now()
            conversation.title = normalized_title
            member_ids_after = self._conversation_member_ids(session, conversation.id)
            self._append_system_message(
                session=session,
                conversation=conversation,
                actor_user_id=int(current_user_id),
                body=f"{_display_user_name(actor)} переименовал(а) группу: {normalized_title}",
                member_user_ids=member_ids_after,
                now=now,
            )
            affected_user_ids.update(member_ids_after)
            session.flush()
            payload = self._build_conversation_detail_payload(session, conversation, int(current_user_id))

        self._invalidate_conversation_views_for_users(
            conversation_id=_normalize_text(conversation_id),
            user_ids=sorted(affected_user_ids),
        )
        return payload

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
        dedup_hit = False
        with chat_session() as session:
            stage_started_at = time.perf_counter()
            conversation = self._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            conversation = self._lock_conversation_for_write(session=session, conversation_id=conversation.id)
            member_user_ids = self._conversation_member_ids(session, conversation.id)
            reply_to_message = self._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            stage_metrics["membership_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

            existing_message = self._find_existing_client_message(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                client_message_id=normalized_client_message_id or "",
            )
            if existing_message is not None:
                dedup_hit = True
                message_id = existing_message.id
                stage_started_at = time.perf_counter()
                payload = self._build_message_payload_for_members(
                    session=session,
                    conversation=conversation,
                    message=existing_message,
                    current_user_id=int(current_user_id),
                    member_user_ids=member_user_ids,
                )
                stage_metrics["serialize_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
            else:
                stage_started_at = time.perf_counter()
                now = _utc_now()
                next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
                message = ChatMessage(
                    id=str(uuid4()),
                    conversation_id=conversation.id,
                    sender_user_id=int(current_user_id),
                    body_format=normalized_body_format,
                    body=normalized_body,
                    conversation_seq=next_conversation_seq,
                    client_message_id=normalized_client_message_id,
                    reply_to_message_id=getattr(reply_to_message, "id", None),
                    created_at=now,
                )
                session.add(message)
                conversation.last_message_id = message.id
                conversation.last_message_seq = next_conversation_seq
                conversation.last_message_at = now
                conversation.updated_at = now
                self._mark_sender_message_seen(
                    session=session,
                    conversation_id=conversation.id,
                    current_user_id=int(current_user_id),
                    message_id=message.id,
                    conversation_seq=next_conversation_seq,
                    seen_at=now,
                )
                self._increment_unread_counters_for_recipients(
                    session=session,
                    conversation_id=conversation.id,
                    sender_user_id=int(current_user_id),
                    member_user_ids=member_user_ids,
                    seen_at=now,
                )
                stage_metrics["prepare_write_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

                stage_started_at = time.perf_counter()
                try:
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    dedup_hit = True
                    with chat_session() as dedup_session:
                        dedup_conversation = self._require_membership(
                            session=dedup_session,
                            conversation_id=conversation_id,
                            current_user_id=int(current_user_id),
                        )
                        member_user_ids = self._conversation_member_ids(dedup_session, dedup_conversation.id)
                        existing_message = self._find_existing_client_message(
                            session=dedup_session,
                            conversation_id=dedup_conversation.id,
                            current_user_id=int(current_user_id),
                            client_message_id=normalized_client_message_id or "",
                        )
                        if existing_message is None:
                            raise
                        message_id = existing_message.id
                        payload = self._build_message_payload_for_members(
                            session=dedup_session,
                            conversation=dedup_conversation,
                            message=existing_message,
                            current_user_id=int(current_user_id),
                            member_user_ids=member_user_ids,
                        )
                    stage_metrics["flush_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
                    stage_metrics["serialize_ms"] = stage_metrics.get("serialize_ms", 0.0)
                else:
                    stage_metrics["flush_ms"] = (time.perf_counter() - stage_started_at) * 1000.0
                    message_id = message.id

                    stage_started_at = time.perf_counter()
                    payload = self._build_message_payload_for_members(
                        session=session,
                        conversation=conversation,
                        message=message,
                        current_user_id=int(current_user_id),
                        member_user_ids=member_user_ids,
                    )
                    stage_metrics["serialize_ms"] = (time.perf_counter() - stage_started_at) * 1000.0

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
        source_kind = "text"
        source_body = ""
        source_attachments: list[ChatMessageAttachment] = []
        source_task_preview: dict | None = None
        payload: dict[str, Any] | None = None

        try:
            with chat_session() as session:
                target_conversation = self._require_membership(
                    session=session,
                    conversation_id=conversation_id,
                    current_user_id=int(current_user_id),
                )
                target_conversation = self._lock_conversation_for_write(
                    session=session,
                    conversation_id=target_conversation.id,
                )
                source_message = session.get(ChatMessage, normalized_source_message_id)
                if source_message is None:
                    raise LookupError("Source message not found")
                self._require_membership(
                    session=session,
                    conversation_id=source_message.conversation_id,
                    current_user_id=int(current_user_id),
                )

                member_user_ids = self._conversation_member_ids(session, target_conversation.id)
                reply_to_message = self._resolve_reply_message(
                    session=session,
                    conversation_id=target_conversation.id,
                    reply_to_message_id=reply_to_message_id,
                )
                source_kind = self._normalize_message_kind(getattr(source_message, "kind", "text"))
                source_body = _normalize_text(getattr(source_message, "body", ""))
                source_body_format = _normalize_body_format(getattr(source_message, "body_format", None))
                message_body_format = source_body_format if source_kind == "text" else "plain"
                source_attachments = self._list_attachments_by_message(
                    session=session,
                    message_ids=[source_message.id],
                ).get(source_message.id, [])
                if len(source_attachments) > CHAT_MAX_FILES_PER_MESSAGE:
                    raise ValueError(f"You can upload at most {CHAT_MAX_FILES_PER_MESSAGE} files at a time")
                if sum(int(item.file_size or 0) for item in source_attachments) > CHAT_MAX_TOTAL_FILE_BYTES:
                    raise ValueError("Total upload size exceeds 25 MB")

                forward_from_message_id = (
                    _normalize_text(getattr(source_message, "forward_from_message_id", None))
                    or source_message.id
                )
                task_id = _normalize_text(getattr(source_message, "task_id", None)) or None
                if source_kind == "task_share":
                    if not task_id:
                        raise ValueError("Forward source task is missing")
                    if not self._task_is_shareable_to_members(task_id=task_id, member_ids=member_user_ids):
                        raise PermissionError("Task is not available to all chat participants")
                    source_task_preview = self._deserialize_task_preview(getattr(source_message, "task_preview_json", None))

                now = _utc_now()
                next_conversation_seq = int(getattr(target_conversation, "last_message_seq", 0) or 0) + 1
                message = ChatMessage(
                    id=str(uuid4()),
                    conversation_id=target_conversation.id,
                    sender_user_id=int(current_user_id),
                    kind=source_kind,
                    body_format=message_body_format,
                    body=source_body,
                    conversation_seq=next_conversation_seq,
                    reply_to_message_id=getattr(reply_to_message, "id", None),
                    forward_from_message_id=forward_from_message_id,
                    task_id=task_id if source_kind == "task_share" else None,
                    task_preview_json=getattr(source_message, "task_preview_json", None) if source_kind == "task_share" else None,
                    created_at=now,
                )
                session.add(message)

                target_dir = self._attachments_root / target_conversation.id
                target_dir.mkdir(parents=True, exist_ok=True)
                attachment_payload: list[dict[str, Any]] = []
                for source_attachment in source_attachments:
                    attachment_id = str(uuid4())
                    file_name = _safe_file_name(getattr(source_attachment, "file_name", None) or "file.bin")
                    storage_name = f"{attachment_id}_{file_name}"
                    source_path = self._resolve_attachment_path(
                        conversation_id=source_message.conversation_id,
                        storage_name=source_attachment.storage_name,
                    )
                    if not source_path.exists() or not source_path.is_file():
                        raise LookupError("Attachment file not found")
                    target_path = (target_dir / storage_name).resolve()
                    try:
                        target_path.relative_to(self._attachments_root.resolve())
                    except ValueError as exc:
                        raise ValueError("Invalid attachment path") from exc
                    shutil.copy2(source_path, target_path)
                    written_paths.append(target_path)
                    session.add(
                        ChatMessageAttachment(
                            id=attachment_id,
                            message_id=message.id,
                            conversation_id=target_conversation.id,
                            storage_name=storage_name,
                            file_name=file_name,
                            mime_type=_normalize_text(getattr(source_attachment, "mime_type", None)) or None,
                            file_size=int(source_attachment.file_size or 0),
                            width=int(source_attachment.width) if source_attachment.width is not None else None,
                            height=int(source_attachment.height) if source_attachment.height is not None else None,
                            uploaded_by_user_id=int(current_user_id),
                            created_at=now,
                        )
                    )
                    attachment_payload.append(
                        {
                            "id": attachment_id,
                            "file_name": file_name,
                            "mime_type": _normalize_text(getattr(source_attachment, "mime_type", None)) or None,
                            "file_size": int(source_attachment.file_size or 0),
                            "width": int(source_attachment.width) if source_attachment.width is not None else None,
                            "height": int(source_attachment.height) if source_attachment.height is not None else None,
                            "created_at": _iso(now) or "",
                        }
                    )

                target_conversation.last_message_id = message.id
                target_conversation.last_message_seq = next_conversation_seq
                target_conversation.last_message_at = now
                target_conversation.updated_at = now
                self._mark_sender_message_seen(
                    session=session,
                    conversation_id=target_conversation.id,
                    current_user_id=int(current_user_id),
                    message_id=message.id,
                    conversation_seq=next_conversation_seq,
                    seen_at=now,
                )
                self._increment_unread_counters_for_recipients(
                    session=session,
                    conversation_id=target_conversation.id,
                    sender_user_id=int(current_user_id),
                    member_user_ids=member_user_ids,
                    seen_at=now,
                )
                session.flush()

                presence_map = self._get_presence_map(user_ids=member_user_ids)
                users_by_id = self._get_users_map(presence_map=presence_map, user_ids=member_user_ids)
                payload = self._serialize_message(
                    conversation_kind=target_conversation.kind,
                    message=message,
                    current_user_id=int(current_user_id),
                    users_by_id=users_by_id,
                    member_ids=member_user_ids,
                    reply_previews=self._build_reply_previews(
                        session=session,
                        reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                        users_by_id=users_by_id,
                    ),
                    forward_previews=self._build_forward_previews(
                        session=session,
                        forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
                    ),
                    attachments=attachment_payload,
                )
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
            conversation, actor_member = self._require_group_membership(
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

            actor_role = _normalize_member_role(actor_member.member_role)
            is_own_message = int(getattr(message, "sender_user_id", 0) or 0) == int(current_user_id)
            if not is_own_message and actor_role not in CHAT_GROUP_MANAGER_ROLES:
                raise PermissionError("Message delete access denied")

            now = _utc_now()
            if not bool(getattr(message, "is_deleted", False)):
                message.is_deleted = True
                message.deleted_at = now
                message.deleted_by_user_id = int(current_user_id)
                message.deleted_reason = "self" if is_own_message else "moderated"

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
            pass
        return payload

    def _build_conversation_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        return self._build_conversation_summary_payload(
            session=session,
            conversation=conversation,
            current_user_id=current_user_id,
            users_override=users_override,
        )

    def _build_conversation_summary_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        state = session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.conversation_id == conversation.id,
                ChatConversationUserState.user_id == int(current_user_id),
            )
        ).scalar_one_or_none()
        last_message = None
        if _normalize_text(conversation.last_message_id):
            last_message = session.get(ChatMessage, conversation.last_message_id)
        member_ids = [
            int(item.user_id)
            for item in members
            if int(item.user_id) > 0
        ]
        presence_map = self._get_presence_map(user_ids=member_ids)
        users_by_id = users_override or self._get_users_map(
            presence_map=presence_map,
            user_ids=member_ids,
        )
        last_message_attachments = self._list_attachments_by_message(
            session=session,
            message_ids=[last_message.id],
        ).get(last_message.id, []) if last_message is not None else []
        unread_count = max(0, int(getattr(state, "unread_count", 0) or 0))
        return self._serialize_conversation(
            session=session,
            conversation=conversation,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            members=members,
            state=state,
            last_message=last_message,
            unread_count=unread_count,
            last_message_attachments=last_message_attachments,
        )

    def _build_conversation_detail_payload(
        self,
        session,
        conversation: ChatConversation,
        current_user_id: int,
        *,
        users_override: Optional[dict[int, dict]] = None,
    ) -> dict:
        summary_payload = self._build_conversation_summary_payload(
            session=session,
            conversation=conversation,
            current_user_id=current_user_id,
            users_override=users_override,
        )
        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
        presence_map = self._get_presence_map(user_ids=member_ids)
        users_by_id = users_override or self._get_users_map(
            presence_map=presence_map,
            user_ids=member_ids,
        )
        summary_payload["members"] = self._serialize_conversation_members(
            members=members,
            users_by_id=users_by_id,
        )
        return summary_payload

    def _serialize_conversation_members(
        self,
        *,
        members: list[ChatMember],
        users_by_id: dict[int, dict],
    ) -> list[dict]:
        items: list[dict] = []
        for member in members:
            user_payload = users_by_id.get(int(member.user_id))
            if user_payload is None:
                continue
            items.append(
                {
                    "user": user_payload,
                    "member_role": _normalize_text(member.member_role) or "member",
                    "joined_at": _iso(member.joined_at) or "",
                }
            )
        return items

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
    ) -> dict:
        direct_peer = None
        member_count = 0
        online_member_count = 0
        member_preview: list[dict[str, Any]] = []
        for member in members:
            user_payload = users_by_id.get(int(member.user_id))
            if user_payload is None:
                continue
            member_count += 1
            if bool((user_payload.get("presence") or {}).get("is_online")):
                online_member_count += 1
            if len(member_preview) < 5:
                member_preview.append(
                    {
                        "user": user_payload,
                        "member_role": _normalize_text(member.member_role) or "member",
                        "joined_at": _iso(member.joined_at) or "",
                    }
                )
            if conversation.kind == "direct" and int(member.user_id) != int(current_user_id):
                direct_peer = user_payload

        title = _normalize_text(conversation.title)
        if conversation.kind == "direct":
            peer_name = _normalize_text((direct_peer or {}).get("full_name")) or _normalize_text((direct_peer or {}).get("username"))
            title = peer_name or "Личный диалог"
        elif conversation.kind == "ai":
            title = title or "AI чат"
        if not title:
            title = "Групповой чат"

        last_message_preview = self._build_conversation_message_preview(
            session=session,
            last_message=last_message,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            conversation_kind=conversation.kind,
            attachments=last_message_attachments,
        )

        resolved_unread_count = int(
            unread_count
            if unread_count is not None
            else self._count_unread_messages(
                session=session,
                conversation_id=conversation.id,
                current_user_id=int(current_user_id),
                last_read_at=getattr(state, "last_read_at", None),
            )
        )
        return {
            "id": conversation.id,
            "kind": conversation.kind if conversation.kind in {"direct", "group", "ai"} else "group",
            "title": title,
            "created_at": _iso(conversation.created_at) or "",
            "updated_at": _iso(conversation.updated_at) or "",
            "last_message_at": _iso(conversation.last_message_at),
            "last_message_preview": last_message_preview,
            "unread_count": resolved_unread_count,
            "member_count": member_count,
            "online_member_count": online_member_count,
            "is_pinned": bool(getattr(state, "is_pinned", False)),
            "is_muted": bool(getattr(state, "is_muted", False)),
            "is_archived": bool(getattr(state, "is_archived", False)),
            "member_preview": member_preview,
            "direct_peer": direct_peer,
        }

    def _collect_message_payload_user_ids(
        self,
        *,
        session,
        message: ChatMessage,
        current_user_id: int,
    ) -> list[int]:
        required_user_ids = {
            int(current_user_id or 0),
            int(getattr(message, "sender_user_id", 0) or 0),
        }
        referenced_message_ids = [
            _normalize_text(getattr(message, "reply_to_message_id", None)),
            _normalize_text(getattr(message, "forward_from_message_id", None)),
        ]
        normalized_referenced_ids = [
            item
            for item in referenced_message_ids
            if item
        ]
        if normalized_referenced_ids:
            referenced_rows = session.execute(
                select(ChatMessage.sender_user_id).where(ChatMessage.id.in_(normalized_referenced_ids))
            ).all()
            for sender_user_id, in referenced_rows:
                normalized_sender_user_id = int(sender_user_id or 0)
                if normalized_sender_user_id > 0:
                    required_user_ids.add(normalized_sender_user_id)
        return sorted({
            int(user_id)
            for user_id in required_user_ids
            if int(user_id) > 0
        })

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
    ) -> dict:
        sender = users_by_id.get(int(message.sender_user_id)) or {
            "id": int(message.sender_user_id),
            "username": f"user-{message.sender_user_id}",
            "full_name": None,
            "role": "viewer",
            "is_active": True,
            "presence": None,
        }
        is_deleted = bool(getattr(message, "is_deleted", False))
        message_kind = self._normalize_message_kind(getattr(message, "kind", "text"))
        attachment_payload = [
            item if isinstance(item, dict) else self._attachment_to_payload(item)
            for item in ([] if is_deleted else list(attachments or []))
        ]
        is_own = int(message.sender_user_id) == int(current_user_id)
        read_receipts = []
        if is_own:
            read_receipts = self._build_message_read_receipts(
                message=message,
                reader_user_ids=[
                    int(user_id)
                    for user_id in list(member_ids or [])
                    if int(user_id) > 0 and int(user_id) != int(current_user_id)
                ],
                states_by_user_id=states_by_user_id or {},
                reads_by_user_id={
                    int(item.user_id): item
                    for item in list((reads_by_message_id or {}).get(message.id, []))
                    if int(item.user_id) != int(current_user_id)
                },
            )
        read_by_count = len(read_receipts)
        return {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "kind": message_kind,
            "body_format": _normalize_text(getattr(message, "body_format", None), "plain") or "plain",
            "client_message_id": _normalize_text(getattr(message, "client_message_id", None)) or None,
            "sender": sender,
            "body": CHAT_DELETED_MESSAGE_BODY if is_deleted else message.body,
            "created_at": _iso(message.created_at) or "",
            "edited_at": _iso(message.edited_at),
            "is_deleted": is_deleted,
            "deleted_at": _iso(getattr(message, "deleted_at", None)),
            "deleted_by_user_id": int(getattr(message, "deleted_by_user_id", 0) or 0) or None,
            "deleted_reason": _normalize_text(getattr(message, "deleted_reason", None)) or None,
            "is_own": is_own,
            "delivery_status": ("read" if read_by_count > 0 else "sent") if is_own else None,
            "read_by_count": read_by_count if is_own else 0,
            "reply_preview": dict((reply_previews or {}).get(_normalize_text(getattr(message, "reply_to_message_id", None))) or {}) or None,
            "forward_preview": dict((forward_previews or {}).get(_normalize_text(getattr(message, "forward_from_message_id", None))) or {}) or None,
            "task_preview": None if is_deleted else self._deserialize_task_preview(getattr(message, "task_preview_json", None)),
            "attachments": attachment_payload,
            "action_card": None if is_deleted else self._get_message_action_card(message_id=message.id),
        }

    def _get_message_action_card(self, *, message_id: str) -> dict | None:
        try:
            from backend.ai_chat.action_cards import get_action_card_for_message

            return get_action_card_for_message(message_id)
        except Exception:
            return None

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
        if last_message is None:
            return ""

        preview = CHAT_DELETED_MESSAGE_BODY if bool(getattr(last_message, "is_deleted", False)) else _normalize_text(getattr(last_message, "body", ""))[:180]
        message_kind = self._normalize_message_kind(getattr(last_message, "kind", "text"))
        if bool(getattr(last_message, "is_deleted", False)):
            preview = CHAT_DELETED_MESSAGE_BODY
        elif message_kind == "task_share":
            task_preview = self._deserialize_task_preview(getattr(last_message, "task_preview_json", None))
            task_title = _normalize_text((task_preview or {}).get("title"))
            preview = f"Задача: {task_title}" if task_title else "Поделились задачей"
        elif message_kind == "file" and not preview:
            resolved_attachments = list(attachments or self._list_attachments_by_message(
                session=session,
                message_ids=[getattr(last_message, "id", "")],
            ).get(getattr(last_message, "id", ""), []))
            if len(resolved_attachments) == 1:
                preview = f"Файл: {_normalize_text(resolved_attachments[0].file_name)}"
            elif len(resolved_attachments) > 1:
                preview = f"Файлы: {len(resolved_attachments)}"
            else:
                preview = "Файлы"
        if _normalize_text(getattr(last_message, "forward_from_message_id", None)):
            preview = f"Переслано: {preview}" if preview else "Пересланное сообщение"

        sender = users_by_id.get(int(getattr(last_message, "sender_user_id", 0) or 0)) or {}
        if conversation_kind == "group":
            sender_name = "Вы" if int(getattr(last_message, "sender_user_id", 0) or 0) == int(current_user_id) else self._get_short_user_name(sender)
            return f"{sender_name}: {preview}" if sender_name and preview else preview
        if int(getattr(last_message, "sender_user_id", 0) or 0) == int(current_user_id):
            return f"Вы: {preview}" if preview else "Вы"
        return preview

    def _build_reply_previews(
        self,
        *,
        session,
        reply_to_message_ids: list[object],
        users_by_id: dict[int, dict],
    ) -> dict[str, dict]:
        normalized_ids = [
            _normalize_text(item)
            for item in list(reply_to_message_ids or [])
            if _normalize_text(item)
        ]
        if not normalized_ids:
            return {}

        reply_messages = list(
            session.execute(select(ChatMessage).where(ChatMessage.id.in_(normalized_ids))).scalars()
        )
        attachments_by_message = self._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in reply_messages],
        )
        return {
            item.id: self._reply_preview_payload(
                message=item,
                attachments=attachments_by_message.get(item.id, []),
                users_by_id=users_by_id,
            )
            for item in reply_messages
        }

    def _build_forward_previews(
        self,
        *,
        session,
        forward_from_message_ids: list[object],
    ) -> dict[str, dict]:
        normalized_ids = [
            _normalize_text(item)
            for item in list(forward_from_message_ids or [])
            if _normalize_text(item)
        ]
        if not normalized_ids:
            return {}

        source_messages = list(
            session.execute(select(ChatMessage).where(ChatMessage.id.in_(normalized_ids))).scalars()
        )
        attachments_by_message = self._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in source_messages],
        )
        source_sender_ids = {
            int(getattr(item, "sender_user_id", 0) or 0)
            for item in source_messages
            if int(getattr(item, "sender_user_id", 0) or 0) > 0
        }
        presence_map = self._get_presence_map(user_ids=source_sender_ids)
        source_users_by_id = self._get_users_map(presence_map=presence_map, user_ids=source_sender_ids)
        return {
            item.id: self._forward_preview_payload(
                message=item,
                attachments=attachments_by_message.get(item.id, []),
                users_by_id=source_users_by_id,
            )
            for item in source_messages
        }

    def _reply_preview_payload(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> dict:
        sender = users_by_id.get(int(message.sender_user_id)) or {}
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

    def _forward_preview_payload(
        self,
        *,
        message: ChatMessage,
        attachments: list[ChatMessageAttachment],
        users_by_id: dict[int, dict],
    ) -> dict:
        sender = users_by_id.get(int(message.sender_user_id)) or {
            "id": int(message.sender_user_id),
            "username": f"user-{message.sender_user_id}",
            "full_name": None,
        }
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
        sender = users_by_id.get(int(message.sender_user_id)) or {}
        task_preview = self._deserialize_task_preview(getattr(message, "task_preview_json", None)) or {}
        parts = [
            _normalize_text(getattr(message, "body", "")),
            _normalize_text(task_preview.get("title")),
            _normalize_text(sender.get("full_name")),
            _normalize_text(sender.get("username")),
        ]
        parts.extend(_normalize_text(item.file_name) for item in list(attachments or []))
        return " ".join(part.lower() for part in parts if part)

    def _resolve_reply_message(
        self,
        *,
        session,
        conversation_id: str,
        reply_to_message_id: Optional[str],
    ) -> Optional[ChatMessage]:
        normalized_reply_id = _normalize_text(reply_to_message_id)
        if not normalized_reply_id:
            return None
        reply_to_message = session.get(ChatMessage, normalized_reply_id)
        if reply_to_message is None or reply_to_message.conversation_id != conversation_id:
            raise LookupError("Quoted message not found")
        return reply_to_message

    def _get_or_create_conversation_state(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
    ) -> ChatConversationUserState:
        state = session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.conversation_id == conversation_id,
                ChatConversationUserState.user_id == int(current_user_id),
            )
        ).scalar_one_or_none()
        if state is None:
            state = ChatConversationUserState(
                conversation_id=conversation_id,
                user_id=int(current_user_id),
            )
            session.add(state)
        return state

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
        normalized_conversation_id = _normalize_text(conversation_id)
        bind = session.get_bind()
        dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
        query = select(ChatConversation).where(ChatConversation.id == normalized_conversation_id)
        if dialect_name == "postgresql":
            query = query.with_for_update()
        conversation = session.execute(query).scalar_one_or_none()
        if conversation is None or bool(conversation.is_archived):
            raise LookupError("Conversation not found")
        return conversation

    def _require_membership(self, *, session, conversation_id: str, current_user_id: int) -> ChatConversation:
        conversation = session.get(ChatConversation, _normalize_text(conversation_id))
        if conversation is None or bool(conversation.is_archived):
            raise LookupError("Conversation not found")
        membership = session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.user_id == int(current_user_id),
                ChatMember.left_at.is_(None),
            )
        ).scalar_one_or_none()
        if membership is None:
            raise PermissionError("Conversation access denied")
        return conversation

    def _get_active_membership(self, *, session, conversation_id: str, user_id: int) -> ChatMember | None:
        return session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == _normalize_text(conversation_id),
                ChatMember.user_id == int(user_id),
                ChatMember.left_at.is_(None),
            )
        ).scalar_one_or_none()

    def _require_group_membership(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation = self._require_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_text(conversation.kind) != "group":
            raise ValueError("Group conversation required")
        membership = self._get_active_membership(
            session=session,
            conversation_id=conversation.id,
            user_id=int(current_user_id),
        )
        if membership is None:
            raise PermissionError("Conversation access denied")
        return conversation, membership

    def _require_group_manager(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation, membership = self._require_group_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_member_role(membership.member_role) not in CHAT_GROUP_MANAGER_ROLES:
            raise PermissionError("Group manager access denied")
        return conversation, membership

    def _require_group_owner(self, *, session, conversation_id: str, current_user_id: int) -> tuple[ChatConversation, ChatMember]:
        conversation, membership = self._require_group_membership(
            session=session,
            conversation_id=conversation_id,
            current_user_id=int(current_user_id),
        )
        if _normalize_member_role(membership.member_role) != "owner":
            raise PermissionError("Group owner access denied")
        return conversation, membership

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
        next_conversation_seq = int(getattr(conversation, "last_message_seq", 0) or 0) + 1
        message = ChatMessage(
            id=str(uuid4()),
            conversation_id=conversation.id,
            sender_user_id=int(actor_user_id),
            kind="system",
            body_format="plain",
            body=_normalize_text(body) or "Системное событие",
            conversation_seq=next_conversation_seq,
            created_at=now,
        )
        session.add(message)
        conversation.last_message_id = message.id
        conversation.last_message_seq = next_conversation_seq
        conversation.last_message_at = now
        conversation.updated_at = now
        self._mark_sender_message_seen(
            session=session,
            conversation_id=conversation.id,
            current_user_id=int(actor_user_id),
            message_id=message.id,
            conversation_seq=next_conversation_seq,
            seen_at=now,
        )
        self._increment_unread_counters_for_recipients(
            session=session,
            conversation_id=conversation.id,
            sender_user_id=int(actor_user_id),
            member_user_ids=member_user_ids,
            seen_at=now,
        )
        return message

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
    ) -> dict[str, Any]:
        members = list(
            session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )
        member_ids = [int(item.user_id) for item in members if int(item.user_id) > 0]
        states = list(
            session.execute(
                select(ChatConversationUserState).where(
                    ChatConversationUserState.conversation_id == conversation.id,
                    ChatConversationUserState.user_id.in_(member_ids),
                )
            ).scalars()
        ) if member_ids else []
        attachments_by_message = self._list_attachments_by_message(
            session=session,
            message_ids=[item.id for item in messages],
        )
        read_rows = list(
            session.execute(
                select(ChatMessageRead).where(
                    ChatMessageRead.conversation_id == conversation.id,
                    ChatMessageRead.message_id.in_([item.id for item in messages]),
                    ChatMessageRead.user_id.in_(member_ids),
                )
            ).scalars()
        ) if messages and member_ids else []
        states_by_user_id = {int(item.user_id): item for item in states}
        viewer_state = states_by_user_id.get(int(current_user_id))
        reads_by_message_id: dict[str, list[ChatMessageRead]] = {}
        for item in read_rows:
            reads_by_message_id.setdefault(item.message_id, []).append(item)
        participant_ids = {int(item) for item in member_ids if int(item) > 0}
        presence_map = self._get_presence_map(user_ids=participant_ids)
        users_by_id = self._get_users_map(presence_map=presence_map, user_ids=participant_ids)
        reply_previews = self._build_reply_previews(
            session=session,
            reply_to_message_ids=[
                _normalize_text(getattr(item, "reply_to_message_id", None))
                for item in messages
            ],
            users_by_id=users_by_id,
        )
        forward_previews = self._build_forward_previews(
            session=session,
            forward_from_message_ids=[
                _normalize_text(getattr(item, "forward_from_message_id", None))
                for item in messages
            ],
        )
        return {
            "items": [
                self._serialize_message(
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
            "viewer_last_read_at": _iso(getattr(viewer_state, "last_read_at", None)),
        }

    def _require_active_user(self, user_id: int) -> dict:
        raw = user_service.get_by_id(int(user_id))
        if not raw:
            raise LookupError("User not found")
        if not bool(raw.get("is_active", True)):
            raise ValueError("User is inactive")
        return user_service.to_public_user(raw)

    def _conversation_member_ids(self, session, conversation_id: str) -> list[int]:
        rows = session.execute(
            select(ChatMember.user_id).where(
                ChatMember.conversation_id == _normalize_text(conversation_id),
                ChatMember.left_at.is_(None),
            )
        ).scalars()
        return sorted({int(item) for item in rows if int(item) > 0})

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
        valid_uploads = [item for item in list(uploads or []) if item is not None]
        if not valid_uploads:
            raise ValueError("At least one file is required")
        if len(valid_uploads) > CHAT_MAX_FILES_PER_MESSAGE:
            raise ValueError(f"You can upload at most {CHAT_MAX_FILES_PER_MESSAGE} files at a time")
        normalized_files_meta = list(files_meta or [])
        if normalized_files_meta and len(normalized_files_meta) != len(valid_uploads):
            raise ValueError("files_meta_json length must match files length")

        conversation_dir = self._attachments_root / _normalize_text(conversation_id)
        conversation_dir.mkdir(parents=True, exist_ok=True)

        prepared = []
        written_paths: list[Path] = []
        total_size = 0
        try:
            for index, upload in enumerate(valid_uploads):
                transfer_meta = self._normalize_upload_transfer_meta(
                    normalized_files_meta[index] if index < len(normalized_files_meta) else {}
                )
                transfer_encoding = transfer_meta["transfer_encoding"]
                expected_original_size = transfer_meta["original_size"]
                if transfer_encoding == "gzip" and expected_original_size is None:
                    raise ValueError("original_size is required for gzip uploads")

                file_name = _safe_file_name(getattr(upload, "filename", None) or "file.bin")
                mime_type = self._normalize_mime_type(
                    getattr(upload, "content_type", None),
                    file_name=file_name,
                )
                self._ensure_supported_upload_type(file_name=file_name, mime_type=mime_type)

                attachment_id = str(uuid4())
                storage_name = f"{attachment_id}_{file_name}"
                final_path = conversation_dir / storage_name
                temp_path = conversation_dir / f"{storage_name}.part"

                try:
                    upload.file.seek(0)
                except Exception:
                    pass

                try:
                    file_size, probe_bytes, total_size = self._write_decoded_transfer_payload(
                        source_stream=upload.file,
                        target_path=temp_path,
                        transfer_encoding=transfer_encoding,
                        expected_original_size=expected_original_size,
                        total_size=total_size,
                    )
                    if file_size <= 0:
                        raise ValueError(f"File is empty: {file_name}")

                    width, height = _probe_image_dimensions(probe_bytes, mime_type)
                    logger.info(
                        "chat.upload_probe file=%s mime_type=%s size=%d width=%s height=%s",
                        file_name,
                        mime_type,
                        file_size,
                        width,
                        height,
                    )
                    temp_path.replace(final_path)
                    written_paths.append(final_path)
                    prepared.append(
                        {
                            "attachment_id": attachment_id,
                            "file_name": file_name,
                            "mime_type": mime_type,
                            "file_size": file_size,
                            "width": width,
                            "height": height,
                            "storage_name": storage_name,
                            "path": final_path,
                        }
                    )
                except Exception:
                    try:
                        temp_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    raise
            return prepared
        except Exception:
            for path in written_paths:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
            raise

    def _normalize_mime_type(self, raw_value: object, *, file_name: str) -> str:
        value = _normalize_text(raw_value).lower()
        if value and value != "application/octet-stream":
            return value
        guessed, _ = mimetypes.guess_type(file_name)
        return _normalize_text(guessed).lower() or "application/octet-stream"

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
        return (
            f"/api/v1/chat/messages/{message_id}/attachments/{attachment_id}/file"
            f"?inline=1&variant={variant}"
        )

    def _build_attachment_variant_urls(self, attachment: ChatMessageAttachment) -> dict[str, str]:
        mime_type = _normalize_text(getattr(attachment, "mime_type", None)).lower()
        message_id = _normalize_text(getattr(attachment, "message_id", None))
        attachment_id = _normalize_text(getattr(attachment, "id", None))
        if not message_id or not attachment_id:
            return {}
        if mime_type.startswith("image/"):
            return {
                "thumb": self._build_attachment_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="thumb",
                ),
                "preview": self._build_attachment_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="preview",
                ),
            }
        if mime_type.startswith("video/"):
            return {
                "poster": self._build_attachment_variant_url(
                    message_id=message_id,
                    attachment_id=attachment_id,
                    variant="poster",
                ),
            }
        return {}

    def _resolve_attachment_variant_path(self, *, conversation_id: str, attachment_id: str, variant: str) -> Path:
        variants_dir = (self._attachments_root / _normalize_text(conversation_id) / ".variants").resolve()
        variants_dir.mkdir(parents=True, exist_ok=True)
        file_path = (variants_dir / f"{Path(_normalize_text(attachment_id)).name}-{_normalize_text(variant)}.png").resolve()
        try:
            file_path.relative_to(self._attachments_root.resolve())
        except ValueError as exc:
            raise ValueError("Invalid attachment variant path") from exc
        return file_path

    def _ensure_image_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        source_path: Path,
        variant: str,
    ) -> dict[str, str]:
        max_dimension = int(_CHAT_ATTACHMENT_VARIANT_MAX_DIMENSIONS.get(variant, _CHAT_ATTACHMENT_VARIANT_MAX_DIMENSIONS["preview"]))
        variant_path = self._resolve_attachment_variant_path(
            conversation_id=conversation_id,
            attachment_id=attachment.id,
            variant=variant,
        )
        if variant_path.exists() and variant_path.is_file():
            logger.info("chat.media_variant attachment_id=%s variant=%s hit=1", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }

        try:
            with Image.open(source_path) as image:
                image = ImageOps.exif_transpose(image)
                resample = getattr(Image, "Resampling", Image).LANCZOS
                image.thumbnail((max_dimension, max_dimension), resample)
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                image.save(variant_path, format="PNG", optimize=True)
            logger.info("chat.media_variant attachment_id=%s variant=%s hit=0 created", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }
        except Exception as exc:
            logger.error(
                "chat.media_variant_error attachment_id=%s variant=%s conversation_id=%s error=%s",
                attachment.id,
                variant,
                conversation_id,
                str(exc),
                exc_info=True,
            )
            # Delete corrupted variant file if it exists
            try:
                if variant_path.exists():
                    variant_path.unlink()
            except Exception:
                pass
            raise

    def _ensure_video_poster_variant(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
    ) -> dict[str, str]:
        variant = "poster"
        variant_path = self._resolve_attachment_variant_path(
            conversation_id=conversation_id,
            attachment_id=attachment.id,
            variant=variant,
        )
        if variant_path.exists() and variant_path.is_file():
            logger.info("chat.media_variant attachment_id=%s variant=%s hit=1", attachment.id, variant)
            return {
                "path": str(variant_path),
                "file_name": variant_path.name,
                "mime_type": "image/png",
            }

        width = max(320, int(getattr(attachment, "width", 0) or 0) or 720)
        height = max(180, int(getattr(attachment, "height", 0) or 0) or int(round(width * 9 / 16)))
        canvas = Image.new("RGBA", (width, height), "#0f172a")
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((0, 0, width, height), radius=max(18, width // 18), fill="#0f172a")
        draw.rounded_rectangle(
            (max(12, width // 28), max(12, height // 28), width - max(12, width // 28), height - max(12, height // 28)),
            radius=max(14, width // 22),
            outline="#475569",
            width=max(2, width // 240),
        )
        triangle_width = max(44, width // 7)
        triangle_height = max(52, height // 5)
        center_x = width // 2
        center_y = height // 2
        draw.polygon(
            [
                (center_x - triangle_width // 3, center_y - triangle_height // 2),
                (center_x - triangle_width // 3, center_y + triangle_height // 2),
                (center_x + triangle_width // 2, center_y),
            ],
            fill="#e2e8f0",
        )
        canvas.save(variant_path, format="PNG", optimize=True)
        logger.info("chat.media_variant attachment_id=%s variant=%s hit=0", attachment.id, variant)
        return {
            "path": str(variant_path),
            "file_name": variant_path.name,
            "mime_type": "image/png",
        }

    def _attachment_to_payload(self, attachment: ChatMessageAttachment) -> dict:
        return {
            "id": attachment.id,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "variant_urls": self._build_attachment_variant_urls(attachment),
            "created_at": _iso(attachment.created_at) or "",
        }

    @staticmethod
    def _get_attachment_kind(mime_type: object) -> str:
        normalized_mime_type = _normalize_text(mime_type).lower()
        if normalized_mime_type.startswith("image/"):
            return "image"
        if normalized_mime_type.startswith("video/"):
            return "video"
        if normalized_mime_type.startswith("audio/"):
            return "audio"
        return "file"

    def _normalize_attachment_kind_filter(self, value: object) -> str:
        normalized = _normalize_text(value).lower()
        if normalized in {"image", "video", "file", "audio"}:
            return normalized
        raise ValueError("Attachment kind must be one of: image, video, file, audio")

    def _apply_attachment_kind_filter(self, *, query, kind: str):
        if kind == "image":
            return query.where(ChatMessageAttachment.mime_type.like("image/%"))
        if kind == "video":
            return query.where(ChatMessageAttachment.mime_type.like("video/%"))
        if kind == "audio":
            return query.where(ChatMessageAttachment.mime_type.like("audio/%"))
        return query.where(
            or_(
                ChatMessageAttachment.mime_type.is_(None),
                and_(
                    ChatMessageAttachment.mime_type.not_like("image/%"),
                    ChatMessageAttachment.mime_type.not_like("video/%"),
                    ChatMessageAttachment.mime_type.not_like("audio/%"),
                ),
            )
        )

    def _conversation_attachment_to_payload(self, attachment: ChatMessageAttachment, *, kind: Optional[str] = None) -> dict:
        resolved_kind = kind or self._get_attachment_kind(attachment.mime_type)
        return {
            "id": attachment.id,
            "message_id": attachment.message_id,
            "kind": resolved_kind,
            "file_name": attachment.file_name,
            "mime_type": _normalize_text(attachment.mime_type) or None,
            "file_size": int(attachment.file_size or 0),
            "width": int(attachment.width) if attachment.width is not None else None,
            "height": int(attachment.height) if attachment.height is not None else None,
            "variant_urls": self._build_attachment_variant_urls(attachment),
            "created_at": _iso(attachment.created_at) or "",
        }

    def _resolve_attachment_path(self, *, conversation_id: str, storage_name: str) -> Path:
        file_path = (self._attachments_root / _normalize_text(conversation_id) / Path(_normalize_text(storage_name)).name).resolve()
        try:
            file_path.relative_to(self._attachments_root.resolve())
        except ValueError as exc:
            raise ValueError("Invalid attachment path") from exc
        return file_path

    def _repair_gzipped_image_attachment_if_needed(
        self,
        *,
        session,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        file_path: Path,
    ) -> Path:
        mime_type = _normalize_text(getattr(attachment, "mime_type", None)).lower()
        if not mime_type.startswith("image/"):
            return file_path
        if not file_path.exists() or not file_path.is_file():
            return file_path

        try:
            with file_path.open("rb") as source:
                header = source.read(3)
        except OSError:
            return file_path

        if header != b"\x1f\x8b\x08":
            return file_path

        temp_path = file_path.with_name(f"{file_path.name}.{uuid4().hex}.repair")
        try:
            compressed_payload = file_path.read_bytes()
            decoded_payload = gzip.decompress(compressed_payload)
            with Image.open(io.BytesIO(decoded_payload)) as image:
                validated_image = ImageOps.exif_transpose(image)
                try:
                    validated_image.load()
                    width = int(validated_image.size[0])
                    height = int(validated_image.size[1])
                finally:
                    if validated_image is not image:
                        validated_image.close()

            with temp_path.open("wb") as target:
                target.write(decoded_payload)
            temp_path.replace(file_path)

            attachment.file_size = len(decoded_payload)
            attachment.width = width if width > 0 else None
            attachment.height = height if height > 0 else None
            session.add(attachment)
            logger.warning(
                "chat.attachment_storage_repaired attachment_id=%s conversation_id=%s bytes=%d width=%s height=%s",
                attachment.id,
                conversation_id,
                len(decoded_payload),
                attachment.width,
                attachment.height,
            )
        except (OSError, EOFError, gzip.BadGzipFile, UnidentifiedImageError):
            logger.exception(
                "chat.attachment_storage_repair_failed attachment_id=%s conversation_id=%s",
                getattr(attachment, "id", ""),
                conversation_id,
            )
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass
        return file_path

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
        state = session.execute(
            select(ChatConversationUserState).where(
                ChatConversationUserState.conversation_id == conversation_id,
                ChatConversationUserState.user_id == int(current_user_id),
            )
        ).scalar_one_or_none()
        if state is None:
            state = ChatConversationUserState(
                conversation_id=conversation_id,
                user_id=int(current_user_id),
            )
            session.add(state)
        state.last_read_message_id = _normalize_text(message_id)
        state.last_read_seq = max(0, int(conversation_seq or 0))
        state.last_read_at = seen_at
        state.unread_count = 0
        state.opened_at = seen_at
        state.updated_at = seen_at

    def _increment_unread_counters_for_recipients(
        self,
        *,
        session,
        conversation_id: str,
        sender_user_id: int,
        member_user_ids: list[int],
        seen_at: datetime,
    ) -> None:
        for member_user_id in list(member_user_ids or []):
            normalized_member_user_id = int(member_user_id)
            if normalized_member_user_id <= 0 or normalized_member_user_id == int(sender_user_id):
                continue
            state = self._get_or_create_conversation_state(
                session=session,
                conversation_id=conversation_id,
                current_user_id=normalized_member_user_id,
            )
            state.updated_at = seen_at
            state.unread_count = max(0, int(state.unread_count or 0) + 1)

    def _find_existing_client_message(
        self,
        *,
        session,
        conversation_id: str,
        current_user_id: int,
        client_message_id: str,
    ) -> ChatMessage | None:
        normalized_client_message_id = _normalize_text(client_message_id)
        if not normalized_client_message_id:
            return None
        return session.execute(
            select(ChatMessage).where(
                ChatMessage.conversation_id == _normalize_text(conversation_id),
                ChatMessage.sender_user_id == int(current_user_id),
                ChatMessage.client_message_id == normalized_client_message_id,
            )
        ).scalar_one_or_none()

    def _build_message_payload_for_members(
        self,
        *,
        session,
        conversation: ChatConversation,
        message: ChatMessage,
        current_user_id: int,
        member_user_ids: list[int],
    ) -> dict[str, Any]:
        payload_user_ids = self._collect_message_payload_user_ids(
            session=session,
            message=message,
            current_user_id=int(current_user_id),
        )
        presence_map = self._get_presence_map(user_ids=payload_user_ids)
        users_by_id = self._get_users_map(presence_map=presence_map, user_ids=payload_user_ids)
        return self._serialize_message(
            conversation_kind=conversation.kind,
            message=message,
            current_user_id=int(current_user_id),
            users_by_id=users_by_id,
            member_ids=member_user_ids,
            reply_previews=self._build_reply_previews(
                session=session,
                reply_to_message_ids=[getattr(message, "reply_to_message_id", None)],
                users_by_id=users_by_id,
            ),
            forward_previews=self._build_forward_previews(
                session=session,
                forward_from_message_ids=[getattr(message, "forward_from_message_id", None)],
            ),
        )

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
    ) -> bool:
        normalized_channel = _normalize_text(channel) or "chat"
        existing = session.execute(
            select(ChatPushOutbox).where(
                ChatPushOutbox.message_id == _normalize_text(message_id),
                ChatPushOutbox.recipient_user_id == int(recipient_user_id),
                ChatPushOutbox.channel == normalized_channel,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return False
        session.add(
            ChatPushOutbox(
                message_id=_normalize_text(message_id),
                conversation_id=_normalize_text(conversation_id),
                recipient_user_id=int(recipient_user_id),
                channel=normalized_channel,
                title=_normalize_text(title) or "Новое сообщение в чате",
                body=_normalize_text(body) or "Откройте чат, чтобы посмотреть сообщение.",
                status="queued",
                attempt_count=0,
                next_attempt_at=now,
                last_error=None,
                created_at=now,
                updated_at=now,
            )
        )
        return True

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
        started_at = time.perf_counter()
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        stats: dict[str, Any] = {
            "member_count": 0,
            "recipient_count": 0,
            "hub_count": 0,
            "push_count": 0,
            "prep_ms": 0.0,
            "users_map_ms": 0.0,
            "loop_ms": 0.0,
            "hub_notifications_ms": 0.0,
            "push_notifications_ms": 0.0,
        }
        if not normalized_conversation_id or not normalized_message_id:
            return stats
        mentioned_user_id_set = {
            int(item)
            for item in list(mentioned_user_ids or [])
            if int(item) > 0 and int(item) != int(sender_user_id)
        }

        member_ids: list[int] = []
        try:
            with chat_session() as session:
                stage_started_at = time.perf_counter()
                conversation = self._require_membership(
                    session=session,
                    conversation_id=normalized_conversation_id,
                    current_user_id=int(sender_user_id),
                )
                member_ids = self._conversation_member_ids(session, normalized_conversation_id)
                states = list(
                    session.execute(
                        select(ChatConversationUserState).where(
                            ChatConversationUserState.conversation_id == conversation.id,
                            ChatConversationUserState.user_id.in_(member_ids),
                        )
                    ).scalars()
                ) if member_ids else []
                states_by_user_id = {int(item.user_id): item for item in states}
                stats["prep_ms"] = round((time.perf_counter() - stage_started_at) * 1000.0, 1)
                stats["member_count"] = len(member_ids)

                stage_started_at = time.perf_counter()
                users_by_id = user_service.get_users_map_by_ids([int(sender_user_id)])
                stats["users_map_ms"] = round((time.perf_counter() - stage_started_at) * 1000.0, 1)
                sender = users_by_id.get(int(sender_user_id)) or {}
                sender_name = _normalize_text(sender.get("full_name")) or _normalize_text(sender.get("username")) or "Коллега"
                base_title = _normalize_text(title) or "Новое сообщение в чате"
                base_body = _normalize_text(body)
                outbox_now = _utc_now()

                loop_started_at = time.perf_counter()
                with ExitStack() as exit_stack:
                    hub_conn = None
                    hub_lock = getattr(hub_service, "_lock", None)
                    hub_connect = getattr(hub_service, "_connect", None)
                    if hub_lock is not None:
                        exit_stack.enter_context(hub_lock)
                    if callable(hub_connect):
                        try:
                            hub_conn = exit_stack.enter_context(hub_connect())
                        except Exception:
                            hub_conn = None

                    for member_id in member_ids:
                        if int(member_id) <= 0 or int(member_id) == int(sender_user_id):
                            continue
                        is_mentioned = int(member_id) in mentioned_user_id_set
                        state = states_by_user_id.get(int(member_id))
                        if (
                            not is_mentioned
                            and (
                                bool(getattr(state, "is_muted", False))
                                or bool(getattr(state, "is_archived", False))
                            )
                        ):
                            continue
                        stats["recipient_count"] += 1

                        current_body = base_body
                        current_event_type = _normalize_text(event_type)
                        if conversation.kind == "direct":
                            current_title = sender_name
                            if base_title and base_title != "Новое сообщение в чате":
                                current_body = f"[{base_title}] {base_body}"
                        else:
                            group_title = _normalize_text(conversation.title) or "Групповой чат"
                            current_title = group_title
                            prefix = f"[{base_title}] " if base_title and base_title != "Новое сообщение в чате" else ""
                            current_body = f"{prefix}{sender_name}: {base_body}"

                        if is_mentioned:
                            current_event_type = "chat.mention"
                            mention_prefix = "Р’Р°СЃ СѓРїРѕРјСЏРЅСѓР»Рё"
                            if conversation.kind == "direct":
                                current_title = sender_name
                                current_body = f"[{mention_prefix}] {base_body}"
                            else:
                                current_title = f"{mention_prefix}: {current_title}"
                                current_body = f"{sender_name}: {base_body}"

                        try:
                            notification_started_at = time.perf_counter()
                            hub_service._create_notification(
                                recipient_user_id=int(member_id),
                                event_type=current_event_type,
                                title=current_title,
                                body=current_body,
                                entity_type="chat",
                                entity_id=normalized_conversation_id,
                                conn=hub_conn,
                            )
                            stats["hub_notifications_ms"] = round(
                                float(stats["hub_notifications_ms"]) + ((time.perf_counter() - notification_started_at) * 1000.0),
                                1,
                            )
                            stats["hub_count"] += 1
                        except Exception:
                            continue

                        if defer_push_notifications:
                            if self._upsert_chat_push_outbox_job(
                                session=session,
                                recipient_user_id=int(member_id),
                                conversation_id=normalized_conversation_id,
                                message_id=normalized_message_id,
                                channel="chat",
                                title=current_title,
                                body=current_body,
                                now=outbox_now,
                            ):
                                stats["push_count"] += 1
                            continue

                        try:
                            push_started_at = time.perf_counter()
                            chat_push_service.send_chat_message_notification(
                                recipient_user_id=int(member_id),
                                conversation_id=normalized_conversation_id,
                                message_id=normalized_message_id,
                                title=current_title,
                                body=current_body,
                            )
                            stats["push_notifications_ms"] = round(
                                float(stats["push_notifications_ms"]) + ((time.perf_counter() - push_started_at) * 1000.0),
                                1,
                            )
                            stats["push_count"] += 1
                        except Exception:
                            continue
                stats["loop_ms"] = round((time.perf_counter() - loop_started_at) * 1000.0, 1)
        except Exception:
            stats["prep_ms"] = round((time.perf_counter() - started_at) * 1000.0, 1)
            _log_chat_service_timing(
                "create_chat_notifications",
                started_at,
                sender_user_id=int(sender_user_id),
                conversation_id=normalized_conversation_id,
                message_id=normalized_message_id,
                prep_ms=stats["prep_ms"],
                failed=1,
            )
            return stats
        _log_chat_service_timing(
            "create_chat_notifications",
            started_at,
            sender_user_id=int(sender_user_id),
            conversation_id=normalized_conversation_id,
            message_id=normalized_message_id,
            member_count=stats["member_count"],
            recipient_count=stats["recipient_count"],
            hub_count=stats["hub_count"],
            push_count=stats["push_count"],
            push_deferred=int(bool(defer_push_notifications)),
            prep_ms=stats["prep_ms"],
            users_map_ms=stats["users_map_ms"],
            loop_ms=stats["loop_ms"],
            hub_notifications_ms=stats["hub_notifications_ms"],
            push_notifications_ms=stats["push_notifications_ms"],
        )
        return stats

    def _get_presence_map(self, *, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, dict]:
        now = _utc_now()
        result: dict[int, dict] = {}
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        try:
            sessions = (
                session_service.list_sessions_by_user_ids(normalized_user_ids, active_only=False)
                if normalized_user_ids
                else session_service.list_sessions(active_only=False)
            )
        except Exception:
            sessions = []
        try:
            from backend.chat.realtime import get_chat_presence_snapshot, get_chat_socket_last_seen

            presence_snapshot = dict(get_chat_presence_snapshot(normalized_user_ids or None) or {})
        except Exception:
            presence_snapshot = {}
            get_chat_socket_last_seen = lambda _user_id: None  # type: ignore[assignment]
        connected_user_ids = {int(user_id) for user_id in presence_snapshot.keys() if int(user_id) > 0}

        for item in list(sessions or []):
            user_id = int(item.get("user_id", 0) or 0)
            if user_id <= 0:
                continue
            if normalized_user_ids and user_id not in normalized_user_ids:
                continue
            last_seen_at = _parse_dt(item.get("last_seen_at"))
            is_session_online = str(item.get("status") or "").strip().lower() == "active"
            current = result.get(user_id)
            if current is None:
                result[user_id] = {
                    "is_online": bool(
                        user_id in connected_user_ids
                        or (is_session_online and last_seen_at and (now - last_seen_at) <= CHAT_PRESENCE_ONLINE_WINDOW)
                    ),
                    "last_seen_at": max(filter(None, [last_seen_at, presence_snapshot.get(user_id)]), default=None),
                }
                continue

            current_last_seen = current.get("last_seen_at")
            if last_seen_at and (current_last_seen is None or last_seen_at > current_last_seen):
                current["last_seen_at"] = last_seen_at
            snapshot_last_seen = presence_snapshot.get(user_id)
            if snapshot_last_seen and (current.get("last_seen_at") is None or snapshot_last_seen > current.get("last_seen_at")):
                current["last_seen_at"] = snapshot_last_seen
            if user_id in connected_user_ids or (is_session_online and last_seen_at and (now - last_seen_at) <= CHAT_PRESENCE_ONLINE_WINDOW):
                current["is_online"] = True

        if normalized_user_ids:
            connected_user_ids = {int(item) for item in connected_user_ids if int(item) in normalized_user_ids}

        for user_id in connected_user_ids:
            result.setdefault(
                int(user_id),
                {
                    "is_online": True,
                    "last_seen_at": presence_snapshot.get(int(user_id)) or get_chat_socket_last_seen(int(user_id)),
                },
            )

        for user_id, payload in list(result.items()):
            socket_last_seen = get_chat_socket_last_seen(int(user_id))
            current_last_seen = payload.get("last_seen_at")
            if socket_last_seen and (current_last_seen is None or socket_last_seen > current_last_seen):
                payload["last_seen_at"] = socket_last_seen
            if int(user_id) in connected_user_ids:
                payload["is_online"] = True

        return {
            user_id: self._build_presence_payload(
                is_online=bool(payload.get("is_online")),
                last_seen_at=payload.get("last_seen_at"),
                now=now,
            )
            for user_id, payload in result.items()
        }

    def _build_presence_payload(
        self,
        *,
        is_online: bool,
        last_seen_at: Optional[datetime],
        now: Optional[datetime] = None,
    ) -> dict:
        now = now or _utc_now()
        if is_online:
            return {
                "is_online": True,
                "last_seen_at": _iso(last_seen_at),
                "status_text": "В сети",
            }

        if last_seen_at is None:
            return {
                "is_online": False,
                "last_seen_at": None,
                "status_text": "Не в сети",
            }

        delta_seconds = max(0, int((now - last_seen_at).total_seconds()))
        if delta_seconds < 60:
            status_text = "Был(а) только что"
        elif delta_seconds < 60 * 60:
            minutes = max(1, delta_seconds // 60)
            status_text = f"Был(а) {minutes} мин назад"
        else:
            local_dt = last_seen_at.astimezone()
            local_now = now.astimezone()
            if local_dt.date() == local_now.date():
                status_text = f"Сегодня в {local_dt.strftime('%H:%M')}"
            elif local_dt.date() == (local_now.date() - timedelta(days=1)):
                status_text = f"Вчера в {local_dt.strftime('%H:%M')}"
            else:
                status_text = local_dt.strftime("%d.%m.%Y %H:%M")
        return {
            "is_online": False,
            "last_seen_at": _iso(last_seen_at),
            "status_text": status_text,
        }

    def _build_message_read_receipts(
        self,
        *,
        message: ChatMessage,
        reader_user_ids: list[int],
        states_by_user_id: dict[int, ChatConversationUserState],
        reads_by_user_id: dict[int, ChatMessageRead],
    ) -> list[dict]:
        items = []
        for user_id in list(reader_user_ids or []):
            read_at = None
            exact_read = reads_by_user_id.get(int(user_id))
            if exact_read is not None and exact_read.read_at is not None:
                read_at = exact_read.read_at
            else:
                state = states_by_user_id.get(int(user_id))
                last_read_seq = int(getattr(state, "last_read_seq", 0) or 0)
                message_seq = int(getattr(message, "conversation_seq", 0) or 0)
                if last_read_seq > 0 and message_seq > 0 and last_read_seq >= message_seq:
                    read_at = getattr(state, "last_read_at", None)
                if read_at is not None:
                    items.append({"user_id": int(user_id), "read_at": read_at})
                    continue
                last_read_at = getattr(state, "last_read_at", None)
                if last_read_at is not None and last_read_at >= message.created_at:
                    read_at = last_read_at
            if read_at is None:
                continue
            items.append({"user_id": int(user_id), "read_at": read_at})
        items.sort(key=lambda item: item["read_at"])
        return items

    def _get_users_map(
        self,
        *,
        presence_map: Optional[dict[int, dict]] = None,
        user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None,
    ) -> dict[int, dict]:
        result = {}
        normalized_user_ids = {
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        }
        source_users = (
            user_service.get_users_map_by_ids(normalized_user_ids).values()
            if normalized_user_ids
            else user_service.list_users()
        )
        for item in source_users:
            user_id = int(item.get("id", 0) or 0)
            if user_id <= 0:
                continue
            if normalized_user_ids and user_id not in normalized_user_ids:
                continue
            result[user_id] = self._serialize_user(item, presence_map=presence_map)
        return result

    def _serialize_user(self, item: dict, *, presence_map: Optional[dict[int, dict]] = None) -> dict:
        user_id = int(item.get("id", 0) or 0)
        return {
            "id": user_id,
            "username": _normalize_text(item.get("username")),
            "full_name": _normalize_text(item.get("full_name")) or None,
            "role": _normalize_text(item.get("role")) or "viewer",
            "is_active": bool(item.get("is_active", True)),
            "presence": dict((presence_map or {}).get(user_id) or self._build_presence_payload(is_online=False, last_seen_at=None)),
        }

    def _mask_database_url(self, value: str) -> str:
        text = _normalize_text(value)
        if not text:
            return ""
        if "@" not in text:
            return text
        prefix, suffix = text.rsplit("@", 1)
        if "://" in prefix:
            scheme, remainder = prefix.split("://", 1)
            if ":" in remainder:
                user_part, _password = remainder.split(":", 1)
                return f"{scheme}://{user_part}:***@{suffix}"
        return f"***@{suffix}"

    def _ensure_available(self) -> None:
        status = self.initialize_runtime(force=not bool(self._runtime_status and self._runtime_status.available))
        if not status.enabled:
            raise ChatConfigurationError("Chat module is disabled")
        if not status.configured:
            raise ChatConfigurationError("CHAT_DATABASE_URL is not configured")
        if not status.available:
            raise ChatConfigurationError("Chat database is unavailable")


chat_service = ChatService()
