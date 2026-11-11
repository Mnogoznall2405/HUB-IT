"""New files that do not come from an upload: blank Office documents and copies of existing files.

Both go through the ordinary upload pipeline (``reserve_upload`` → spool → ``complete_upload``), so quota,
retention, security scan, previews and audit behave exactly as for an uploaded file.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.models import AppMyFile
from backend.services.my_files_service import (
    CHUNK_SIZE,
    FOREVER_RETENTION_DAYS,
    STATUS_DELETED,
    STORAGE_OPTIMIZED_MEDIA,
    STORAGE_ZSTD,
    MyFilesNotFoundError,
    MyFilesRequestMeta,
    MyFilesValidationError,
    _actor_id,
    _normalize_text,
    _safe_file_name,
    my_files_service,
)


logger = logging.getLogger("backend.services.my_files_copy_service")

# A copy is made inside one request: bigger files are cheaper to download and upload again.
COPY_MAX_BYTES = 2 * 1024 * 1024 * 1024

_TEMPLATE_DIR = Path(__file__).resolve().parent / "my_files_blank_templates"

BLANK_DOCUMENTS: dict[str, dict[str, str]] = {
    "docx": {
        "name": "Новый документ",
        "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    "xlsx": {
        "name": "Новая таблица",
        "mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "pptx": {
        "name": "Новая презентация",
        "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    },
}


def _split_extension(file_name: str) -> tuple[str, str]:
    stem, extension = os.path.splitext(file_name)
    return (stem, extension) if stem else (file_name, "")


class MyFilesCopyService:
    def __init__(self, files=my_files_service) -> None:
        self.files = files

    # -- helpers -----------------------------------------------------------------------------

    def _free_name(self, session, *, owner_user_id: int, folder_id: str | None, wanted: str, prefix: str = "") -> str:
        """``wanted`` unless the folder already holds it; then ``name (2).ext`` (or a "Копия" prefix for copies)."""
        query = select(AppMyFile.original_file_name).where(
            AppMyFile.owner_user_id == int(owner_user_id),
            AppMyFile.deleted_at.is_(None),
            AppMyFile.status != STATUS_DELETED,
        )
        normalized_folder = _normalize_text(folder_id)
        query = query.where(
            AppMyFile.folder_id == normalized_folder if normalized_folder else AppMyFile.folder_id.is_(None)
        )
        taken = {str(name or "").casefold() for name in session.scalars(query).all()}
        if wanted.casefold() not in taken:
            return wanted
        stem, extension = _split_extension(wanted)
        if prefix:
            candidate = f"{prefix}{wanted}"
            if candidate.casefold() not in taken:
                return candidate
        for number in range(2, 1000):
            candidate = f"{stem} ({number}){extension}"
            if candidate.casefold() not in taken:
                return candidate
        return wanted

    def _target_locked(self, session, *, actor_id: int, folder_id: str | None, library_id: str | None) -> int:
        return self.files._upload_owner_locked(
            session, actor_id=actor_id, folder_id=folder_id, library_id=library_id
        )

    # -- blank document ------------------------------------------------------------------------

    def create_blank_document(
        self,
        *,
        actor: Any,
        kind: str,
        name: str | None = None,
        folder_id: str | None = None,
        library_id: str | None = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        normalized_kind = _normalize_text(kind).lower().lstrip(".")
        spec = BLANK_DOCUMENTS.get(normalized_kind)
        if spec is None:
            raise MyFilesValidationError("Unsupported document type")
        template = _TEMPLATE_DIR / f"blank.{normalized_kind}"
        if not template.is_file():
            raise MyFilesValidationError("Blank document template is missing")
        actor_id = _actor_id(actor)
        if actor_id <= 0:
            raise MyFilesValidationError("Authenticated user is required")

        extension = f".{normalized_kind}"
        wanted = _safe_file_name(name, fallback="") if _normalize_text(name) else ""
        if not wanted:
            wanted = f"{spec['name']}{extension}"
        elif not wanted.lower().endswith(extension):
            wanted = f"{wanted}{extension}"

        with app_session(self.files._database_url_or_raise()) as session:
            owner = self._target_locked(session, actor_id=actor_id, folder_id=folder_id, library_id=library_id)
            file_name = self._free_name(session, owner_user_id=owner, folder_id=folder_id, wanted=wanted)

        payload = template.read_bytes()
        spool_path = self.files.new_spool_path(file_name)
        try:
            spool_path.write_bytes(payload)
            # A document made to be edited must not expire after a few days like a throw-away upload.
            return self.files.create_pending_upload(
                actor=actor,
                original_file_name=file_name,
                mime_type=spec["mime"],
                spool_path=spool_path,
                original_size_bytes=len(payload),
                retention_days=FOREVER_RETENTION_DAYS,
                folder_id=folder_id,
                library_id=library_id,
                meta=meta,
            )
        except BaseException:
            self.files._delete_spool_payload(spool_path)
            raise

    # -- copy --------------------------------------------------------------------------------------

    def copy_file(
        self,
        *,
        actor: Any,
        file_id: str,
        folder_id: str | None = None,
        library_id: str | None = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        actor_id = _actor_id(actor)
        if actor_id <= 0:
            raise MyFilesValidationError("Authenticated user is required")
        files = self.files
        with app_session(files._database_url_or_raise()) as session:
            row = session.get(AppMyFile, _normalize_text(file_id))
            if row is None or row.deleted_at is not None or not files.effective_role_locked(session, row, actor_id):
                raise MyFilesNotFoundError("File not found")
            payload = files._download_payload_for_row_locked(session, row)
            if int(payload.download_size_bytes or 0) > COPY_MAX_BYTES:
                raise MyFilesValidationError("File is too large to copy: download it and upload it again")
            owner = self._target_locked(session, actor_id=actor_id, folder_id=folder_id, library_id=library_id)
            same_place = int(row.owner_user_id) == owner and _normalize_text(row.folder_id) == _normalize_text(folder_id)
            wanted = _normalize_text(row.original_file_name)
            if payload.mode == STORAGE_OPTIMIZED_MEDIA:
                # The stored bytes are the optimized rendition, so the copy carries the matching name.
                wanted = payload.file_name
            file_name = self._free_name(
                session,
                owner_user_id=owner,
                folder_id=folder_id,
                wanted=wanted or payload.file_name,
                prefix="Копия " if same_place else "",
            )
            source_id = _normalize_text(row.id)
            source_retention = int(row.retention_days or 0)
            mime_type = payload.media_type

        spool_path = files.new_spool_path(file_name)
        try:
            size = self._spool_content(payload, spool_path)
            created = files.create_pending_upload(
                actor=actor,
                original_file_name=file_name,
                mime_type=mime_type,
                spool_path=spool_path,
                original_size_bytes=size,
                retention_days=source_retention,
                folder_id=folder_id,
                library_id=library_id,
                meta=meta,
            )
        except BaseException:
            files._delete_spool_payload(spool_path)
            raise

        try:
            with app_session(files._database_url_or_raise()) as session:
                source = session.get(AppMyFile, source_id)
                copy = session.get(AppMyFile, _normalize_text(created.get("id")))
                files._write_audit(
                    session, action="file_copied", row=source, actor=actor, meta=meta,
                    details=f"copy={_normalize_text(created.get('id'))}",
                )
                if copy is not None:
                    files._write_audit(
                        session, action="file_copy_created", row=copy, actor=actor, meta=meta,
                        details=f"source={source_id}",
                    )
        except Exception:
            # The copy exists and is valid; a missing journal line must not turn that into an error.
            logger.exception("Failed to journal copy of %s", source_id)
        return created

    def _spool_content(self, payload, spool_path: Path) -> int:
        written = 0
        with spool_path.open("wb") as target:
            if payload.mode == STORAGE_ZSTD:
                for chunk in self.files.iter_zstd_download(payload.path):
                    target.write(chunk)
                    written += len(chunk)
            else:
                with payload.path.open("rb") as source:
                    while True:
                        chunk = source.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        target.write(chunk)
                        written += len(chunk)
        if written <= 0:
            raise MyFilesValidationError("File is empty")
        return written


my_files_copy_service = MyFilesCopyService()
