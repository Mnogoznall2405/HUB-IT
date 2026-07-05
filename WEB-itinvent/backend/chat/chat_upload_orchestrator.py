"""Upload session and inline file send orchestration."""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import and_, func, or_, select

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
import asyncio
import gzip
import json
import logging
import mimetypes
import os
import shutil
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from backend.chat.chat_constants import (
    CHAT_ALLOWED_EXTENSIONS,
    CHAT_ALLOWED_MIME_PREFIXES,
    CHAT_ALLOWED_MIME_TYPES,
    CHAT_ALLOWED_TRANSFER_ENCODINGS,
    CHAT_ARCHIVE_EXTENSIONS,
    CHAT_ARCHIVE_MIME_TYPES,
    CHAT_MAX_FILES_PER_MESSAGE,
    CHAT_MAX_MESSAGE_BODY_LENGTH,
    CHAT_MAX_TOTAL_FILE_BYTES,
)
from backend.chat.chat_formatting import _iso, _probe_image_dimensions, _probe_video_dimensions, _safe_file_name, _utc_now
from backend.chat.upload_session_transfer import plan_upload_session_chunk
from backend.chat.utils import normalize_text as _normalize_text

logger = logging.getLogger("backend.chat.service")

if TYPE_CHECKING:
    from backend.chat.service import ChatService


class ChatUploadOrchestrator:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _upload_session_dir(self, session_id: str) -> Path:
        return self._service._upload_sessions.session_dir(session_id)

    def _upload_session_manifest_path(self, session_id: str) -> Path:
        return self._service._upload_sessions.manifest_path(session_id)

    def _upload_session_part_path(self, session_id: str, file_id: str) -> Path:
        return self._service._upload_sessions.part_path(session_id, file_id)

    def _normalize_transfer_encoding(self, value: object) -> str:
        normalized = _normalize_text(value, "identity").lower()
        if normalized not in CHAT_ALLOWED_TRANSFER_ENCODINGS:
            raise ValueError(f"Unsupported transfer encoding: {normalized or 'unknown'}")
        return normalized

    def _serialize_upload_session_file(self, file_payload: dict[str, Any]) -> dict[str, Any]:
        return self._service._upload_sessions.serialize_file(file_payload)

    def _serialize_upload_session(self, manifest: dict[str, Any]) -> dict[str, Any]:
        return self._service._upload_sessions.serialize_manifest(manifest)

    def create_upload_session(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        files: list[dict[str, Any]],
        body: Optional[str] = None,
        reply_to_message_id: Optional[str] = None,
    ) -> dict[str, Any]:
        
        self._service._maybe_cleanup_upload_sessions()
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
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            normalized_conversation_id = conversation.id
            reply_to_message = self._service._resolve_reply_message(
                session=session,
                conversation_id=conversation.id,
                reply_to_message_id=reply_to_message_id,
            )
            normalized_reply_to_message_id = getattr(reply_to_message, "id", None)
            for item in file_items:
                prepared_item = self._service._build_upload_session_file_manifest(
                    file_name=_normalize_text(item.get("file_name")) or "file.bin",
                    mime_type=_normalize_text(item.get("mime_type")),
                    size=int(item.get("size", 0) or 0),
                    original_size=int(item.get("original_size", 0) or 0),
                    transfer_encoding=_normalize_text(item.get("transfer_encoding"), "identity"),
                    media_kind=item.get("media_kind"),
                    duration_seconds=item.get("duration_seconds"),
                )
                total_size += int(prepared_item["original_size"])
                if total_size > CHAT_MAX_TOTAL_FILE_BYTES:
                    raise ValueError("Total upload size exceeds 1 GB")
                prepared_files.append(prepared_item)

        session_id = str(uuid4())
        now = _utc_now()
        manifest = {
            "session_id": session_id,
            "conversation_id": normalized_conversation_id,
            "current_user_id": int(current_user_id),
            "body": normalized_body,
            "reply_to_message_id": normalized_reply_to_message_id,
            "chunk_size_bytes": self._service.upload_session_chunk_size_bytes,
            "created_at": _iso(now) or "",
            "updated_at": _iso(now) or "",
            "expires_at": _iso(now + timedelta(seconds=self._service.upload_session_ttl_sec)) or "",
            "status": "pending",
            "message_id": "",
            "files": prepared_files,
        }
        self._service._write_upload_session_manifest(manifest)
        return self._service._serialize_upload_session(manifest)

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
        self._service._maybe_cleanup_upload_sessions()
        normalized_payload = bytes(payload or b"")

        lock = self._service._get_upload_session_lock(session_id)
        with lock:
            manifest = self._service._load_upload_session_manifest(session_id)
            self._service._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            self._service._ensure_upload_session_active(manifest)
            if _normalize_text(manifest.get("status")).lower() == "completed":
                raise ValueError("Upload session is already completed")

            file_payload = self._service._find_upload_session_file(manifest, file_id=file_id)
            chunk_plan = plan_upload_session_chunk(
                file_payload=file_payload,
                chunk_index=int(chunk_index),
                offset=int(offset),
                payload_size=len(normalized_payload),
                chunk_size_bytes=self._service.upload_session_chunk_size_bytes,
            )
            if chunk_plan.already_present:
                return {
                    "session_id": _normalize_text(manifest.get("session_id")),
                    "file_id": chunk_plan.file_id,
                    "chunk_index": chunk_plan.chunk_index,
                    "already_present": True,
                    "received_bytes": chunk_plan.received_bytes,
                    "received_chunks": chunk_plan.received_chunks,
                    "file_complete": chunk_plan.file_complete,
                }

            part_path = self._upload_session_part_path(session_id, _normalize_text(file_payload.get("file_id")))
            part_path.parent.mkdir(parents=True, exist_ok=True)
            with part_path.open("ab") as target:
                target.write(normalized_payload)

            file_payload["received_bytes"] = chunk_plan.next_received_bytes
            file_payload["received_chunks"] = chunk_plan.next_received_chunks
            now = _utc_now()
            manifest["updated_at"] = _iso(now) or ""
            manifest["expires_at"] = _iso(now + timedelta(seconds=self._service.upload_session_ttl_sec)) or ""
            self._service._write_upload_session_manifest(manifest)
            return {
                "session_id": _normalize_text(manifest.get("session_id")),
                "file_id": chunk_plan.file_id,
                "chunk_index": chunk_plan.chunk_index,
                "already_present": False,
                "received_bytes": chunk_plan.next_received_bytes,
                "received_chunks": list(file_payload.get("received_chunks") or []),
                "file_complete": chunk_plan.file_complete,
            }

    def complete_upload_session(
        self,
        *,
        current_user_id: int,
        session_id: str,
        defer_push_notifications: bool = False,
    ) -> dict[str, Any]:
        
        self._service._maybe_cleanup_upload_sessions()
        lock = self._service._get_upload_session_lock(session_id)
        with lock:
            manifest = self._service._load_upload_session_manifest(session_id)
            self._service._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            self._service._ensure_upload_session_active(manifest)
            if _normalize_text(manifest.get("status")).lower() == "completed":
                message_id = _normalize_text(manifest.get("message_id"))
                if message_id:
                    self._service._set_request_meta(upload_session_completed_now=False)
                    return self._service.get_message(current_user_id=int(current_user_id), message_id=message_id)

            with chat_session() as session:
                existing_message_id = self._service._find_existing_upload_session_message_id(session=session, manifest=manifest)
            if existing_message_id:
                manifest["status"] = "completed"
                manifest["message_id"] = existing_message_id
                manifest["updated_at"] = _iso(_utc_now()) or ""
                self._service._write_upload_session_manifest(manifest)
                self._service._set_request_meta(upload_session_completed_now=False)
                return self._service.get_message(current_user_id=int(current_user_id), message_id=existing_message_id)

            conversation_id = _normalize_text(manifest.get("conversation_id"))
            with self._service._upload_session_completion.materialize(manifest) as prepared:
                persisted_file = self._service._file_message_persistence.persist_file_message(
                    current_user_id=int(current_user_id),
                    conversation_id=conversation_id,
                    body=_normalize_text(manifest.get("body")),
                    prepared=prepared,
                    reply_to_message_id=_normalize_text(manifest.get("reply_to_message_id")) or None,
                )
                payload = persisted_file.payload

            manifest["status"] = "completed"
            manifest["message_id"] = _normalize_text(payload.get("id"))
            manifest["updated_at"] = _iso(_utc_now()) or ""
            self._service._write_upload_session_manifest(manifest)
            self._service._set_request_meta(upload_session_completed_now=True)
            self._service._postprocess_file_message(
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
        
        lock = self._service._get_upload_session_lock(session_id)
        with lock:
            manifest = self._service._load_upload_session_manifest(session_id)
            self._service._require_upload_session_access(manifest, current_user_id=int(current_user_id))
            if _normalize_text(manifest.get("status")).lower() == "completed":
                return {"ok": True}
            self._service._delete_upload_session_dir(session_id)
            return {"ok": True}

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
        
        normalized_body = _normalize_text(body)
        if len(normalized_body) > CHAT_MAX_MESSAGE_BODY_LENGTH:
            raise ValueError(f"Message body must be at most {CHAT_MAX_MESSAGE_BODY_LENGTH} characters")
        prepared: list[dict[str, Any]] = []
        written_paths: list[Path] = []

        try:
            normalized_conversation_id = ""
            with chat_session() as session:
                conversation = self._service._require_membership(
                    session=session,
                    conversation_id=conversation_id,
                    current_user_id=int(current_user_id),
                )
                normalized_conversation_id = conversation.id
            prepared = self._service._prepare_uploads(
                list(uploads or []),
                conversation_id=normalized_conversation_id,
                files_meta=files_meta,
            )
            written_paths.extend(
                item["path"]
                for item in prepared
                if isinstance(item.get("path"), Path)
            )
            persisted_file = self._service._file_message_persistence.persist_file_message(
                current_user_id=int(current_user_id),
                conversation_id=normalized_conversation_id,
                body=normalized_body,
                prepared=prepared,
                reply_to_message_id=reply_to_message_id,
            )
            payload = persisted_file.payload
        except Exception:
            for path in written_paths:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
            raise

        self._service._postprocess_file_message(
            current_user_id=int(current_user_id),
            payload=payload,
            prepared=prepared,
            body=normalized_body,
            defer_push_notifications=defer_push_notifications,
        )
        return payload

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

        conversation_dir = self._service._attachments_root / _normalize_text(conversation_id)
        conversation_dir.mkdir(parents=True, exist_ok=True)

        prepared = []
        written_paths: list[Path] = []
        total_size = 0
        try:
            for index, upload in enumerate(valid_uploads):
                transfer_meta = self._service._normalize_upload_transfer_meta(
                    normalized_files_meta[index] if index < len(normalized_files_meta) else {}
                )
                transfer_encoding = transfer_meta["transfer_encoding"]
                expected_original_size = transfer_meta["original_size"]
                media_kind = transfer_meta["media_kind"]
                duration_seconds = transfer_meta["duration_seconds"]
                if transfer_encoding == "gzip" and expected_original_size is None:
                    raise ValueError("original_size is required for gzip uploads")

                file_name = _safe_file_name(getattr(upload, "filename", None) or "file.bin")
                mime_type = self._service._normalize_mime_type(
                    getattr(upload, "content_type", None),
                    file_name=file_name,
                    media_kind=media_kind,
                )
                self._service._ensure_supported_upload_type(file_name=file_name, mime_type=mime_type)

                attachment_id = str(uuid4())
                storage_name = f"{attachment_id}_{file_name}"
                final_path = conversation_dir / storage_name
                temp_path = conversation_dir / f"{storage_name}.part"

                try:
                    upload.file.seek(0)
                except Exception:
                    pass

                try:
                    file_size, probe_bytes, total_size = self._service._write_decoded_transfer_payload(
                        source_stream=upload.file,
                        target_path=temp_path,
                        transfer_encoding=transfer_encoding,
                        expected_original_size=expected_original_size,
                        total_size=total_size,
                    )
                    if file_size <= 0:
                        raise ValueError(f"File is empty: {file_name}")

                    width, height = _probe_image_dimensions(probe_bytes, mime_type)
                    if width is None and height is None:
                        width, height = _probe_video_dimensions(temp_path, mime_type)
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

                    # Compress video if applicable
                    if _normalize_text(mime_type).lower().startswith("video/"):
                        try:
                            from backend.chat.video_compress import compress_video, probe_video_info
                            compressed_path = final_path.with_suffix(".compressed.mp4")
                            result = compress_video(final_path, compressed_path)
                            if result and result.exists():
                                final_path.unlink(missing_ok=True)
                                result.rename(final_path)
                                file_size = final_path.stat().st_size
                                mime_type = "video/mp4"
                                info = probe_video_info(final_path)
                                if info.get("width") and info.get("height"):
                                    width = info["width"]
                                    height = info["height"]
                                logger.info(
                                    "chat.video_compressed file=%s new_size=%d width=%s height=%s",
                                    file_name, file_size, width, height,
                                )
                        except Exception as exc:
                            logger.warning("chat.video_compress_failed file=%s error=%s", file_name, exc)

                    prepared.append(
                        {
                            "attachment_id": attachment_id,
                            "file_name": file_name,
                            "mime_type": mime_type,
                            "media_kind": media_kind,
                            "file_size": file_size,
                            "width": width,
                            "height": height,
                            "duration_seconds": duration_seconds,
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
