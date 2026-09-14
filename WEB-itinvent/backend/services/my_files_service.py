"""Personal file storage with retention, deduplication and public share links."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
import os
import secrets
import shutil
import threading
import uuid
import warnings
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO, Callable

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import AppDatabaseConfigurationError, app_session, ensure_app_schema_initialized, is_app_database_configured
from backend.config import config
from backend.appdb.models import AppMyFile, AppMyFileAudit, AppMyFileBlob, AppMyFileDownloadGrant, AppMyFileFolder, AppMyFilePreview
from backend.services.hubit_storage import HubitStorageError
from backend.services.my_files_antivirus_service import SecurityScanResult, scan_my_file
from backend.services.my_files_storage_layout import (
    configured_previews_dir,
    configured_spool_dir,
    configured_storage_dir,
    ensure_storage_ready,
    publish_local_to_blob,
    relative_blob_path,
    relative_preview_path,
    resolve_under_root,
    storage_v2_enabled,
)
from backend.services.secret_crypto_service import (
    SecretCryptoError,
    decrypt_my_files_share_token,
    encrypt_my_files_share_token,
)


logger = logging.getLogger("backend.services.my_files_service")

ALLOWED_RETENTION_DAYS = (1, 3, 7, 10, 30)
DEFAULT_RETENTION_DAYS = 1
MAX_RETENTION_DAYS = 30
USER_QUOTA_BYTES = 50 * 1024 * 1024 * 1024
IIS_MAX_CONTENT_LENGTH_BYTES = (2**32) - 1
# Single-request limit (also imported by chat attachments); resumable uploads
# bypass it because each chunk is a separate request.
MAX_FILE_SIZE_BYTES = min(USER_QUOTA_BYTES, IIS_MAX_CONTENT_LENGTH_BYTES)
MY_FILES_MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024
UPLOAD_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
MAX_ZSTD_WINDOW_SIZE_BYTES = 1024 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

STATUS_UPLOADING = "uploading"
STATUS_QUEUED = "queued"
STATUS_SCANNING = "scanning"
STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"
STATUS_DELETED = "deleted"
PREVIEW_STATUS_QUEUED = "queued"
PREVIEW_STATUS_PROCESSING = "processing"
PREVIEW_STATUS_READY = "ready"
PREVIEW_STATUS_ERROR = "error"

STORAGE_STORED = "stored"
STORAGE_ZSTD = "zstd"
STORAGE_OPTIMIZED_MEDIA = "optimized_media"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
PREVIEW_UNAVAILABLE_MESSAGE = "Preview is temporarily unavailable. Download is still available."

_UNSET = object()


class MyFilesError(RuntimeError):
    """Base my-files domain error."""


class MyFilesConfigurationError(MyFilesError):
    """Raised when the app database is not configured."""


class MyFilesNotFoundError(MyFilesError):
    """Raised when a file or public token does not resolve to a downloadable file."""


class MyFilesValidationError(MyFilesError):
    """Raised when user input cannot be accepted."""


class MyFilesCapacityError(MyFilesError):
    """Raised when upload or processing capacity is temporarily exhausted."""


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _storage_root() -> Path:
    return configured_storage_dir()


def _spool_root() -> Path:
    return configured_spool_dir()


def _previews_override() -> Path | None:
    return configured_previews_dir()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_file_name(value: Any, *, fallback: str = "file.bin") -> str:
    raw = Path(_normalize_text(value) or fallback).name
    cleaned = "".join(ch if ch >= " " and ch not in '<>:"/\\|?*' else "_" for ch in raw).strip(" .")
    return (cleaned or fallback)[:512]


def _extension(value: str) -> str:
    suffix = Path(_safe_file_name(value)).suffix.lower()
    if len(suffix) > 32:
        return ""
    return suffix


def _guess_mime(file_name: str, content_type: str | None = None) -> str:
    normalized = _normalize_text(content_type).lower()
    if normalized and normalized != "application/octet-stream":
        return normalized[:255]
    guessed, _encoding = mimetypes.guess_type(file_name)
    return _normalize_text(guessed).lower()[:255] or "application/octet-stream"


def _hash_token(token: str) -> str:
    return hashlib.sha256(_normalize_text(token).encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while True:
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def _copy_file(source: Path, target: Path) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as src, target.open("wb") as dst:
        shutil.copyfileobj(src, dst, CHUNK_SIZE)
    return target.stat().st_size


def _actor_id(actor: Any) -> int:
    try:
        return int(getattr(actor, "id", 0) or 0)
    except Exception:
        return 0


def _actor_username(actor: Any) -> str:
    return _normalize_text(getattr(actor, "username", "") if actor is not None else "")[:50]


def _replace_extension(file_name: str, extension: str) -> str:
    safe_name = _safe_file_name(file_name)
    clean_ext = _normalize_text(extension).lower()
    if clean_ext and not clean_ext.startswith("."):
        clean_ext = f".{clean_ext}"
    if not clean_ext:
        return safe_name
    stem = Path(safe_name).stem or "file"
    return _safe_file_name(f"{stem}{clean_ext}")


@dataclass(frozen=True)
class StoredPayload:
    path: Path
    mode: str
    stored_sha256: str
    stored_size_bytes: int
    output_mime_type: str
    output_extension: str


@dataclass(frozen=True)
class DownloadPayload:
    path: Path
    mode: str
    file_name: str
    media_type: str
    download_size_bytes: int
    file_id: str = ""
    cleanup_after: bool = False


@dataclass(frozen=True)
class MyFilesRequestMeta:
    ip_address: str = ""
    user_agent: str = ""


class MyFilesService:
    """App DB-backed personal file storage."""

    def __init__(
        self,
        *,
        database_url: str | None = None,
        storage_root: Path | None = None,
        spool_root: Path | None = None,
        previews_root: Path | None = None,
        antivirus_scanner: Callable[[Path], SecurityScanResult] | None = None,
    ) -> None:
        self._database_url = _normalize_text(database_url) or None
        self.storage_root = storage_root or _storage_root()
        if spool_root is not None:
            self.spool_root = spool_root
        elif storage_root is not None:
            # Explicit storage_root in tests/dev keeps spool alongside that root.
            self.spool_root = Path(storage_root) / "spool"
        else:
            self.spool_root = _spool_root()
        override_previews = previews_root if previews_root is not None else (
            None if storage_root is not None else _previews_override()
        )
        # Empty override means per-user previews under storage_root.
        self._previews_override = override_previews
        self.previews_root = override_previews if override_previews is not None else self.storage_root
        # Legacy alias kept for older tests / call sites that inspect blobs_root.
        self.blobs_root = self.storage_root
        self._antivirus_scanner = antivirus_scanner or scan_my_file
        self._reservation_lock = threading.RLock()
        self._legacy_share_migration_disabled = False

    @property
    def configured(self) -> bool:
        return bool(self._database_url or is_app_database_configured())

    def _database_url_or_raise(self) -> str:
        try:
            return ensure_app_schema_initialized(self._database_url)
        except AppDatabaseConfigurationError as exc:
            raise MyFilesConfigurationError(str(exc)) from exc

    def _ensure_dirs(self) -> None:
        self.spool_root.mkdir(parents=True, exist_ok=True)
        if storage_v2_enabled():
            try:
                ensure_storage_ready(self.storage_root)
            except HubitStorageError as exc:
                raise MyFilesCapacityError(str(exc)) from exc
        self.storage_root.mkdir(parents=True, exist_ok=True)
        if self._previews_override is not None:
            self._previews_override.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _write_audit(
        session,
        *,
        action: str,
        row: AppMyFile | None,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
        actor_user_id: int | None = None,
        actor_username: str | None = None,
    ) -> None:
        safe_meta = meta or MyFilesRequestMeta()
        resolved_user_id = (
            int(actor_user_id)
            if actor_user_id is not None
            else (_actor_id(actor) or int(getattr(row, "owner_user_id", 0) or 0))
        )
        resolved_username = (
            _normalize_text(actor_username)[:50]
            if actor_username is not None
            else (_actor_username(actor) or _normalize_text(getattr(row, "owner_username", "")))[:50]
        )
        session.add(
            AppMyFileAudit(
                file_id=_normalize_text(getattr(row, "id", "")) or None,
                action=_normalize_text(action)[:40],
                actor_user_id=resolved_user_id,
                actor_username=resolved_username,
                ip_address=_normalize_text(safe_meta.ip_address)[:128],
                user_agent=_normalize_text(safe_meta.user_agent)[:1024],
                created_at=_utc_now(),
            )
        )

    @staticmethod
    def _clear_share(row: AppMyFile) -> None:
        row.share_token = None
        row.share_token_enc = None
        row.share_token_hash = None
        row.share_created_at = None

    @staticmethod
    def _encrypt_share_token(token: str) -> str:
        try:
            return encrypt_my_files_share_token(token)
        except SecretCryptoError as exc:
            raise MyFilesConfigurationError("MY_FILES_SHARE_TOKEN_KEY is not configured correctly") from exc

    @staticmethod
    def _decrypt_share_token(token_enc: str) -> str:
        try:
            return decrypt_my_files_share_token(token_enc)
        except SecretCryptoError as exc:
            raise MyFilesConfigurationError("Failed to decrypt the existing public share link") from exc

    def _existing_share_token_locked(self, row: AppMyFile) -> str:
        token_hash = _normalize_text(row.share_token_hash)
        encrypted = _normalize_text(row.share_token_enc)
        if encrypted:
            token = self._decrypt_share_token(encrypted)
            if token_hash and token_hash == _hash_token(token):
                return token
            raise MyFilesConfigurationError("Stored public share link failed integrity validation")

        legacy_token = _normalize_text(row.share_token)
        if legacy_token and token_hash and token_hash == _hash_token(legacy_token):
            row.share_token_enc = self._encrypt_share_token(legacy_token)
            row.share_token = None
            row.updated_at = _utc_now()
            return legacy_token
        return ""

    @staticmethod
    def _audit_response(row: AppMyFileAudit) -> dict[str, Any]:
        return {
            "id": int(row.id or 0),
            "file_id": _normalize_text(row.file_id) or None,
            "action": _normalize_text(row.action),
            "actor_user_id": int(row.actor_user_id or 0),
            "actor_username": _normalize_text(row.actor_username),
            "ip_address": _normalize_text(row.ip_address),
            "user_agent": _normalize_text(row.user_agent),
            "created_at": _coerce_utc(row.created_at),
        }

    def new_spool_path(self, file_name: str) -> Path:
        self._ensure_dirs()
        file_id = uuid.uuid4().hex
        suffix = _extension(file_name) or ".bin"
        return self.spool_root / f"{file_id}{suffix}"

    @staticmethod
    def validate_retention_days(value: Any) -> int:
        try:
            days = int(value)
        except Exception as exc:
            raise MyFilesValidationError("Retention days must be a number") from exc
        if days not in ALLOWED_RETENTION_DAYS or days > MAX_RETENTION_DAYS:
            raise MyFilesValidationError("Retention days must be one of 1, 3, 7, 10 or 30")
        return days

    def _preview_summary_locked(self, session, row: AppMyFile, *, preview: Any = _UNSET) -> dict[str, Any]:
        file_name = _normalize_text(row.download_file_name) or _normalize_text(row.original_file_name) or "file.bin"
        mime_type = _normalize_text(row.download_mime_type) or _normalize_text(row.mime_type) or "application/octet-stream"
        preview_kind = self._classify_preview_kind(filename=file_name, mime_type=mime_type)
        preview_max_bytes = self._preview_max_bytes()
        preview_status = "unsupported" if preview_kind == "unsupported" else PREVIEW_STATUS_QUEUED
        preview_available = False
        if preview_kind != "unsupported":
            download_size = self._preview_download_size_locked(row)
            if preview is _UNSET:
                preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
            if preview is not None:
                preview_status = _normalize_text(preview.status) or preview_status
                preview_path = Path(_normalize_text(preview.preview_path))
                preview_available = bool(
                    preview.status == PREVIEW_STATUS_READY
                    and download_size > 0
                    and download_size <= preview_max_bytes
                    and preview_path.is_file()
                )
            elif download_size <= 0 or download_size > preview_max_bytes:
                preview_status = PREVIEW_STATUS_ERROR
        return {
            "preview_kind": preview_kind,
            "preview_available": preview_available,
            "preview_status": preview_status,
            "preview_max_bytes": preview_max_bytes,
        }

    def _response(self, row: AppMyFile, session=None, *, preview: Any = _UNSET, folder_name: str = "") -> dict[str, Any]:
        original_size = int(row.original_size_bytes or 0)
        stored_size = int(row.stored_size_bytes or 0)
        preview_summary = (
            self._preview_summary_locked(session, row, preview=preview)
            if session is not None
            else {
                "preview_kind": "unsupported",
                "preview_available": False,
                "preview_status": "unsupported",
                "preview_max_bytes": self._preview_max_bytes(),
            }
        )
        return {
            "id": _normalize_text(row.id),
            "original_file_name": _normalize_text(row.original_file_name),
            "download_file_name": _normalize_text(row.download_file_name),
            "mime_type": _normalize_text(row.mime_type) or "application/octet-stream",
            "download_mime_type": _normalize_text(row.download_mime_type) or "application/octet-stream",
            "original_size_bytes": original_size,
            "stored_size_bytes": stored_size,
            "saved_size_bytes": max(0, original_size - stored_size) if stored_size else 0,
            "retention_days": int(row.retention_days or DEFAULT_RETENTION_DAYS),
            "folder_id": _normalize_text(getattr(row, "folder_id", "")) or None,
            "status": _normalize_text(row.status) or STATUS_QUEUED,
            "storage_mode": _normalize_text(row.storage_mode),
            "error_text": _normalize_text(row.error_text),
            "security_scan_status": _normalize_text(row.security_scan_status) or "pending",
            **preview_summary,
            "is_shared": bool(_normalize_text(row.share_token_hash)),
            "is_favorite": bool(getattr(row, "is_favorite", False)),
            "folder_name": _normalize_text(folder_name),
            "share_expires_at": _coerce_utc(row.expires_at),
            "created_at": _coerce_utc(row.created_at),
            "updated_at": _coerce_utc(row.updated_at),
            "expires_at": _coerce_utc(row.expires_at),
        }

    def _quota_used_locked(self, session, user_id: int) -> int:
        rows = session.execute(
            select(func.coalesce(func.sum(AppMyFile.original_size_bytes), 0)).where(
                AppMyFile.owner_user_id == int(user_id),
                AppMyFile.deleted_at.is_(None),
                AppMyFile.status.in_([STATUS_UPLOADING, STATUS_QUEUED, STATUS_SCANNING, STATUS_PROCESSING, STATUS_READY]),
                AppMyFile.expires_at > _utc_now(),
            )
        ).scalar()
        return int(rows or 0)

    @staticmethod
    def _advisory_lock_key(scope: str) -> int:
        raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
        return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF

    def _lock_reservation_locked(self, session, owner_user_id: int) -> None:
        bind = session.get_bind()
        if bind is None or bind.dialect.name != "postgresql":
            return
        for scope in ("my-files:global", f"my-files:user:{int(owner_user_id)}"):
            session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": self._advisory_lock_key(scope)},
            )

    @staticmethod
    def _count_statuses_locked(session, statuses: list[str], *, user_id: int | None = None) -> int:
        query = select(func.count(AppMyFile.id)).where(
            AppMyFile.deleted_at.is_(None),
            AppMyFile.expires_at > _utc_now(),
            AppMyFile.status.in_(statuses),
        )
        if user_id is not None:
            query = query.where(AppMyFile.owner_user_id == int(user_id))
        return int(session.execute(query).scalar() or 0)

    def quota(self, *, user_id: int) -> dict[str, int]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            used = self._quota_used_locked(session, int(user_id))
        return {
            "used_bytes": used,
            "limit_bytes": USER_QUOTA_BYTES,
            "remaining_bytes": max(0, USER_QUOTA_BYTES - used),
        }

    def reserve_upload(
        self,
        *,
        actor: Any,
        original_file_name: str,
        mime_type: str | None,
        spool_path: Path,
        expected_size_bytes: int,
        retention_days: int,
        folder_id: str | None = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        self.cleanup_stale_uploads(limit=100)
        owner_user_id = _actor_id(actor)
        if owner_user_id <= 0:
            raise MyFilesValidationError("Authenticated user is required")
        safe_name = _safe_file_name(original_file_name)
        safe_mime = _guess_mime(safe_name, mime_type)
        safe_days = self.validate_retention_days(retention_days)
        size = int(expected_size_bytes or 0)
        if size <= 0:
            raise MyFilesValidationError("File is empty")
        if size > MY_FILES_MAX_FILE_BYTES:
            raise MyFilesValidationError("File exceeds upload limit")

        now = _utc_now()
        expires_at = now + timedelta(days=safe_days)
        limits = config.my_files_security
        with self._reservation_lock:
            with app_session(database_url) as session:
                self._lock_reservation_locked(session, owner_user_id)
                used = self._quota_used_locked(session, owner_user_id)
                if used + size > USER_QUOTA_BYTES:
                    raise MyFilesValidationError("User storage quota exceeded")
                if self._count_statuses_locked(session, [STATUS_UPLOADING], user_id=owner_user_id) >= limits.max_uploading_per_user:
                    raise MyFilesCapacityError("Too many concurrent uploads for this user")
                if self._count_statuses_locked(session, [STATUS_UPLOADING]) >= limits.max_uploading_global:
                    raise MyFilesCapacityError("Upload capacity is temporarily exhausted")
                active_statuses = [STATUS_UPLOADING, STATUS_QUEUED, STATUS_SCANNING, STATUS_PROCESSING]
                if self._count_statuses_locked(session, active_statuses, user_id=owner_user_id) >= limits.max_active_jobs_per_user:
                    raise MyFilesCapacityError("Too many files are already queued for this user")
                if self._count_statuses_locked(session, active_statuses) >= limits.max_active_jobs_global:
                    raise MyFilesCapacityError("File processing queue is full")
                target_folder = self._folder_row_locked(
                    session, owner_user_id=owner_user_id, folder_id=folder_id
                )
                row = AppMyFile(
                    id=uuid.uuid4().hex,
                    owner_user_id=owner_user_id,
                    owner_username=_actor_username(actor),
                    folder_id=target_folder.id if target_folder else None,
                    original_file_name=safe_name,
                    download_file_name=safe_name,
                    mime_type=safe_mime,
                    download_mime_type=safe_mime,
                    original_size_bytes=size,
                    stored_size_bytes=0,
                    retention_days=safe_days,
                    status=STATUS_UPLOADING,
                    storage_mode="",
                    spool_path=str(spool_path),
                    security_scan_status="pending",
                    created_at=now,
                    updated_at=now,
                    expires_at=expires_at,
                )
                session.add(row)
                session.flush()
                self._write_audit(session, action="upload_reserved", row=row, actor=actor, meta=meta)
                return self._response(row, session=session)

    @staticmethod
    def _active_upload_locked(session, *, file_id: str, user_id: int) -> AppMyFile:
        row = session.scalars(
            select(AppMyFile)
            .where(
                AppMyFile.id == _normalize_text(file_id),
                AppMyFile.owner_user_id == int(user_id),
                AppMyFile.deleted_at.is_(None),
            )
            .with_for_update()
        ).first()
        if row is None:
            raise MyFilesNotFoundError("File not found")
        if row.status != STATUS_UPLOADING:
            raise MyFilesValidationError("Upload reservation is not active")
        return row

    @staticmethod
    def _upload_session_response(row: AppMyFile, spool_path: Path) -> dict[str, Any]:
        uploaded_bytes = spool_path.stat().st_size if spool_path.is_file() else 0
        expected_size = int(row.original_size_bytes or 0)
        if uploaded_bytes > expected_size:
            raise MyFilesValidationError("Uploaded file exceeds reservation")
        return {
            "file_id": _normalize_text(row.id),
            "chunk_size_bytes": UPLOAD_CHUNK_SIZE_BYTES,
            "uploaded_bytes": uploaded_bytes,
            "file_size_bytes": expected_size,
            "complete": uploaded_bytes == expected_size,
        }

    def get_upload_session(self, *, file_id: str, user_id: int) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._active_upload_locked(session, file_id=file_id, user_id=user_id)
            spool_path = Path(_normalize_text(row.spool_path))
            return self._upload_session_response(row, spool_path)

    def append_upload_chunk(
        self,
        *,
        file_id: str,
        user_id: int,
        offset: int,
        payload: bytes,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        chunk = bytes(payload or b"")
        requested_offset = int(offset)
        if requested_offset < 0:
            raise MyFilesValidationError("Upload chunk offset is invalid")
        if not chunk:
            raise MyFilesValidationError("Upload chunk is empty")
        if len(chunk) > UPLOAD_CHUNK_SIZE_BYTES:
            raise MyFilesValidationError("Upload chunk exceeds size limit")

        with app_session(database_url) as session:
            row = self._active_upload_locked(session, file_id=file_id, user_id=user_id)
            spool_path = Path(_normalize_text(row.spool_path))
            if not _normalize_text(row.spool_path):
                raise MyFilesValidationError("Upload payload path is missing")
            spool_path.parent.mkdir(parents=True, exist_ok=True)
            current_size = spool_path.stat().st_size if spool_path.is_file() else 0
            expected_size = int(row.original_size_bytes or 0)

            if current_size > expected_size or requested_offset + len(chunk) > expected_size:
                raise MyFilesValidationError("Upload chunk exceeds reservation")
            if requested_offset > current_size:
                raise MyFilesValidationError(f"Upload chunk offset mismatch; expected {current_size}")
            if requested_offset < current_size:
                if requested_offset + len(chunk) > current_size:
                    raise MyFilesValidationError(f"Upload chunk offset mismatch; expected {current_size}")
                with spool_path.open("rb") as source:
                    source.seek(requested_offset)
                    if source.read(len(chunk)) != chunk:
                        raise MyFilesValidationError("Upload chunk retry does not match stored data")
                return self._upload_session_response(row, spool_path)

            with spool_path.open("ab") as target:
                target.write(chunk)
                target.flush()
            row.updated_at = _utc_now()
            return self._upload_session_response(row, spool_path)

    def complete_upload(
        self,
        *,
        file_id: str,
        user_id: int,
        actual_size_bytes: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        size = int(actual_size_bytes or 0)
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            if row.status != STATUS_UPLOADING:
                raise MyFilesValidationError("Upload reservation is not active")
            if size != int(row.original_size_bytes or 0):
                raise MyFilesValidationError("Uploaded file size does not match reservation")
            spool_path = Path(_normalize_text(row.spool_path))
            if not spool_path.exists() or not spool_path.is_file() or spool_path.stat().st_size != size:
                raise MyFilesValidationError("Uploaded file is incomplete")
            row.status = STATUS_QUEUED
            row.updated_at = _utc_now()
            self._write_audit(session, action="upload_completed", row=row, actor=actor, meta=meta)
            return self._response(row, session=session)

    def abort_upload(
        self,
        *,
        file_id: str,
        user_id: int,
        error_text: str = "Upload interrupted",
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        spool_path: Path | None = None
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                return
            if _normalize_text(row.spool_path):
                spool_path = Path(_normalize_text(row.spool_path))
            row.status = STATUS_FAILED
            row.error_text = _normalize_text(error_text)[:2000] or "Upload interrupted"
            row.spool_path = ""
            row.updated_at = _utc_now()
            self._write_audit(session, action="upload_aborted", row=row, actor=actor, meta=meta)
        if spool_path is not None:
            spool_path.unlink(missing_ok=True)

    def create_pending_upload(
        self,
        *,
        actor: Any,
        original_file_name: str,
        mime_type: str | None,
        spool_path: Path,
        original_size_bytes: int,
        retention_days: int,
        folder_id: str | None = None,
    ) -> dict[str, Any]:
        reserved = self.reserve_upload(
            actor=actor,
            original_file_name=original_file_name,
            mime_type=mime_type,
            spool_path=spool_path,
            expected_size_bytes=original_size_bytes,
            retention_days=retention_days,
            folder_id=folder_id,
        )
        try:
            return self.complete_upload(
                file_id=reserved["id"],
                user_id=_actor_id(actor),
                actual_size_bytes=original_size_bytes,
            )
        except Exception:
            self.abort_upload(file_id=reserved["id"], user_id=_actor_id(actor))
            raise

    @staticmethod
    def _folder_response(row: AppMyFileFolder) -> dict[str, Any]:
        return {
            "id": _normalize_text(row.id),
            "name": _normalize_text(row.name),
            "parent_id": _normalize_text(row.parent_id) or None,
            "is_shared": bool(_normalize_text(getattr(row, "share_token_hash", ""))),
            "is_favorite": bool(getattr(row, "is_favorite", False)),
            "created_at": _coerce_utc(row.created_at),
            "updated_at": _coerce_utc(row.updated_at),
        }

    @staticmethod
    def _folder_row_locked(session, *, owner_user_id: int, folder_id: str | None) -> AppMyFileFolder | None:
        normalized = _normalize_text(folder_id)
        if not normalized:
            return None
        row = session.get(AppMyFileFolder, normalized)
        if row is None or row.owner_user_id != int(owner_user_id) or row.deleted_at is not None:
            raise MyFilesNotFoundError("Folder not found")
        return row

    def _assert_folder_name_free_locked(
        self,
        session,
        *,
        owner_user_id: int,
        parent_id: str | None,
        name: str,
        exclude_id: str | None = None,
    ) -> None:
        query = select(AppMyFileFolder.id, AppMyFileFolder.name).where(
            AppMyFileFolder.owner_user_id == int(owner_user_id),
            AppMyFileFolder.deleted_at.is_(None),
        )
        if parent_id:
            query = query.where(AppMyFileFolder.parent_id == parent_id)
        else:
            query = query.where(AppMyFileFolder.parent_id.is_(None))
        if exclude_id:
            query = query.where(AppMyFileFolder.id != exclude_id)
        target = name.casefold()
        for _fid, sibling_name in session.execute(query).all():
            if str(sibling_name or "").casefold() == target:
                raise MyFilesValidationError("Folder with this name already exists")

    def _folder_descendant_ids_locked(
        self,
        session,
        *,
        owner_user_id: int,
        folder_id: str,
        include_deleted: bool = False,
    ) -> list[str]:
        query = select(AppMyFileFolder.id, AppMyFileFolder.parent_id).where(
            AppMyFileFolder.owner_user_id == int(owner_user_id),
        )
        if not include_deleted:
            query = query.where(AppMyFileFolder.deleted_at.is_(None))
        rows = session.execute(query).all()
        children: dict[str | None, list[str]] = {}
        for fid, pid in rows:
            children.setdefault(pid, []).append(fid)
        descendants: list[str] = []
        stack = [folder_id]
        while stack:
            current = stack.pop()
            for child in children.get(current, []):
                descendants.append(child)
                stack.append(child)
        return descendants

    def list_folders(self, *, user_id: int) -> list[dict[str, Any]]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppMyFileFolder)
                .where(
                    AppMyFileFolder.owner_user_id == int(user_id),
                    AppMyFileFolder.deleted_at.is_(None),
                )
                .order_by(AppMyFileFolder.name.asc())
            ).all()
            return [self._folder_response(row) for row in rows]

    def _folder_map_locked(self, session, *, owner_user_id: int) -> dict[str, AppMyFileFolder]:
        rows = session.scalars(
            select(AppMyFileFolder).where(
                AppMyFileFolder.owner_user_id == int(owner_user_id),
                AppMyFileFolder.deleted_at.is_(None),
            )
        ).all()
        return {row.id: row for row in rows}

    def folder_breadcrumbs(self, *, user_id: int, folder_id: str | None) -> list[dict[str, Any]]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            chain: list[dict[str, Any]] = []
            current = self._folder_row_locked(session, owner_user_id=user_id, folder_id=folder_id)
            if current is None:
                return chain
            ancestors = self._folder_map_locked(session, owner_user_id=user_id)
            seen: set[str] = set()
            while current is not None and current.id not in seen:
                seen.add(current.id)
                chain.append(self._folder_response(current))
                current = ancestors.get(current.parent_id)
            chain.reverse()
            return chain

    def create_folder(
        self,
        *,
        actor: Any,
        name: str,
        parent_id: str | None = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        if owner_user_id <= 0:
            raise MyFilesValidationError("Authenticated user is required")
        safe_name = _normalize_text(name)[:255]
        if not safe_name:
            raise MyFilesValidationError("Folder name is required")
        if any(ch in safe_name for ch in '<>:"/\\|?*') or safe_name in {".", ".."}:
            raise MyFilesValidationError("Folder name contains invalid characters")
        with app_session(database_url) as session:
            parent = self._folder_row_locked(session, owner_user_id=owner_user_id, folder_id=parent_id)
            self._assert_folder_name_free_locked(
                session,
                owner_user_id=owner_user_id,
                parent_id=parent.id if parent else None,
                name=safe_name,
            )
            now = _utc_now()
            row = AppMyFileFolder(
                id=uuid.uuid4().hex,
                owner_user_id=owner_user_id,
                parent_id=parent.id if parent else None,
                name=safe_name,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            self._write_audit(session, action="folder_created", row=None, actor=actor, meta=meta)
            return self._folder_response(row)

    def update_folder(
        self,
        *,
        actor: Any,
        folder_id: str,
        name: Any = _UNSET,
        parent_id: Any = _UNSET,
        is_favorite: Any = _UNSET,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("Folder not found")

            new_parent_id = row.parent_id
            if parent_id is not _UNSET:
                new_parent_id = _normalize_text(parent_id) or None
                if new_parent_id == row.id:
                    raise MyFilesValidationError("Folder cannot be moved into itself")
                parent = self._folder_row_locked(session, owner_user_id=owner_user_id, folder_id=new_parent_id)
                if parent is not None and parent.id in self._folder_descendant_ids_locked(
                    session, owner_user_id=owner_user_id, folder_id=row.id
                ):
                    raise MyFilesValidationError("Folder cannot be moved into its own subfolder")
                row.parent_id = new_parent_id

            if name is not _UNSET:
                safe_name = _normalize_text(name)[:255]
                if not safe_name:
                    raise MyFilesValidationError("Folder name is required")
                if any(ch in safe_name for ch in '<>:"/\\|?*') or safe_name in {".", ".."}:
                    raise MyFilesValidationError("Folder name contains invalid characters")
                self._assert_folder_name_free_locked(
                    session,
                    owner_user_id=owner_user_id,
                    parent_id=new_parent_id,
                    name=safe_name,
                    exclude_id=row.id,
                )
                row.name = safe_name
            elif parent_id is not _UNSET:
                self._assert_folder_name_free_locked(
                    session,
                    owner_user_id=owner_user_id,
                    parent_id=new_parent_id,
                    name=row.name,
                    exclude_id=row.id,
                )
            if is_favorite is not _UNSET:
                row.is_favorite = bool(is_favorite)

            row.updated_at = _utc_now()
            self._write_audit(session, action="folder_updated", row=None, actor=actor, meta=meta)
            return self._folder_response(row)

    def delete_folder(
        self,
        *,
        actor: Any,
        folder_id: str,
        meta: MyFilesRequestMeta | None = None,
    ) -> int:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        spool_paths: list[Path] = []
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("Folder not found")
            folder_ids = [row.id, *self._folder_descendant_ids_locked(session, owner_user_id=owner_user_id, folder_id=row.id)]
            now = _utc_now()

            files = session.scalars(
                select(AppMyFile).where(
                    AppMyFile.owner_user_id == owner_user_id,
                    AppMyFile.folder_id.in_(folder_ids),
                    AppMyFile.deleted_at.is_(None),
                )
            ).all()
            for file_row in files:
                if _normalize_text(file_row.spool_path):
                    spool_paths.append(Path(_normalize_text(file_row.spool_path)))
                # Папка удаляется в корзину вместе с содержимым: блобы
                # сохраняются до окончательной очистки по expires_at.
                file_row.deleted_at = now
                file_row.updated_at = now
                file_row.spool_path = ""
                self._clear_share(file_row)
            if files:
                session.execute(
                    delete(AppMyFileDownloadGrant).where(
                        AppMyFileDownloadGrant.file_id.in_([f.id for f in files])
                    )
                )

            for folder_row in session.scalars(
                select(AppMyFileFolder).where(AppMyFileFolder.id.in_(folder_ids))
            ).all():
                self._clear_share(folder_row)
                folder_row.deleted_at = now
                folder_row.updated_at = now

            self._write_audit(session, action="folder_deleted", row=None, actor=actor, meta=meta)
            deleted_count = len(files)

        for path in spool_paths:
            path.unlink(missing_ok=True)
        return deleted_count

    def restore_folder(
        self,
        *,
        actor: Any,
        folder_id: str,
        meta: MyFilesRequestMeta | None = None,
    ) -> int:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is None:
                raise MyFilesNotFoundError("Folder not found")
            if row.parent_id:
                parent = session.get(AppMyFileFolder, row.parent_id)
                if parent is None or parent.deleted_at is not None:
                    row.parent_id = None
            folder_ids = [
                row.id,
                *self._folder_descendant_ids_locked(
                    session, owner_user_id=owner_user_id, folder_id=row.id, include_deleted=True,
                ),
            ]
            now = _utc_now()
            files = session.scalars(
                select(AppMyFile).where(
                    AppMyFile.owner_user_id == owner_user_id,
                    AppMyFile.folder_id.in_(folder_ids),
                    AppMyFile.deleted_at.is_not(None),
                    AppMyFile.status != STATUS_DELETED,
                )
            ).all()
            for file_row in files:
                file_row.deleted_at = None
                file_row.updated_at = now
            for folder_row in session.scalars(
                select(AppMyFileFolder).where(AppMyFileFolder.id.in_(folder_ids))
            ).all():
                folder_row.deleted_at = None
                folder_row.updated_at = now
            self._write_audit(session, action="folder_restored", row=None, actor=actor, meta=meta)
            return len(files)

    def purge_folder(
        self,
        *,
        actor: Any,
        folder_id: str,
        meta: MyFilesRequestMeta | None = None,
    ) -> int:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        spool_paths: list[Path] = []
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is None:
                raise MyFilesNotFoundError("Folder not found")
            folder_ids = [
                row.id,
                *self._folder_descendant_ids_locked(
                    session, owner_user_id=owner_user_id, folder_id=row.id, include_deleted=True,
                ),
            ]
            now = _utc_now()
            files = session.scalars(
                select(AppMyFile).where(
                    AppMyFile.owner_user_id == owner_user_id,
                    AppMyFile.folder_id.in_(folder_ids),
                    AppMyFile.deleted_at.is_not(None),
                    AppMyFile.status != STATUS_DELETED,
                )
            ).all()
            for file_row in files:
                if _normalize_text(file_row.spool_path):
                    spool_paths.append(Path(_normalize_text(file_row.spool_path)))
                if file_row.status == STATUS_READY:
                    self._release_blob_locked(session, file_row.blob_id)
                file_row.status = STATUS_DELETED
                file_row.folder_id = None
                file_row.updated_at = now
                file_row.spool_path = ""
                self._clear_share(file_row)
            if files:
                session.execute(
                    delete(AppMyFileDownloadGrant).where(
                        AppMyFileDownloadGrant.file_id.in_([f.id for f in files])
                    )
                )
            session.execute(delete(AppMyFileFolder).where(AppMyFileFolder.id.in_(folder_ids)))
            self._write_audit(session, action="folder_purged", row=None, actor=actor, meta=meta)
            purged_count = len(files)

        for path in spool_paths:
            path.unlink(missing_ok=True)
        return purged_count

    def list_trash(self, *, user_id: int) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        owner = int(user_id)
        now = _utc_now()
        with app_session(database_url) as session:
            trashed_folders = session.scalars(
                select(AppMyFileFolder)
                .where(
                    AppMyFileFolder.owner_user_id == owner,
                    AppMyFileFolder.deleted_at.is_not(None),
                )
                .order_by(AppMyFileFolder.deleted_at.desc())
            ).all()
            trashed_folder_ids = {folder.id for folder in trashed_folders}
            visible_folders = [
                folder for folder in trashed_folders if folder.parent_id not in trashed_folder_ids
            ]
            trashed_files = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.owner_user_id == owner,
                    AppMyFile.deleted_at.is_not(None),
                    AppMyFile.status != STATUS_DELETED,
                    AppMyFile.expires_at > now,
                )
                .order_by(AppMyFile.deleted_at.desc())
            ).all()
            visible_files = [
                file_row for file_row in trashed_files if file_row.folder_id not in trashed_folder_ids
            ]
            return {
                "folders": [self._folder_response(folder) for folder in visible_folders],
                "items": [self._response(file_row) for file_row in visible_files],
            }

    def empty_trash(self, *, actor: Any, meta: MyFilesRequestMeta | None = None) -> int:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        purged_files = 0
        while True:
            with app_session(database_url) as session:
                file_row = session.scalars(
                    select(AppMyFile)
                    .where(
                        AppMyFile.owner_user_id == owner_user_id,
                        AppMyFile.deleted_at.is_not(None),
                        AppMyFile.status != STATUS_DELETED,
                    )
                    .limit(1)
                ).first()
                if file_row is None:
                    break
                file_id = file_row.id
            self.purge_file(file_id=file_id, user_id=owner_user_id, actor=actor, meta=meta)
            purged_files += 1
            if purged_files >= 500:
                break
        with app_session(database_url) as session:
            folder_rows = session.scalars(
                select(AppMyFileFolder.id).where(
                    AppMyFileFolder.owner_user_id == owner_user_id,
                    AppMyFileFolder.deleted_at.is_not(None),
                )
            ).all()
            if folder_rows:
                session.execute(delete(AppMyFileFolder).where(AppMyFileFolder.id.in_(folder_rows)))
                self._write_audit(session, action="trash_emptied", row=None, actor=actor, meta=meta)
        return purged_files

    def update_file(
        self,
        *,
        actor: Any,
        file_id: str,
        name: Any = _UNSET,
        folder_id: Any = _UNSET,
        is_favorite: Any = _UNSET,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            changed = False
            if folder_id is not _UNSET:
                target = _normalize_text(folder_id) or None
                self._folder_row_locked(session, owner_user_id=owner_user_id, folder_id=target)
                row.folder_id = target
                changed = True
            if name is not _UNSET:
                safe_name = _safe_file_name(name)
                if not safe_name:
                    raise MyFilesValidationError("File name is required")
                row.original_file_name = safe_name
                row.download_file_name = safe_name
                changed = True
            if is_favorite is not _UNSET:
                row.is_favorite = bool(is_favorite)
                changed = True
            if changed:
                row.updated_at = _utc_now()
                self._write_audit(session, action="file_updated", row=row, actor=actor, meta=meta)
            return self._response(row, session=session)

    def list_files(
        self,
        *,
        user_id: int,
        folder_id: str | None = None,
        view: str = "",
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        now = _utc_now()
        normalized_view = _normalize_text(view).lower()
        with app_session(database_url) as session:
            if normalized_view in {"favorites", "recent"}:
                file_query = select(AppMyFile).where(
                    AppMyFile.owner_user_id == int(user_id),
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.expires_at > now,
                )
                if normalized_view == "favorites":
                    file_query = file_query.where(AppMyFile.is_favorite.is_(True)).order_by(AppMyFile.updated_at.desc())
                    flat_folders = session.scalars(
                        select(AppMyFileFolder)
                        .where(
                            AppMyFileFolder.owner_user_id == int(user_id),
                            AppMyFileFolder.deleted_at.is_(None),
                            AppMyFileFolder.is_favorite.is_(True),
                        )
                        .order_by(AppMyFileFolder.name.asc())
                    ).all()
                else:
                    file_query = file_query.order_by(AppMyFile.updated_at.desc()).limit(50)
                    flat_folders = []
                all_folders = self._folder_map_locked(session, owner_user_id=user_id)
                rows = session.scalars(file_query).all()
                blob_ids = [
                    _normalize_text(row.blob_id)
                    for row in rows
                    if _normalize_text(row.blob_id)
                ]
                preview_map = {
                    _normalize_text(preview_row.blob_id): preview_row
                    for preview_row in session.scalars(
                        select(AppMyFilePreview).where(AppMyFilePreview.blob_id.in_(set(blob_ids)))
                    ).all()
                } if blob_ids else {}
                return {
                    "items": [
                        self._response(
                            row,
                            session=session,
                            preview=preview_map.get(_normalize_text(row.blob_id)),
                            folder_name=(all_folders.get(row.folder_id).name if all_folders.get(row.folder_id) else ""),
                        )
                        for row in rows
                    ],
                    "folders": [self._folder_response(folder_row) for folder_row in flat_folders],
                    "breadcrumbs": [],
                    "folder": None,
                }

            folder = self._folder_row_locked(session, owner_user_id=user_id, folder_id=folder_id)
            rows = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.owner_user_id == int(user_id),
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.expires_at > now,
                    AppMyFile.folder_id.is_(None) if folder is None else AppMyFile.folder_id == folder.id,
                )
                .order_by(AppMyFile.created_at.desc())
            ).all()
            folders = session.scalars(
                select(AppMyFileFolder)
                .where(
                    AppMyFileFolder.owner_user_id == int(user_id),
                    AppMyFileFolder.deleted_at.is_(None),
                    AppMyFileFolder.parent_id.is_(None) if folder is None else AppMyFileFolder.parent_id == folder.id,
                )
                .order_by(AppMyFileFolder.name.asc())
            ).all()
            all_folders = self._folder_map_locked(session, owner_user_id=user_id)
            children_map: dict[str | None, list[str]] = {}
            for folder_row in all_folders.values():
                children_map.setdefault(folder_row.parent_id, []).append(folder_row.id)
            breadcrumbs: list[dict[str, Any]] = []
            if folder is not None:
                current = folder
                seen: set[str] = set()
                while current is not None and current.id not in seen:
                    seen.add(current.id)
                    breadcrumbs.append(self._folder_response(current))
                    current = all_folders.get(current.parent_id)
                breadcrumbs.reverse()
            counts_by_folder: dict[str | None, int] = {
                folder_key: int(count)
                for folder_key, count in session.execute(
                    select(AppMyFile.folder_id, func.count(AppMyFile.id))
                    .where(
                        AppMyFile.owner_user_id == int(user_id),
                        AppMyFile.deleted_at.is_(None),
                        AppMyFile.status != STATUS_DELETED,
                        AppMyFile.expires_at > now,
                    )
                    .group_by(AppMyFile.folder_id)
                ).all()
            }

            def subtree_file_count(root_id: str) -> int:
                total = counts_by_folder.get(root_id, 0)
                stack = [root_id]
                while stack:
                    current = stack.pop()
                    for child_id in children_map.get(current, []):
                        total += counts_by_folder.get(child_id, 0)
                        stack.append(child_id)
                return total

            folder_payloads: list[dict[str, Any]] = []
            for folder_row in folders:
                payload = self._folder_response(folder_row)
                payload["file_count"] = subtree_file_count(folder_row.id)
                folder_payloads.append(payload)
            blob_ids = [
                _normalize_text(row.blob_id)
                for row in rows
                if _normalize_text(row.blob_id)
            ]
            preview_map = {
                _normalize_text(preview_row.blob_id): preview_row
                for preview_row in session.scalars(
                    select(AppMyFilePreview).where(AppMyFilePreview.blob_id.in_(set(blob_ids)))
                ).all()
            } if blob_ids else {}
            return {
                "items": [
                    self._response(row, session=session, preview=preview_map.get(_normalize_text(row.blob_id)))
                    for row in rows
                ],
                "folders": folder_payloads,
                "breadcrumbs": breadcrumbs,
                "folder": self._folder_response(folder) if folder else None,
            }

    def list_audit(self, *, limit: int = 100) -> list[dict[str, Any]]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppMyFileAudit)
                .order_by(AppMyFileAudit.created_at.desc(), AppMyFileAudit.id.desc())
                .limit(max(1, min(500, int(limit or 100))))
            ).all()
            return [self._audit_response(row) for row in rows]

    def _blob_relative_path(self, owner_user_id: int, original_sha256: str, extension: str) -> str:
        return relative_blob_path(int(owner_user_id), original_sha256, extension)

    def _blob_path(self, owner_user_id: int, original_sha256: str, extension: str) -> Path:
        relative = self._blob_relative_path(owner_user_id, original_sha256, extension)
        return resolve_under_root(self.storage_root, relative)

    def _resolve_stored_path(self, storage_path: str) -> Path:
        raw = _normalize_text(storage_path)
        if not raw:
            raise MyFilesNotFoundError("Blob storage path is empty")
        path = Path(raw)
        # Absolute / UNC legacy paths remain readable during migration.
        if path.is_absolute() or raw.startswith("\\\\") or raw.startswith("//"):
            return path
        return resolve_under_root(self.storage_root, raw)

    def _find_owner_blob(self, session, *, owner_user_id: int, original_sha256: str) -> AppMyFileBlob | None:
        return session.execute(
            select(AppMyFileBlob).where(
                AppMyFileBlob.owner_user_id == int(owner_user_id),
                AppMyFileBlob.original_sha256 == _normalize_text(original_sha256).lower(),
            )
        ).scalar_one_or_none()

    def _try_image_optimization(self, source: Path, original_file_name: str, mime_type: str, source_size: int) -> StoredPayload | None:
        if _extension(original_file_name) not in IMAGE_EXTENSIONS and not _normalize_text(mime_type).startswith("image/"):
            return None
        if _extension(original_file_name) == ".gif" or _normalize_text(mime_type) == "image/gif":
            return None
        try:
            from PIL import Image, ImageOps
        except Exception:
            return None

        candidate = source.with_name(f"{source.stem}.{uuid.uuid4().hex}.webp")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(source) as image:
                    image = ImageOps.exif_transpose(image)
                    resample = getattr(Image, "Resampling", Image).LANCZOS
                    image.thumbnail((1920, 1920), resample)
                    if image.mode not in {"RGB", "RGBA"}:
                        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                    image.save(candidate, format="WEBP", quality=85, method=4)
            if not candidate.exists() or candidate.stat().st_size <= 0 or candidate.stat().st_size >= source_size:
                candidate.unlink(missing_ok=True)
                return None
            stored_sha256, stored_size = _sha256_file(candidate)
            return StoredPayload(
                path=candidate,
                mode=STORAGE_OPTIMIZED_MEDIA,
                stored_sha256=stored_sha256,
                stored_size_bytes=stored_size,
                output_mime_type="image/webp",
                output_extension=".webp",
            )
        except Exception as exc:
            logger.warning("Image optimization skipped for %s: %s", original_file_name, exc)
            candidate.unlink(missing_ok=True)
            return None

    def _try_video_optimization(self, source: Path, original_file_name: str, mime_type: str, source_size: int) -> StoredPayload | None:
        if _extension(original_file_name) not in VIDEO_EXTENSIONS and not _normalize_text(mime_type).startswith("video/"):
            return None
        candidate = source.with_name(f"{source.stem}.{uuid.uuid4().hex}.mp4")
        try:
            from backend.chat.video_compress import compress_video

            result = compress_video(source, candidate)
            if not result or not candidate.exists() or candidate.stat().st_size <= 0 or candidate.stat().st_size >= source_size:
                candidate.unlink(missing_ok=True)
                return None
            stored_sha256, stored_size = _sha256_file(candidate)
            return StoredPayload(
                path=candidate,
                mode=STORAGE_OPTIMIZED_MEDIA,
                stored_sha256=stored_sha256,
                stored_size_bytes=stored_size,
                output_mime_type="video/mp4",
                output_extension=".mp4",
            )
        except Exception as exc:
            logger.warning("Video optimization skipped for %s: %s", original_file_name, exc)
            candidate.unlink(missing_ok=True)
            return None

    def _try_zstd_compression(self, source: Path, source_size: int, mime_type: str) -> StoredPayload | None:
        candidate = source.with_name(f"{source.stem}.{uuid.uuid4().hex}.zst")
        try:
            import zstandard as zstd  # type: ignore
        except Exception as exc:
            logger.warning("zstandard is not available, storing original payload: %s", exc)
            return None

        try:
            zstd_threads = max(1, int(config.my_files_security.zstd_threads))
            zstd_level = max(1, min(22, int(config.my_files_security.zstd_level)))
            try:
                params = zstd.ZstdCompressionParameters.from_level(
                    zstd_level,
                    source_size=source_size,
                    threads=zstd_threads,
                    enable_ldm=True,
                    window_log=27,
                    write_checksum=True,
                    write_content_size=True,
                )
                compressor = zstd.ZstdCompressor(compression_params=params)
            except TypeError:
                compressor = zstd.ZstdCompressor(
                    level=zstd_level,
                    threads=zstd_threads,
                    write_checksum=True,
                    write_content_size=True,
                )
            with source.open("rb") as src, candidate.open("wb") as dst:
                compressor.copy_stream(src, dst)
            if not candidate.exists() or candidate.stat().st_size <= 0 or candidate.stat().st_size >= source_size:
                candidate.unlink(missing_ok=True)
                return None
            stored_sha256, stored_size = _sha256_file(candidate)
            return StoredPayload(
                path=candidate,
                mode=STORAGE_ZSTD,
                stored_sha256=stored_sha256,
                stored_size_bytes=stored_size,
                output_mime_type=_normalize_text(mime_type) or "application/octet-stream",
                output_extension=".zst",
            )
        except Exception:
            candidate.unlink(missing_ok=True)
            raise

    def _build_stored_payload(self, source: Path, original_file_name: str, mime_type: str, original_sha256: str, source_size: int) -> StoredPayload:
        media_payload = (
            self._try_image_optimization(source, original_file_name, mime_type, source_size)
            or self._try_video_optimization(source, original_file_name, mime_type, source_size)
        )
        if media_payload is not None:
            return media_payload

        zstd_payload = self._try_zstd_compression(source, source_size, mime_type)
        if zstd_payload is not None:
            return zstd_payload

        return StoredPayload(
            path=source,
            mode=STORAGE_STORED,
            stored_sha256=original_sha256,
            stored_size_bytes=source_size,
            output_mime_type=_normalize_text(mime_type) or "application/octet-stream",
            output_extension=_extension(original_file_name),
        )

    def _finalize_blob_path(
        self,
        payload: StoredPayload,
        *,
        owner_user_id: int,
        original_sha256: str,
    ) -> tuple[Path, str]:
        extension = ".zst" if payload.mode == STORAGE_ZSTD else payload.output_extension
        relative = self._blob_relative_path(owner_user_id, original_sha256, extension)
        target = resolve_under_root(self.storage_root, relative)
        if storage_v2_enabled() or str(target).startswith("\\\\"):
            try:
                ensure_storage_ready(target)
            except HubitStorageError as exc:
                raise MyFilesCapacityError(str(exc)) from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        if payload.path.resolve() == target.resolve() and target.exists():
            return target, relative
        try:
            publish_local_to_blob(
                source=payload.path,
                destination=target,
                expected_sha256=payload.stored_sha256,
                expected_size=int(payload.stored_size_bytes or 0) or None,
            )
        except HubitStorageError as exc:
            raise MyFilesCapacityError(str(exc)) from exc
        except (OSError, ValueError) as exc:
            raise MyFilesValidationError(f"Failed to publish blob to storage: {exc}") from exc
        return target, relative

    def _download_name(self, original_file_name: str, payload: StoredPayload) -> str:
        if payload.mode == STORAGE_OPTIMIZED_MEDIA:
            return _replace_extension(original_file_name, payload.output_extension)
        return _safe_file_name(original_file_name)

    def _preview_path(
        self,
        *,
        blob_id: str,
        file_name: str,
        preview_kind: str,
        media_type: str,
        owner_user_id: int = 0,
    ) -> Path:
        self._ensure_dirs()
        normalized_blob_id = _normalize_text(blob_id) or uuid.uuid4().hex
        if preview_kind in {"pdf", "office_pdf"}:
            suffix = ".pdf"
            preview_name = f"preview{suffix}"
        else:
            suffix = _extension(file_name)
            if not suffix:
                guessed_extension = mimetypes.guess_extension(_normalize_text(media_type).lower())
                suffix = guessed_extension or ".bin"
            preview_name = f"preview{suffix}"
        if self._previews_override is not None:
            return self._previews_override / normalized_blob_id[:2] / normalized_blob_id / preview_name
        relative = relative_preview_path(int(owner_user_id), normalized_blob_id, preview_name)
        return resolve_under_root(self.storage_root, relative)

    @staticmethod
    def _preview_thumb_path(preview_path: Path) -> Path:
        return preview_path.with_name("thumb.webp")

    def _write_preview_thumb(self, preview_path: Path, image_bytes: bytes) -> None:
        try:
            from io import BytesIO
            from PIL import Image, ImageOps
        except Exception:
            return
        thumb_path = self._preview_thumb_path(preview_path)
        tmp_path = thumb_path.with_name(f"{thumb_path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(image_bytes)) as image:
                    image = ImageOps.exif_transpose(image)
                    resample = getattr(Image, "Resampling", Image).LANCZOS
                    image.thumbnail((480, 480), resample)
                    if image.mode not in {"RGB", "RGBA"}:
                        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                    image.save(tmp_path, format="WEBP", quality=80, method=4)
            tmp_path.replace(thumb_path)
            tmp_path = None
        except Exception as exc:
            logger.warning("Preview thumbnail skipped for %s: %s", preview_path.name, exc)
            thumb_path.unlink(missing_ok=True)
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)

    @staticmethod
    def _safe_pdf_page_count_from_bytes(pdf_bytes: bytes) -> int:
        try:
            from io import BytesIO
            from pypdf import PdfReader

            with PdfReader(BytesIO(pdf_bytes)) as reader:
                return max(0, len(reader.pages))
        except Exception:
            return 0

    def _delete_preview_artifact_locked(self, session, blob_id: str | None) -> None:
        normalized = _normalize_text(blob_id)
        if not normalized:
            return
        preview = session.get(AppMyFilePreview, normalized)
        if preview is None:
            return
        path = Path(_normalize_text(preview.preview_path))
        session.delete(preview)
        self._delete_physical_file(path)
        self._delete_physical_file(self._preview_thumb_path(path))
        try:
            parent = path.parent
            if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass

    def _preview_download_size_locked(self, row: AppMyFile) -> int:
        if row.storage_mode == STORAGE_OPTIMIZED_MEDIA:
            return int(row.stored_size_bytes or 0)
        return int(row.original_size_bytes or 0)

    def _queue_preview_for_row_locked(self, session, row: AppMyFile) -> bool:
        blob_id = _normalize_text(row.blob_id)
        if not blob_id or row.status != STATUS_READY or row.deleted_at is not None:
            return False
        if not self._security_scan_allows_access(row):
            return False
        if (_coerce_utc(row.expires_at) or _utc_now()) <= _utc_now():
            return False
        file_name = _normalize_text(row.download_file_name) or _normalize_text(row.original_file_name) or "file.bin"
        mime_type = _normalize_text(row.download_mime_type) or _normalize_text(row.mime_type) or "application/octet-stream"
        preview_kind = self._classify_preview_kind(filename=file_name, mime_type=mime_type)
        if preview_kind == "unsupported":
            return False
        preview = session.get(AppMyFilePreview, blob_id)
        now = _utc_now()
        download_size = self._preview_download_size_locked(row)
        if download_size <= 0 or download_size > self._preview_max_bytes():
            if preview is None:
                session.add(
                    AppMyFilePreview(
                        blob_id=blob_id,
                        status=PREVIEW_STATUS_ERROR,
                        preview_kind=preview_kind,
                        source_filename=file_name,
                        content_type=mime_type,
                        error_text="File is too large for preview" if download_size > 0 else "File is empty",
                        created_at=now,
                        updated_at=now,
                    )
                )
            elif preview.status != PREVIEW_STATUS_READY:
                preview.status = PREVIEW_STATUS_ERROR
                preview.preview_kind = preview_kind
                preview.source_filename = file_name
                preview.content_type = mime_type
                preview.error_text = "File is too large for preview" if download_size > 0 else "File is empty"
                preview.updated_at = now
            return False
        if preview is None:
            session.add(
                AppMyFilePreview(
                    blob_id=blob_id,
                    status=PREVIEW_STATUS_QUEUED,
                    preview_kind=preview_kind,
                    source_filename=file_name,
                    content_type=mime_type,
                    created_at=now,
                    updated_at=now,
                )
            )
            return True
        if preview.status in {PREVIEW_STATUS_READY, PREVIEW_STATUS_PROCESSING}:
            return False
        if preview.status == PREVIEW_STATUS_ERROR:
            return False
        preview.status = PREVIEW_STATUS_QUEUED
        preview.preview_kind = preview_kind
        preview.source_filename = file_name
        preview.content_type = mime_type
        preview.error_text = ""
        preview.updated_at = now
        return True

    def _record_security_scan(self, file_id: str, result: SecurityScanResult) -> None:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.deleted_at is not None:
                return
            row.security_scan_status = _normalize_text(result.status)[:32] or "error"
            row.security_scan_engine = _normalize_text(result.engine)[:64]
            row.security_scanned_at = _utc_now()
            row.updated_at = _utc_now()
            self._write_audit(
                session,
                action=f"security_scan_{_normalize_text(result.status).lower() or 'error'}",
                row=row,
            )

    def _scan_spool_payload(self, file_id: str, spool_path: Path) -> SecurityScanResult:
        try:
            result = self._antivirus_scanner(spool_path)
        except Exception as exc:
            logger.error("Security scan failed for my-file %s: %s", file_id, exc)
            result = SecurityScanResult(
                status="error",
                engine=_normalize_text(getattr(exc, "engine", "")) or "unknown",
            )
            self._record_security_scan(file_id, result)
            if config.my_files_security.antivirus_fail_closed:
                raise MyFilesValidationError("Security scan is temporarily unavailable") from exc
            return result

        self._record_security_scan(file_id, result)
        if result.status == "blocked":
            raise MyFilesValidationError("File blocked by security scan")
        if result.status != "clean" and config.my_files_security.antivirus_fail_closed:
            raise MyFilesValidationError("File did not pass security scan")
        return result

    @staticmethod
    def _security_scan_allows_access(row: AppMyFile) -> bool:
        scan_status = _normalize_text(row.security_scan_status).lower()
        if scan_status == "clean":
            return True
        return not config.my_files_security.antivirus_fail_closed and scan_status in {"skipped", "error"}

    def cleanup_stale_uploads(self, *, limit: int = 100) -> int:
        if not self.configured:
            return 0
        database_url = self._database_url_or_raise()
        cutoff = _utc_now() - timedelta(seconds=max(60, int(config.my_files_security.upload_reservation_ttl_sec)))
        spool_paths: list[Path] = []
        count = 0
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.status == STATUS_UPLOADING,
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.updated_at <= cutoff,
                )
                .order_by(AppMyFile.updated_at.asc())
                .limit(max(1, int(limit or 100)))
            ).all()
            for row in rows:
                if _normalize_text(row.spool_path):
                    spool_paths.append(Path(_normalize_text(row.spool_path)))
                row.status = STATUS_FAILED
                row.error_text = "Upload reservation expired"
                row.spool_path = ""
                row.updated_at = _utc_now()
                self._write_audit(session, action="upload_expired", row=row)
                count += 1
        for path in spool_paths:
            path.unlink(missing_ok=True)
        return count

    def recover_stale_processing(self, *, force: bool = False) -> int:
        if not self.configured:
            return 0
        database_url = self._database_url_or_raise()
        cutoff = _utc_now() - timedelta(seconds=max(300, int(config.my_files_security.processing_timeout_sec)))
        with app_session(database_url) as session:
            backfill_conditions = [
                AppMyFile.status == STATUS_SCANNING,
                AppMyFile.blob_id.is_not(None),
                AppMyFile.spool_path == "",
                AppMyFile.deleted_at.is_(None),
            ]
            processing_conditions = [
                AppMyFile.status.in_([STATUS_SCANNING, STATUS_PROCESSING]),
                AppMyFile.deleted_at.is_(None),
            ]
            if not force:
                backfill_conditions.append(AppMyFile.updated_at <= cutoff)
                processing_conditions.append(AppMyFile.updated_at <= cutoff)
            recovered_backfills = session.execute(
                update(AppMyFile)
                .where(*backfill_conditions)
                .values(
                    status=STATUS_READY,
                    error_text="Security scan was interrupted",
                    updated_at=_utc_now(),
                )
            )
            recovered_processing = session.execute(
                update(AppMyFile)
                .where(*processing_conditions)
                .values(
                    status=STATUS_QUEUED,
                    error_text="",
                    updated_at=_utc_now(),
                )
            )
            return int(recovered_backfills.rowcount or 0) + int(recovered_processing.rowcount or 0)

    def run_job_maintenance(self) -> None:
        if not self.configured:
            return
        self.cleanup_expired(limit=100)
        self.cleanup_stale_uploads(limit=100)
        if not self._legacy_share_migration_disabled:
            try:
                self.migrate_legacy_share_tokens(limit=100)
            except MyFilesConfigurationError as exc:
                self._legacy_share_migration_disabled = True
                logger.error("Legacy my-files share-token migration disabled: %s", exc)
        self.recover_stale_processing()

    def claim_next_job(self) -> str:
        """Mark the oldest queued file as scanning; returns its id or ''."""
        if not self.configured:
            return ""
        database_url = self._database_url_or_raise()
        now = _utc_now()
        with self._reservation_lock:
            with app_session(database_url) as session:
                self._lock_reservation_locked(session, 0)
                active_processing = self._count_statuses_locked(session, [STATUS_SCANNING, STATUS_PROCESSING])
                if active_processing >= config.my_files_security.max_processing_global:
                    return ""
                row = session.scalars(
                    select(AppMyFile)
                    .where(
                        AppMyFile.status == STATUS_QUEUED,
                        AppMyFile.deleted_at.is_(None),
                        AppMyFile.expires_at > now,
                    )
                    .order_by(AppMyFile.created_at.asc())
                    .with_for_update(skip_locked=True)
                ).first()
                if row is None:
                    return ""
                row.status = STATUS_SCANNING
                row.updated_at = now
                return _normalize_text(row.id)

    def process_next_job(self) -> bool:
        if not self.configured:
            return False
        self.run_job_maintenance()
        file_id = self.claim_next_job()
        if not file_id:
            return False
        self.process_file(file_id)
        return True

    def process_next_security_backfill(self) -> bool:
        if not self.configured or not config.my_files_security.antivirus_fail_closed:
            return False
        database_url = self._database_url_or_raise()
        now = _utc_now()
        retry_before = now - timedelta(minutes=5)
        file_id = ""
        with self._reservation_lock:
            with app_session(database_url) as session:
                self._lock_reservation_locked(session, 0)
                active_processing = self._count_statuses_locked(session, [STATUS_SCANNING, STATUS_PROCESSING])
                if active_processing >= config.my_files_security.max_processing_global:
                    return False
                row = session.scalars(
                    select(AppMyFile)
                    .where(
                        AppMyFile.status == STATUS_READY,
                        AppMyFile.deleted_at.is_(None),
                        AppMyFile.expires_at > now,
                        AppMyFile.security_scan_status != "clean",
                        (
                            AppMyFile.security_scanned_at.is_(None)
                            | (AppMyFile.security_scanned_at <= retry_before)
                        ),
                    )
                    .order_by(AppMyFile.created_at.asc())
                    .with_for_update(skip_locked=True)
                ).first()
                if row is None:
                    return False
                row.status = STATUS_SCANNING
                row.security_scan_status = "scanning"
                row.security_scanned_at = now
                row.updated_at = now
                file_id = row.id
        self.process_security_backfill(file_id)
        return True

    def process_next_preview_job(self) -> bool:
        if not self.configured:
            return False
        database_url = self._database_url_or_raise()
        now = _utc_now()
        blob_id = ""
        with app_session(database_url) as session:
            preview = session.scalars(
                select(AppMyFilePreview)
                .where(AppMyFilePreview.status == PREVIEW_STATUS_QUEUED)
                .order_by(AppMyFilePreview.updated_at.asc())
                .with_for_update(skip_locked=True)
            ).first()
            if preview is None:
                rows = session.scalars(
                    select(AppMyFile)
                    .where(
                        AppMyFile.status == STATUS_READY,
                        AppMyFile.blob_id.is_not(None),
                        AppMyFile.deleted_at.is_(None),
                        AppMyFile.expires_at > now,
                    )
                    .order_by(AppMyFile.created_at.asc())
                    .limit(100)
                ).all()
                # Keep strong references so session.get inside the queue helper
                # reuses these rows instead of issuing one SELECT per file.
                blob_ids = {_normalize_text(row.blob_id) for row in rows}
                previews_by_blob_id = {
                    item.blob_id: item
                    for item in session.scalars(
                        select(AppMyFilePreview).where(AppMyFilePreview.blob_id.in_(blob_ids))
                    )
                } if blob_ids else {}
                for row in rows:
                    if not self._queue_preview_for_row_locked(session, row):
                        continue
                    blob_id = _normalize_text(row.blob_id)
                    queued = previews_by_blob_id.get(blob_id) or session.get(AppMyFilePreview, blob_id)
                    if queued is not None and queued.status == PREVIEW_STATUS_QUEUED:
                        preview = queued
                        break
            if preview is None:
                return False
            preview.status = PREVIEW_STATUS_PROCESSING
            preview.error_text = ""
            preview.updated_at = now
            blob_id = _normalize_text(preview.blob_id)
        if not blob_id:
            return False
        self.process_preview_blob(blob_id)
        return True

    def process_preview_blob(self, blob_id: str) -> bool:
        from backend.services.mail_attachment_preview_service import (
            MailAttachmentPreviewError,
            build_office_preview_artifact,
        )

        normalized_blob_id = _normalize_text(blob_id)
        if not normalized_blob_id:
            return False
        database_url = self._database_url_or_raise()
        preview_path: Path | None = None
        tmp_path: Path | None = None
        owner_user_id = 0
        try:
            with app_session(database_url) as session:
                preview = session.get(AppMyFilePreview, normalized_blob_id)
                if preview is None:
                    return False
                row = session.scalars(
                    select(AppMyFile)
                    .where(
                        AppMyFile.blob_id == normalized_blob_id,
                        AppMyFile.status == STATUS_READY,
                        AppMyFile.deleted_at.is_(None),
                        AppMyFile.expires_at > _utc_now(),
                    )
                    .order_by(AppMyFile.created_at.asc())
                ).first()
                if row is None or not self._security_scan_allows_access(row):
                    preview.status = PREVIEW_STATUS_ERROR
                    preview.error_text = "File is not available for preview"
                    preview.updated_at = _utc_now()
                    return False
                payload = self._download_payload_for_row_locked(session, row)
                owner_user_id = int(row.owner_user_id or 0)
                preview_kind = self._classify_preview_kind(
                    filename=payload.file_name,
                    mime_type=payload.media_type,
                )
                if preview_kind == "unsupported":
                    preview.status = PREVIEW_STATUS_ERROR
                    preview.preview_kind = preview_kind
                    preview.error_text = "Preview is not available for this file type"
                    preview.updated_at = _utc_now()
                    return False
                if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
                    preview.status = PREVIEW_STATUS_ERROR
                    preview.preview_kind = preview_kind
                    preview.error_text = "File is too large for preview"
                    preview.updated_at = _utc_now()
                    return False

            content = self._read_payload_bytes(payload)
            source_kind = ""
            page_count = 0
            sheets: list[dict[str, Any]] = []
            preview_bytes = content
            preview_media_type = payload.media_type
            preview_filename = payload.file_name

            if preview_kind == "office_pdf":
                artifact = build_office_preview_artifact(
                    filename=payload.file_name,
                    content_type=payload.media_type,
                    content=content,
                )
                preview_bytes = artifact.pdf_bytes
                preview_media_type = "application/pdf"
                preview_filename = _replace_extension(payload.file_name, ".pdf")
                source_kind = artifact.source_kind
                page_count = int(artifact.page_count or 0)
                sheets = list(artifact.sheets or [])
            elif preview_kind == "pdf":
                preview_media_type = "application/pdf"
                page_count = self._safe_pdf_page_count_from_bytes(content)

            preview_path = self._preview_path(
                blob_id=normalized_blob_id,
                file_name=preview_filename,
                preview_kind=preview_kind,
                media_type=preview_media_type,
                owner_user_id=owner_user_id,
            )
            preview_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = preview_path.with_name(f"{preview_path.name}.{uuid.uuid4().hex}.tmp")
            tmp_path.write_bytes(preview_bytes)
            tmp_path.replace(preview_path)
            tmp_path = None
            if preview_kind == "image":
                self._write_preview_thumb(preview_path, preview_bytes)

            with app_session(database_url) as session:
                preview = session.get(AppMyFilePreview, normalized_blob_id)
                if preview is None:
                    self._delete_physical_file(preview_path)
                    return False
                now = _utc_now()
                preview.status = PREVIEW_STATUS_READY
                preview.preview_kind = preview_kind
                preview.source_kind = source_kind
                preview.source_filename = payload.file_name
                preview.content_type = payload.media_type
                preview.preview_path = str(preview_path)
                preview.preview_mime_type = preview_media_type
                preview.preview_filename = preview_filename
                preview.page_count = page_count
                preview.sheets_json = json.dumps(sheets, ensure_ascii=False)
                preview.error_text = ""
                preview.updated_at = now
                preview.generated_at = now
            return True
        except MailAttachmentPreviewError as exc:
            error_text = PREVIEW_UNAVAILABLE_MESSAGE
            logger.warning("My-files preview unavailable for blob %s: %s", normalized_blob_id, exc)
        except Exception as exc:
            error_text = PREVIEW_UNAVAILABLE_MESSAGE
            logger.exception("Failed to render my-files preview for blob %s: %s", normalized_blob_id, exc)
        finally:
            if tmp_path is not None:
                tmp_path.unlink(missing_ok=True)
        with app_session(database_url) as session:
            preview = session.get(AppMyFilePreview, normalized_blob_id)
            if preview is not None:
                preview.status = PREVIEW_STATUS_ERROR
                preview.error_text = error_text[:2000]
                preview.preview_path = ""
                preview.updated_at = _utc_now()
        if preview_path is not None:
            self._delete_physical_file(preview_path)
        return False

    def process_security_backfill(self, file_id: str) -> None:
        database_url = self._database_url_or_raise()
        temporary_path: Path | None = None
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.deleted_at is not None:
                return
            blob = session.get(AppMyFileBlob, _normalize_text(row.blob_id))
            if blob is None:
                row.status = STATUS_FAILED
                row.error_text = "Stored payload is missing"
                row.updated_at = _utc_now()
                return
            blob_path = self._resolve_stored_path(blob.storage_path)
            blob_mode = _normalize_text(blob.storage_mode)
            original_file_name = _normalize_text(row.original_file_name) or "file.bin"

        try:
            if not blob_path.exists() or not blob_path.is_file():
                raise MyFilesValidationError("Stored payload is missing")
            scan_path = blob_path
            if blob_mode == STORAGE_ZSTD:
                temporary_path = self.new_spool_path(f"{original_file_name}.security-scan")
                size = 0
                with temporary_path.open("wb") as target:
                    for chunk in self.iter_zstd_download(blob_path):
                        size += len(chunk)
                        if size > MY_FILES_MAX_FILE_BYTES:
                            raise MyFilesValidationError("Stored payload exceeds scan limit")
                        target.write(chunk)
                scan_path = temporary_path
            result = self._antivirus_scanner(scan_path)
            self._record_security_scan(file_id, result)
            if result.status == "blocked":
                with app_session(database_url) as session:
                    row = session.get(AppMyFile, _normalize_text(file_id))
                    if row is None or row.deleted_at is not None:
                        return
                    self._release_blob_locked(session, row.blob_id)
                    row.status = STATUS_FAILED
                    row.error_text = "File blocked by security scan"
                    self._clear_share(row)
                    row.blob_id = None
                    row.storage_mode = ""
                    row.stored_size_bytes = 0
                    row.updated_at = _utc_now()
                    session.execute(delete(AppMyFileDownloadGrant).where(AppMyFileDownloadGrant.file_id == row.id))
                return
            if result.status != "clean":
                raise MyFilesValidationError("File did not pass security scan")
            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is not None and row.deleted_at is None:
                    row.status = STATUS_READY
                    row.error_text = ""
                    row.updated_at = _utc_now()
                    self._queue_preview_for_row_locked(session, row)
        except Exception as exc:
            logger.error("Security backfill failed for my-file %s: %s", file_id, exc)
            self._record_security_scan(
                file_id,
                SecurityScanResult(
                    status="error",
                    engine=_normalize_text(getattr(exc, "engine", "")) or "unknown",
                ),
            )
            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is not None and row.deleted_at is None:
                    row.status = STATUS_READY
                    row.error_text = "Security scan is temporarily unavailable"
                    row.updated_at = _utc_now()
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def process_file(self, file_id: str) -> dict[str, Any] | None:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.deleted_at is not None or row.status == STATUS_DELETED:
                return None
            spool_path = Path(_normalize_text(row.spool_path))
            original_file_name = _normalize_text(row.original_file_name)
            mime_type = _normalize_text(row.mime_type) or "application/octet-stream"
            reserved_size = int(row.original_size_bytes or 0)
            expires_at = _coerce_utc(row.expires_at)
            if expires_at is not None and expires_at <= _utc_now():
                return None
            row.status = STATUS_SCANNING
            row.updated_at = _utc_now()

        try:
            if not spool_path.exists() or not spool_path.is_file():
                raise MyFilesValidationError("Upload payload is missing from spool")
            if spool_path.stat().st_size != reserved_size:
                raise MyFilesValidationError("Uploaded file size does not match reservation")
            self._scan_spool_payload(file_id, spool_path)
            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is None or row.deleted_at is not None:
                    return None
                row.status = STATUS_PROCESSING
                row.updated_at = _utc_now()
            original_sha256, actual_size = _sha256_file(spool_path)
            owner_user_id = 0
            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is None or row.deleted_at is not None:
                    return None
                owner_user_id = int(row.owner_user_id or 0)
                blob = self._find_owner_blob(
                    session,
                    owner_user_id=owner_user_id,
                    original_sha256=original_sha256,
                )
                if blob is not None:
                    try:
                        resolved = self._resolve_stored_path(blob.storage_path)
                    except Exception:
                        resolved = None
                    if resolved is not None and resolved.exists():
                        blob.ref_count = int(blob.ref_count or 0) + 1
                        blob.last_used_at = _utc_now()
                        blob.updated_at = _utc_now()
                        row.status = STATUS_READY
                        row.original_sha256 = original_sha256
                        row.blob_id = blob.id
                        row.storage_mode = blob.storage_mode
                        row.stored_size_bytes = int(blob.stored_size_bytes or 0)
                        row.download_mime_type = _normalize_text(blob.output_mime_type) or row.mime_type
                        row.download_file_name = (
                            _replace_extension(row.original_file_name, blob.output_extension)
                            if blob.storage_mode == STORAGE_OPTIMIZED_MEDIA
                            else _safe_file_name(row.original_file_name)
                        )
                        row.spool_path = ""
                        row.error_text = ""
                        row.updated_at = _utc_now()
                        self._queue_preview_for_row_locked(session, row)
                        spool_path.unlink(missing_ok=True)
                        return self._response(row, session=session)

            payload = self._build_stored_payload(spool_path, original_file_name, mime_type, original_sha256, actual_size)
            final_path, relative_storage_path = self._finalize_blob_path(
                payload,
                owner_user_id=owner_user_id,
                original_sha256=original_sha256,
            )
            final_payload = StoredPayload(
                path=final_path,
                mode=payload.mode,
                stored_sha256=payload.stored_sha256,
                stored_size_bytes=payload.stored_size_bytes,
                output_mime_type=payload.output_mime_type,
                output_extension=payload.output_extension,
            )

            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is None or row.deleted_at is not None:
                    self._delete_physical_file(final_path)
                    return None
                now = _utc_now()
                existing_blob = self._find_owner_blob(
                    session,
                    owner_user_id=int(row.owner_user_id or 0),
                    original_sha256=original_sha256,
                )
                if existing_blob is None:
                    candidate = AppMyFileBlob(
                        id=uuid.uuid4().hex,
                        owner_user_id=int(row.owner_user_id or 0),
                        original_sha256=original_sha256.lower(),
                        storage_path=relative_storage_path,
                        storage_mode=final_payload.mode,
                        stored_sha256=final_payload.stored_sha256,
                        original_size_bytes=actual_size,
                        stored_size_bytes=final_payload.stored_size_bytes,
                        output_mime_type=final_payload.output_mime_type,
                        output_extension=final_payload.output_extension,
                        ref_count=1,
                        created_at=now,
                        updated_at=now,
                        last_used_at=now,
                    )
                    try:
                        with session.begin_nested():
                            session.add(candidate)
                            session.flush()
                        existing_blob = candidate
                    except IntegrityError:
                        existing_blob = self._find_owner_blob(
                            session,
                            owner_user_id=int(row.owner_user_id or 0),
                            original_sha256=original_sha256,
                        )
                        if existing_blob is None:
                            self._delete_physical_file(final_path)
                            raise MyFilesValidationError(
                                "Failed to persist blob after concurrent upload"
                            )
                        existing_blob.ref_count = int(existing_blob.ref_count or 0) + 1
                        existing_blob.last_used_at = now
                        existing_blob.updated_at = now
                        self._delete_physical_file(final_path)
                else:
                    existing_blob.ref_count = int(existing_blob.ref_count or 0) + 1
                    existing_blob.last_used_at = now
                    existing_blob.updated_at = now
                    self._delete_physical_file(final_path)
                row.status = STATUS_READY
                row.original_size_bytes = actual_size
                row.original_sha256 = original_sha256
                row.blob_id = existing_blob.id
                row.storage_mode = existing_blob.storage_mode
                row.stored_size_bytes = int(existing_blob.stored_size_bytes or 0)
                row.download_mime_type = _normalize_text(existing_blob.output_mime_type) or row.mime_type
                row.download_file_name = self._download_name(row.original_file_name, final_payload)
                row.spool_path = ""
                row.error_text = ""
                row.updated_at = now
                self._queue_preview_for_row_locked(session, row)
                if payload.path != spool_path:
                    spool_path.unlink(missing_ok=True)
                return self._response(row, session=session)
        except Exception as exc:
            logger.exception("Failed to process my-file upload %s", file_id)
            with app_session(database_url) as session:
                row = session.get(AppMyFile, _normalize_text(file_id))
                if row is not None and row.deleted_at is None:
                    row.status = STATUS_FAILED
                    row.error_text = str(exc)[:2000]
                    row.spool_path = ""
                    row.updated_at = _utc_now()
            spool_path.unlink(missing_ok=True)
            return None

    @staticmethod
    def _delete_physical_file(path: Path) -> None:
        try:
            if path.exists() and path.is_file():
                path.unlink()
        except OSError as exc:
            logger.warning("Failed to delete my-files blob %s: %s", path, exc)

    def _release_blob_locked(self, session, blob_id: str | None) -> None:
        normalized = _normalize_text(blob_id)
        if not normalized:
            return
        blob = session.get(AppMyFileBlob, normalized)
        if blob is None:
            return
        next_count = max(0, int(blob.ref_count or 0) - 1)
        if next_count > 0:
            blob.ref_count = next_count
            blob.updated_at = _utc_now()
            return
        path = self._resolve_stored_path(blob.storage_path)
        self._delete_preview_artifact_locked(session, normalized)
        session.delete(blob)
        self._delete_physical_file(path)

    def delete_file(
        self,
        *,
        file_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        spool_path: Path | None = None
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            now = _utc_now()
            spool_path = Path(_normalize_text(row.spool_path)) if _normalize_text(row.spool_path) else None
            # Удаление отправляет файл в корзину: блоб и статус сохраняются
            # до окончательной очистки по expires_at (cleanup_expired).
            self._clear_share(row)
            session.execute(delete(AppMyFileDownloadGrant).where(AppMyFileDownloadGrant.file_id == row.id))
            row.deleted_at = now
            row.updated_at = now
            row.spool_path = ""
            self._write_audit(session, action="trashed", row=row, actor=actor, meta=meta)
        if spool_path is not None:
            spool_path.unlink(missing_ok=True)

    def restore_file(
        self,
        *,
        file_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if (
                row is None
                or row.owner_user_id != int(user_id)
                or row.deleted_at is None
                or row.status == STATUS_DELETED
            ):
                raise MyFilesNotFoundError("File not found")
            if row.folder_id:
                parent = session.get(AppMyFileFolder, row.folder_id)
                if parent is None or parent.deleted_at is not None:
                    row.folder_id = None
            row.deleted_at = None
            row.updated_at = _utc_now()
            self._write_audit(session, action="restored", row=row, actor=actor, meta=meta)

    def purge_file(
        self,
        *,
        file_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        spool_path: Path | None = None
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if (
                row is None
                or row.owner_user_id != int(user_id)
                or row.deleted_at is None
                or row.status == STATUS_DELETED
            ):
                raise MyFilesNotFoundError("File not found")
            now = _utc_now()
            spool_path = Path(_normalize_text(row.spool_path)) if _normalize_text(row.spool_path) else None
            if row.status == STATUS_READY:
                self._release_blob_locked(session, row.blob_id)
            row.status = STATUS_DELETED
            self._clear_share(row)
            session.execute(delete(AppMyFileDownloadGrant).where(AppMyFileDownloadGrant.file_id == row.id))
            row.updated_at = now
            row.spool_path = ""
            self._write_audit(session, action="purged", row=row, actor=actor, meta=meta)
        if spool_path is not None:
            spool_path.unlink(missing_ok=True)

    def create_share(
        self,
        *,
        file_id: str,
        user_id: int,
        rotate: bool = False,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            if row.status != STATUS_READY:
                raise MyFilesValidationError("Only ready files can be shared")
            if not self._security_scan_allows_access(row):
                raise MyFilesValidationError("File is waiting for security scan")
            if (_coerce_utc(row.expires_at) or _utc_now()) <= _utc_now():
                raise MyFilesNotFoundError("File not found")

            existing_token = self._existing_share_token_locked(row)
            if not rotate and existing_token:
                return {
                    "token": existing_token,
                    "public_path": f"/shared-files/{existing_token}",
                    "expires_at": row.expires_at,
                }

            token = secrets.token_urlsafe(32)
            token_hash = _hash_token(token)
            row.share_token = None
            row.share_token_enc = self._encrypt_share_token(token)
            row.share_token_hash = token_hash
            row.share_created_at = _utc_now()
            row.updated_at = _utc_now()
            self._write_audit(
                session,
                action="share_rotated" if rotate and existing_token else "share_created",
                row=row,
                actor=actor,
                meta=meta,
            )
            return {
                "token": token,
                "public_path": f"/shared-files/{token}",
                "expires_at": row.expires_at,
            }

    def revoke_share(
        self,
        *,
        file_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            self._clear_share(row)
            row.updated_at = _utc_now()
            self._write_audit(session, action="share_revoked", row=row, actor=actor, meta=meta)

    def create_folder_share(
        self,
        *,
        actor: Any,
        folder_id: str,
        rotate: bool = False,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("Folder not found")

            existing_token = self._existing_share_token_locked(row)
            if not rotate and existing_token:
                return {
                    "token": existing_token,
                    "public_path": f"/shared-folders/{existing_token}",
                    "expires_at": None,
                }

            token = secrets.token_urlsafe(32)
            row.share_token = None
            row.share_token_enc = self._encrypt_share_token(token)
            row.share_token_hash = _hash_token(token)
            row.share_created_at = _utc_now()
            row.updated_at = _utc_now()
            self._write_audit(
                session,
                action="folder_share_rotated" if rotate and existing_token else "folder_share_created",
                row=None,
                actor=actor,
                meta=meta,
            )
            return {
                "token": token,
                "public_path": f"/shared-folders/{token}",
                "expires_at": None,
            }

    def revoke_folder_share(
        self,
        *,
        actor: Any,
        folder_id: str,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        database_url = self._database_url_or_raise()
        owner_user_id = _actor_id(actor)
        with app_session(database_url) as session:
            row = session.get(AppMyFileFolder, _normalize_text(folder_id))
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("Folder not found")
            self._clear_share(row)
            row.updated_at = _utc_now()
            self._write_audit(session, action="folder_share_revoked", row=None, actor=actor, meta=meta)

    def _public_folder_locked(self, session, token: str) -> AppMyFileFolder:
        row = session.scalars(
            select(AppMyFileFolder).where(
                AppMyFileFolder.share_token_hash == _hash_token(token),
                AppMyFileFolder.deleted_at.is_(None),
            )
        ).first()
        if row is None or not _normalize_text(row.share_token_enc):
            raise MyFilesNotFoundError("Folder not found")
        return row

    def _public_folder_file_rows_locked(self, session, folder: AppMyFileFolder) -> tuple[list[str], dict[str, str]]:
        subtree_ids = [
            folder.id,
            *self._folder_descendant_ids_locked(
                session, owner_user_id=folder.owner_user_id, folder_id=folder.id,
            ),
        ]
        folder_rows = session.scalars(
            select(AppMyFileFolder).where(AppMyFileFolder.id.in_(subtree_ids))
        ).all()
        by_id = {folder_row.id: folder_row for folder_row in folder_rows}

        def relative_path(folder_id: str | None) -> str:
            parts: list[str] = []
            current = by_id.get(folder_id)
            while current is not None and current.id != folder.id:
                parts.append(_normalize_text(current.name))
                current = by_id.get(current.parent_id)
            return "/".join(reversed(parts))

        return subtree_ids, {folder_id: relative_path(folder_id) for folder_id in subtree_ids}

    def get_public_folder(self, *, token: str) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        now = _utc_now()
        with app_session(database_url) as session:
            folder = self._public_folder_locked(session, token)
            subtree_ids, path_by_id = self._public_folder_file_rows_locked(session, folder)
            files = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.folder_id.in_(subtree_ids),
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.status == STATUS_READY,
                    AppMyFile.expires_at > now,
                )
                .order_by(AppMyFile.original_file_name.asc())
            ).all()
            items = []
            blob_ids = [
                _normalize_text(file_row.blob_id)
                for file_row in files
                if _normalize_text(file_row.blob_id)
            ]
            preview_map = {
                _normalize_text(preview_row.blob_id): preview_row
                for preview_row in session.scalars(
                    select(AppMyFilePreview).where(AppMyFilePreview.blob_id.in_(set(blob_ids)))
                ).all()
            } if blob_ids else {}
            for file_row in files:
                if not self._security_scan_allows_access(file_row):
                    continue
                preview = preview_map.get(_normalize_text(file_row.blob_id))
                preview_available = bool(
                    preview is not None
                    and preview.status == PREVIEW_STATUS_READY
                    and Path(_normalize_text(preview.preview_path)).is_file()
                )
                items.append({
                    "id": _normalize_text(file_row.id),
                    "file_name": _normalize_text(file_row.download_file_name) or _normalize_text(file_row.original_file_name),
                    "relative_path": path_by_id.get(file_row.folder_id, ""),
                    "size_bytes": int(file_row.original_size_bytes or 0),
                    "mime_type": _normalize_text(file_row.mime_type) or "application/octet-stream",
                    "preview_kind": _normalize_text(getattr(preview, "preview_kind", "")) or "unsupported",
                    "preview_available": preview_available,
                    "expires_at": _coerce_utc(file_row.expires_at),
                })
            return {
                "folder_name": _normalize_text(folder.name),
                "share_created_at": _coerce_utc(folder.share_created_at),
                "items": items,
            }

    def _public_folder_file_context_locked(self, session, *, token: str, file_id: str) -> tuple[AppMyFile, DownloadPayload]:
        folder = self._public_folder_locked(session, token)
        subtree_ids, _paths = self._public_folder_file_rows_locked(session, folder)
        row = session.get(AppMyFile, _normalize_text(file_id))
        now = _utc_now()
        if (
            row is None
            or row.folder_id not in subtree_ids
            or row.deleted_at is not None
            or row.status != STATUS_READY
            or (_coerce_utc(row.expires_at) or now) <= now
            or not self._security_scan_allows_access(row)
        ):
            raise MyFilesNotFoundError("File not found")
        payload = self._download_payload_for_row_locked(session, row)
        return row, payload

    def get_public_folder_file_preview_meta(self, *, token: str, file_id: str) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        preview_url = f"/api/v1/my-files/public-folders/{_normalize_text(token)}/files/{_normalize_text(file_id)}/preview/content"
        with app_session(database_url) as session:
            row, payload = self._public_folder_file_context_locked(session, token=token, file_id=file_id)
            return self._preview_meta_locked(session, row=row, payload=payload, preview_url=preview_url)

    def get_public_folder_file_preview_content(self, *, token: str, file_id: str, variant: str = "") -> tuple[bytes, str, str]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row, payload = self._public_folder_file_context_locked(session, token=token, file_id=file_id)
            return self._preview_content_locked(session, row=row, payload=payload, variant=variant)

    def create_public_folder_download_grant(self, *, token: str, file_id: str) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        ttl_seconds = self._download_grant_ttl_seconds()
        grant_token = secrets.token_urlsafe(32)
        now = _utc_now()
        with app_session(database_url) as session:
            folder = self._public_folder_locked(session, token)
            subtree_ids, _paths = self._public_folder_file_rows_locked(session, folder)
            row = session.get(AppMyFile, _normalize_text(file_id))
            if (
                row is None
                or row.folder_id not in subtree_ids
                or row.deleted_at is not None
                or row.status != STATUS_READY
                or (_coerce_utc(row.expires_at) or now) <= now
            ):
                raise MyFilesNotFoundError("File not found")
            if not self._security_scan_allows_access(row):
                raise MyFilesValidationError("File is waiting for security scan")
            self._purge_stale_download_grants_locked(session)
            grant = AppMyFileDownloadGrant(
                token_hash=_hash_token(grant_token),
                file_id=row.id,
                owner_user_id=int(row.owner_user_id),
                expires_at=now + timedelta(seconds=ttl_seconds),
                used_at=None,
                created_at=now,
            )
            session.add(grant)
            expires_at = grant.expires_at
        return {
            "token": grant_token,
            "download_path": f"/my-files/download-grant/{grant_token}",
            "expires_at": expires_at,
            "expires_in_seconds": ttl_seconds,
        }

    def migrate_legacy_share_tokens(self, *, limit: int = 100) -> int:
        if not self.configured:
            return 0
        database_url = self._database_url_or_raise()
        migrated = 0
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.share_token.is_not(None),
                    AppMyFile.share_token != "",
                    AppMyFile.share_token_hash.is_not(None),
                )
                .order_by(AppMyFile.updated_at.asc())
                .limit(max(1, int(limit or 100)))
            ).all()
            for row in rows:
                legacy_token = _normalize_text(row.share_token)
                if not legacy_token or _hash_token(legacy_token) != _normalize_text(row.share_token_hash):
                    self._clear_share(row)
                    row.updated_at = _utc_now()
                    continue
                row.share_token_enc = self._encrypt_share_token(legacy_token)
                row.share_token = None
                row.updated_at = _utc_now()
                migrated += 1
        return migrated

    def _public_row_locked(self, session, token: str) -> AppMyFile:
        token_hash = _hash_token(token)
        row = session.scalars(
            select(AppMyFile).where(
                AppMyFile.share_token_hash == token_hash,
                AppMyFile.status == STATUS_READY,
                AppMyFile.deleted_at.is_(None),
                AppMyFile.expires_at > _utc_now(),
            )
        ).first()
        if row is None:
            raise MyFilesNotFoundError("File not found")
        if not self._security_scan_allows_access(row):
            raise MyFilesNotFoundError("File not found")
        return row

    @staticmethod
    def _preview_max_bytes() -> int:
        from backend.services.mail_attachment_preview_service import office_preview_max_bytes

        return int(office_preview_max_bytes())

    @staticmethod
    def _classify_preview_kind(*, filename: str, mime_type: str) -> str:
        from backend.services.mail_attachment_preview_service import classify_office_source

        normalized_mime = _normalize_text(mime_type).lower()
        extension = _extension(filename).lstrip(".")
        if "pdf" in normalized_mime or extension == "pdf":
            return "pdf"
        if normalized_mime.startswith("image/"):
            return "image"
        if classify_office_source(filename=filename, content_type=mime_type):
            return "office_pdf"
        return "unsupported"

    @staticmethod
    def _office_preview_runtime_available() -> bool:
        from backend.services.mail_attachment_preview_service import (
            is_office_preview_enabled,
            resolve_soffice_path,
        )

        if not is_office_preview_enabled():
            return False
        try:
            resolve_soffice_path()
            return True
        except Exception:
            return False

    @staticmethod
    def _read_payload_bytes(payload: DownloadPayload) -> bytes:
        if payload.mode == STORAGE_ZSTD:
            return b"".join(MyFilesService.iter_zstd_download(payload.path))
        return payload.path.read_bytes()

    def _public_preview_context_locked(self, session, token: str) -> tuple[AppMyFile, DownloadPayload]:
        row = self._public_row_locked(session, token)
        payload = self._download_payload_for_row_locked(session, row)
        return row, payload

    def _owned_preview_context_locked(self, session, *, file_id: str, user_id: int) -> tuple[AppMyFile, DownloadPayload]:
        row = session.get(AppMyFile, _normalize_text(file_id))
        if row is None or row.owner_user_id != int(user_id):
            raise MyFilesNotFoundError("File not found")
        payload = self._download_payload_for_row_locked(session, row)
        return row, payload

    def _preview_meta_locked(
        self,
        session,
        *,
        row: AppMyFile,
        payload: DownloadPayload,
        preview_url: str,
    ) -> dict[str, Any]:
        preview_kind = self._classify_preview_kind(
            filename=payload.file_name,
            mime_type=payload.media_type,
        )
        if preview_kind == "unsupported":
            raise MyFilesValidationError("Preview is not available for this file type.")
        if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
            raise MyFilesValidationError("File is too large for preview.")
        preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
        preview_path = Path(_normalize_text(getattr(preview, "preview_path", "")))
        if preview is None or preview.status != PREVIEW_STATUS_READY or not preview_path.is_file():
            raise MyFilesValidationError(PREVIEW_UNAVAILABLE_MESSAGE)
        sheets: list[dict[str, Any]] = []
        try:
            parsed_sheets = json.loads(_normalize_text(preview.sheets_json) or "[]")
            if isinstance(parsed_sheets, list):
                sheets = [dict(item) for item in parsed_sheets if isinstance(item, dict)]
        except Exception:
            sheets = []
        return {
            "preview_kind": _normalize_text(preview.preview_kind) or preview_kind,
            "source_kind": _normalize_text(preview.source_kind),
            "source_filename": payload.file_name,
            "pdf_filename": _replace_extension(payload.file_name, ".pdf") if preview_kind == "office_pdf" else payload.file_name,
            "page_count": int(preview.page_count or 0),
            "sheets": sheets,
            "preview_url": preview_url,
        }

    def _preview_content_locked(self, session, *, row: AppMyFile, payload: DownloadPayload, variant: str = "") -> tuple[bytes, str, str]:
        preview_kind = self._classify_preview_kind(
            filename=payload.file_name,
            mime_type=payload.media_type,
        )
        if preview_kind == "unsupported":
            raise MyFilesValidationError("Preview is not available for this file type.")
        if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
            raise MyFilesValidationError("File is too large for preview.")
        preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
        preview_path = Path(_normalize_text(getattr(preview, "preview_path", "")))
        if preview is None or preview.status != PREVIEW_STATUS_READY or not preview_path.is_file():
            raise MyFilesValidationError(PREVIEW_UNAVAILABLE_MESSAGE)
        if _normalize_text(variant).lower() == "thumb" and preview_kind == "image":
            thumb_path = self._preview_thumb_path(preview_path)
            if thumb_path.is_file():
                return thumb_path.read_bytes(), "image/webp", _replace_extension(payload.file_name, ".webp")
        media_type = _normalize_text(preview.preview_mime_type) or payload.media_type
        filename = _replace_extension(payload.file_name, ".pdf") if preview_kind == "office_pdf" else payload.file_name
        return preview_path.read_bytes(), media_type, filename

    def get_file_preview_meta(self, *, file_id: str, user_id: int) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        preview_url = f"/api/v1/my-files/{_normalize_text(file_id)}/preview/content"
        with app_session(database_url) as session:
            row, payload = self._owned_preview_context_locked(session, file_id=file_id, user_id=int(user_id))
            return self._preview_meta_locked(session, row=row, payload=payload, preview_url=preview_url)

    def get_file_preview_content(self, *, file_id: str, user_id: int, variant: str = "") -> tuple[bytes, str, str]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row, payload = self._owned_preview_context_locked(session, file_id=file_id, user_id=int(user_id))
            return self._preview_content_locked(session, row=row, payload=payload, variant=variant)

    def get_file_preview_source(self, *, file_id: str, user_id: int) -> tuple[bytes, str, str]:
        from backend.services.mail_attachment_preview_service import classify_office_source

        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            _row, payload = self._owned_preview_context_locked(session, file_id=file_id, user_id=int(user_id))
            if classify_office_source(filename=payload.file_name, content_type=payload.media_type) != "excel":
                raise MyFilesValidationError("Preview source is only available for Excel files.")
            if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
                raise MyFilesValidationError("File is too large for preview.")
            return self._read_payload_bytes(payload), payload.media_type, payload.file_name

    def get_public_file(self, *, token: str) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._public_row_locked(session, token)
            payload = self._download_payload_for_row_locked(session, row)
            download_size = int(payload.download_size_bytes or 0)
            file_name = payload.file_name
            mime_type = payload.media_type
            preview_kind = self._classify_preview_kind(filename=file_name, mime_type=mime_type)
            preview_max_bytes = self._preview_max_bytes()
            preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
            preview_path = Path(_normalize_text(getattr(preview, "preview_path", "")))
            preview_available = bool(
                preview is not None
                and preview.status == PREVIEW_STATUS_READY
                and preview_kind != "unsupported"
                and download_size > 0
                and download_size <= preview_max_bytes
                and preview_path.is_file()
            )
            return {
                "file_name": file_name,
                "size_bytes": download_size,
                "mime_type": mime_type,
                "expires_at": row.expires_at,
                "preview_kind": preview_kind,
                "preview_available": preview_available,
                "preview_max_bytes": preview_max_bytes,
            }

    def get_public_preview_meta(self, *, token: str) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        preview_url = f"/api/v1/my-files/public/{_normalize_text(token)}/preview/content"
        with app_session(database_url) as session:
            row, payload = self._public_preview_context_locked(session, token)
            preview_kind = self._classify_preview_kind(
                filename=payload.file_name,
                mime_type=payload.media_type,
            )
            if preview_kind == "unsupported":
                raise MyFilesValidationError("Preview is not available for this file type.")
            if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
                raise MyFilesValidationError("File is too large for preview.")
            preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
            preview_path = Path(_normalize_text(getattr(preview, "preview_path", "")))
            if preview is None or preview.status != PREVIEW_STATUS_READY or not preview_path.is_file():
                raise MyFilesValidationError(PREVIEW_UNAVAILABLE_MESSAGE)
            sheets: list[dict[str, Any]] = []
            try:
                parsed_sheets = json.loads(_normalize_text(preview.sheets_json) or "[]")
                if isinstance(parsed_sheets, list):
                    sheets = [dict(item) for item in parsed_sheets if isinstance(item, dict)]
            except Exception:
                sheets = []
            return {
                "preview_kind": _normalize_text(preview.preview_kind) or preview_kind,
                "source_kind": _normalize_text(preview.source_kind),
                "source_filename": payload.file_name,
                "pdf_filename": _replace_extension(payload.file_name, ".pdf") if preview_kind == "office_pdf" else payload.file_name,
                "page_count": int(preview.page_count or 0),
                "sheets": sheets,
                "preview_url": preview_url,
            }

    def get_public_preview_content(self, *, token: str, variant: str = "") -> tuple[bytes, str, str]:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row, payload = self._public_preview_context_locked(session, token)
            preview_kind = self._classify_preview_kind(
                filename=payload.file_name,
                mime_type=payload.media_type,
            )
            if preview_kind == "unsupported":
                raise MyFilesValidationError("Preview is not available for this file type.")
            if int(payload.download_size_bytes or 0) > self._preview_max_bytes():
                raise MyFilesValidationError("File is too large for preview.")
            preview = session.get(AppMyFilePreview, _normalize_text(row.blob_id))
            preview_path = Path(_normalize_text(getattr(preview, "preview_path", "")))
            if preview is None or preview.status != PREVIEW_STATUS_READY or not preview_path.is_file():
                raise MyFilesValidationError(PREVIEW_UNAVAILABLE_MESSAGE)
            if _normalize_text(variant).lower() == "thumb" and preview_kind == "image":
                thumb_path = self._preview_thumb_path(preview_path)
                if thumb_path.is_file():
                    return thumb_path.read_bytes(), "image/webp", _replace_extension(payload.file_name, ".webp")
            media_type = _normalize_text(preview.preview_mime_type) or payload.media_type
            filename = _replace_extension(payload.file_name, ".pdf") if preview_kind == "office_pdf" else payload.file_name
            return preview_path.read_bytes(), media_type, filename

    def _download_payload_for_row_locked(self, session, row: AppMyFile) -> DownloadPayload:
        if (
            row.status != STATUS_READY
            or row.deleted_at is not None
            or not self._security_scan_allows_access(row)
            or (_coerce_utc(row.expires_at) or _utc_now()) <= _utc_now()
        ):
            raise MyFilesNotFoundError("File not found")
        blob = session.get(AppMyFileBlob, _normalize_text(row.blob_id))
        if blob is None:
            raise MyFilesNotFoundError("File not found")
        path = self._resolve_stored_path(blob.storage_path)
        if not path.exists() or not path.is_file():
            raise MyFilesNotFoundError("File not found")
        download_size = int(row.original_size_bytes or 0)
        if blob.storage_mode == STORAGE_OPTIMIZED_MEDIA:
            download_size = int(blob.stored_size_bytes or 0)
        return DownloadPayload(
            path=path,
            mode=_normalize_text(blob.storage_mode) or STORAGE_STORED,
            file_name=_normalize_text(row.download_file_name) or _normalize_text(row.original_file_name) or "file.bin",
            media_type=_normalize_text(row.download_mime_type) or "application/octet-stream",
            download_size_bytes=download_size,
            file_id=_normalize_text(row.id),
        )

    def get_download(self, *, file_id: str, user_id: int) -> DownloadPayload:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.owner_user_id != int(user_id):
                raise MyFilesNotFoundError("File not found")
            return self._download_payload_for_row_locked(session, row)

    def _download_grant_ttl_seconds(self) -> int:
        return max(30, int(config.my_files_download_grant.ttl_seconds or 120))

    def _purge_stale_download_grants_locked(self, session) -> None:
        now = _utc_now()
        session.execute(
            delete(AppMyFileDownloadGrant).where(
                (AppMyFileDownloadGrant.expires_at <= now)
                | (AppMyFileDownloadGrant.used_at.is_not(None))
            )
        )

    def _revoke_pending_download_grants_locked(self, session, *, file_id: str, user_id: int) -> None:
        session.execute(
            delete(AppMyFileDownloadGrant).where(
                AppMyFileDownloadGrant.file_id == _normalize_text(file_id),
                AppMyFileDownloadGrant.owner_user_id == int(user_id),
                AppMyFileDownloadGrant.used_at.is_(None),
            )
        )

    def create_download_grant(
        self,
        *,
        file_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        normalized_file_id = _normalize_text(file_id)
        ttl_seconds = self._download_grant_ttl_seconds()
        token = secrets.token_urlsafe(32)
        token_hash = _hash_token(token)
        now = _utc_now()
        with app_session(database_url) as session:
            row = session.get(AppMyFile, normalized_file_id)
            if row is None or row.owner_user_id != int(user_id) or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            if row.status != STATUS_READY:
                raise MyFilesValidationError("Only ready files can be downloaded")
            if not self._security_scan_allows_access(row):
                raise MyFilesValidationError("File is waiting for security scan")
            if (_coerce_utc(row.expires_at) or now) <= now:
                raise MyFilesNotFoundError("File not found")
            self._purge_stale_download_grants_locked(session)
            self._revoke_pending_download_grants_locked(session, file_id=normalized_file_id, user_id=int(user_id))
            grant = AppMyFileDownloadGrant(
                token_hash=token_hash,
                file_id=normalized_file_id,
                owner_user_id=int(user_id),
                expires_at=now + timedelta(seconds=ttl_seconds),
                used_at=None,
                created_at=now,
            )
            session.add(grant)
            self._write_audit(session, action="download_grant_created", row=row, actor=actor, meta=meta)
            expires_at = grant.expires_at
        return {
            "token": token,
            "download_path": f"/my-files/download-grant/{token}",
            "expires_at": expires_at,
            "expires_in_seconds": ttl_seconds,
        }

    def create_folder_archive_grant(
        self,
        *,
        folder_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self._database_url_or_raise()
        ttl_seconds = self._download_grant_ttl_seconds()
        token = secrets.token_urlsafe(32)
        now = _utc_now()
        with app_session(database_url) as session:
            folder = self._folder_row_locked(session, owner_user_id=int(user_id), folder_id=folder_id)
            self._purge_stale_download_grants_locked(session)
            grant = AppMyFileDownloadGrant(
                token_hash=_hash_token(token),
                file_id=None,
                folder_id=folder.id,
                owner_user_id=int(user_id),
                expires_at=now + timedelta(seconds=ttl_seconds),
                used_at=None,
                created_at=now,
            )
            session.add(grant)
            self._write_audit(session, action="folder_archive_grant_created", row=None, actor=actor, meta=meta)
            expires_at = grant.expires_at
        return {
            "token": token,
            "download_path": f"/my-files/download-grant/{token}",
            "expires_at": expires_at,
            "expires_in_seconds": ttl_seconds,
        }

    def _build_folder_archive_locked(self, session, *, folder: AppMyFileFolder) -> Path:
        import zipfile

        now = _utc_now()
        subtree_ids = [
            folder.id,
            *self._folder_descendant_ids_locked(
                session, owner_user_id=folder.owner_user_id, folder_id=folder.id,
            ),
        ]
        folder_rows = session.scalars(
            select(AppMyFileFolder).where(AppMyFileFolder.id.in_(subtree_ids))
        ).all()
        by_id = {folder_row.id: folder_row for folder_row in folder_rows}

        def relative_dir(folder_id: str | None) -> str:
            parts: list[str] = []
            current = by_id.get(folder_id)
            while current is not None and current.id != folder.id:
                parts.append(_normalize_text(current.name))
                current = by_id.get(current.parent_id)
            return "/".join(reversed(parts))

        rows = session.scalars(
            select(AppMyFile)
            .where(
                AppMyFile.owner_user_id == int(folder.owner_user_id),
                AppMyFile.folder_id.in_(subtree_ids),
                AppMyFile.deleted_at.is_(None),
                AppMyFile.status == STATUS_READY,
                AppMyFile.expires_at > now,
            )
            .order_by(AppMyFile.original_file_name.asc())
        ).all()
        files = [row for row in rows if self._security_scan_allows_access(row)]
        if not files:
            raise MyFilesValidationError("Folder is empty")

        archive_path = self.new_spool_path(f"{_normalize_text(folder.name) or 'folder'}.zip")
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        used_names: set[str] = set()
        try:
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for row in files:
                    base_name = _normalize_text(row.download_file_name) or _normalize_text(row.original_file_name) or "file.bin"
                    prefix = relative_dir(row.folder_id)
                    arcname = f"{prefix}/{base_name}" if prefix else base_name
                    while arcname in used_names:
                        stem, dot, ext = base_name.rpartition(".")
                        candidate = f"{stem}_copy.{ext}" if dot else f"{base_name}_copy"
                        arcname = f"{prefix}/{candidate}" if prefix else candidate
                    used_names.add(arcname)
                    payload = self._download_payload_for_row_locked(session, row)
                    with archive.open(arcname, mode="w", force_zip64=True) as entry:
                        if payload.mode == STORAGE_ZSTD:
                            for part in self.iter_zstd_download(payload.path):
                                entry.write(part)
                        else:
                            with payload.path.open("rb") as source:
                                while True:
                                    block = source.read(1024 * 1024)
                                    if not block:
                                        break
                                    entry.write(block)
        except Exception:
            archive_path.unlink(missing_ok=True)
            raise
        return archive_path

    def consume_download_grant(self, *, token: str, meta: MyFilesRequestMeta | None = None) -> DownloadPayload:
        database_url = self._database_url_or_raise()
        normalized_token = _normalize_text(token)
        if not normalized_token:
            raise MyFilesNotFoundError("File not found")
        token_hash = _hash_token(normalized_token)
        now = _utc_now()
        with app_session(database_url) as session:
            consumed = session.execute(
                update(AppMyFileDownloadGrant)
                .where(
                    AppMyFileDownloadGrant.token_hash == token_hash,
                    AppMyFileDownloadGrant.expires_at > now,
                    AppMyFileDownloadGrant.used_at.is_(None),
                )
                .values(used_at=now)
                .returning(
                    AppMyFileDownloadGrant.file_id,
                    AppMyFileDownloadGrant.folder_id,
                    AppMyFileDownloadGrant.owner_user_id,
                )
            ).first()
            if consumed is None:
                raise MyFilesNotFoundError("File not found")
            file_id = _normalize_text(consumed[0])
            folder_id = _normalize_text(consumed[1])
            owner_user_id = int(consumed[2] or 0)
            if folder_id:
                folder = session.get(AppMyFileFolder, folder_id)
                if folder is None or folder.owner_user_id != owner_user_id or folder.deleted_at is not None:
                    raise MyFilesNotFoundError("Folder not found")
                archive_path = self._build_folder_archive_locked(session, folder=folder)
                self._write_audit(session, action="folder_archive_download_started", row=None, meta=meta)
                return DownloadPayload(
                    path=archive_path,
                    mode=STORAGE_STORED,
                    file_name=f"{_normalize_text(folder.name) or 'folder'}.zip",
                    media_type="application/zip",
                    download_size_bytes=archive_path.stat().st_size,
                    cleanup_after=True,
                )
            row = session.get(AppMyFile, file_id)
            if row is None or row.owner_user_id != owner_user_id or row.deleted_at is not None:
                raise MyFilesNotFoundError("File not found")
            payload = self._download_payload_for_row_locked(session, row)
            self._write_audit(session, action="owner_download_started", row=row, meta=meta)
            return payload

    def get_public_download(self, *, token: str, meta: MyFilesRequestMeta | None = None) -> DownloadPayload:
        database_url = self._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._public_row_locked(session, token)
            payload = self._download_payload_for_row_locked(session, row)
            self._write_audit(
                session,
                action="public_download_started",
                row=row,
                meta=meta,
                actor_user_id=0,
                actor_username="",
            )
            return payload

    def cleanup_expired(self, *, limit: int = 100) -> int:
        if not self.configured:
            return 0
        database_url = self._database_url_or_raise()
        count = 0
        spool_paths: list[Path] = []
        with app_session(database_url) as session:
            rows = session.scalars(
                select(AppMyFile)
                .where(
                    AppMyFile.expires_at <= _utc_now(),
                    AppMyFile.status != STATUS_DELETED,
                )
                .order_by(AppMyFile.expires_at.asc())
                .limit(max(1, int(limit or 100)))
            ).all()
            for row in rows:
                if row.status == STATUS_READY:
                    self._release_blob_locked(session, row.blob_id)
                if _normalize_text(row.spool_path):
                    spool_paths.append(Path(_normalize_text(row.spool_path)))
                row.status = STATUS_DELETED
                self._clear_share(row)
                row.deleted_at = _utc_now()
                row.updated_at = _utc_now()
                row.spool_path = ""
                self._write_audit(session, action="expired", row=row)
                count += 1
        for path in spool_paths:
            path.unlink(missing_ok=True)
        return count

    @staticmethod
    def iter_zstd_download(path: Path) -> Any:
        import zstandard as zstd  # type: ignore

        with path.open("rb") as source:
            decompressor = zstd.ZstdDecompressor(max_window_size=MAX_ZSTD_WINDOW_SIZE_BYTES)
            with decompressor.stream_reader(source) as reader:
                while True:
                    chunk = reader.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    yield chunk


class MyFilesWorker:
    def __init__(self, service: MyFilesService) -> None:
        self.service = service
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None

    async def start(self) -> None:
        if self._task is not None or not self.service.configured:
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop(), name="my-files-worker")

    async def stop(self) -> None:
        if self._task is None:
            return
        assert self._stop_event is not None
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None
            self._stop_event = None

    async def _run_loop(self) -> None:
        assert self._stop_event is not None
        # Каждая «полоса» самостоятельно берёт задачи: claim сериализуется
        # _reservation_lock + skip_locked, а глобальный лимит параллелизма
        # проверяется по счётчику scanning/processing внутри claim_next_job.
        lanes = max(1, int(config.my_files_security.max_processing_global))

        async def _lane() -> None:
            assert self._stop_event is not None
            while not self._stop_event.is_set():
                try:
                    processed = await asyncio.to_thread(self.service.process_next_job)
                    if not processed:
                        processed = await asyncio.to_thread(self.service.process_next_security_backfill)
                    await asyncio.sleep(1 if processed else 5)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception("my-files worker cycle failed: %s", exc)
                    await asyncio.sleep(10)

        lane_tasks = [
            asyncio.create_task(_lane(), name=f"my-files-worker-lane-{index}")
            for index in range(lanes)
        ]
        try:
            await asyncio.gather(*lane_tasks)
        finally:
            for lane_task in lane_tasks:
                lane_task.cancel()


my_files_service = MyFilesService()
my_files_worker = MyFilesWorker(my_files_service)
