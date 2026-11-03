"""Co-editing of My Files documents: collaborators, version history and saving edited content.

A version row owns one blob reference. Saving moves the file's current reference into a new
version row and gives the file a fresh reference to the edited content, so reference counts stay
balanced and the existing purge/expiry paths can release history through
``MyFilesService._release_file_collab_locked``.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session
from backend.appdb.models import (
    AppMyFile,
    AppMyFileBlob,
    AppMyFileCollaborator,
    AppMyFileVersion,
    AppUser,
)
from backend.services import onlyoffice_service as oo
from backend.services.my_files_service import (
    STATUS_READY,
    STORAGE_OPTIMIZED_MEDIA,
    STORAGE_STORED,
    DownloadPayload,
    MyFilesNotFoundError,
    MyFilesRequestMeta,
    MyFilesValidationError,
    _coerce_utc,
    _normalize_text,
    _sha256_file,
    _utc_now,
    my_files_service,
)


logger = logging.getLogger("backend.services.my_files_collab_service")

MAX_COLLABORATORS = 50

INVITE_EVENT_TYPE = "my_files.collab_invited"
INVITE_ENTITY_TYPE = "my_file"


def _notify_invited(user_id: int, *, file_id: str, file_name: str, owner_label: str) -> None:
    """Best effort: the access is already stored, a failed notification must not undo it."""
    try:
        from backend.services.hub_service import hub_service

        hub_service.create_user_notification(
            recipient_user_id=int(user_id),
            event_type=INVITE_EVENT_TYPE,
            title="Вам открыт документ для совместной правки",
            body=f"{owner_label or 'Пользователь'} открыл(а) вам «{file_name}»"[:300],
            entity_type=INVITE_ENTITY_TYPE,
            entity_id=file_id,
        )
    except Exception:
        logger.warning("office.invite_notification_failed user_id=%s file_id=%s", user_id, file_id, exc_info=True)


class MyFilesCollabService:
    def __init__(self, files: Any = None) -> None:
        self._files_override = files

    @property
    def files(self):
        return self._files_override or my_files_service

    # -- access -----------------------------------------------------------------------------

    def _live_row_locked(self, session, file_id: str) -> AppMyFile:
        row = session.get(AppMyFile, _normalize_text(file_id))
        now = _utc_now()
        if (
            row is None
            or row.deleted_at is not None
            or row.status != STATUS_READY
            or not self.files._security_scan_allows_access(row)
            or (_coerce_utc(row.expires_at) or now) <= now
        ):
            raise MyFilesNotFoundError("File not found")
        return row

    def _access_locked(self, session, file_id: str, user_id: int) -> tuple[AppMyFile, str]:
        row = self._live_row_locked(session, file_id)
        if int(row.owner_user_id) == int(user_id):
            role = "owner"
        elif session.get(AppMyFileCollaborator, (row.id, int(user_id))) is not None:
            role = "collaborator"
        else:
            raise MyFilesNotFoundError("File not found")
        return row, role

    @staticmethod
    def _revision(session, file_id: str) -> int:
        return int(
            session.execute(
                select(func.coalesce(func.max(AppMyFileVersion.version_no), 0)).where(
                    AppMyFileVersion.file_id == file_id
                )
            ).scalar()
            or 0
        )

    def _session_mode(self, session, row: AppMyFile, document_key: str) -> str:
        """``new`` = first save of the editing session, ``same`` = later save of that session, else ``stale``."""
        if oo.build_document_key(row.id, self._revision(session, row.id)) == document_key:
            return "new"
        latest = session.scalars(
            select(AppMyFileVersion)
            .where(AppMyFileVersion.file_id == row.id)
            .order_by(AppMyFileVersion.version_no.desc())
            .limit(1)
        ).first()
        if latest is not None and _normalize_text(latest.session_key) == document_key:
            return "same"
        return "stale"

    # -- editor session ---------------------------------------------------------------------

    def get_editor_session(self, *, file_id: str, user_id: int) -> dict[str, Any]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row, role = self._access_locked(session, file_id, user_id)
            if not oo.document_type_for(row.original_file_name):
                raise MyFilesValidationError("This file type cannot be edited online")
            return {
                "file_id": row.id,
                "file_name": _normalize_text(row.original_file_name),
                "blob_id": _normalize_text(row.blob_id),
                "revision": self._revision(session, row.id),
                "role": role,
            }

    def resolve_source(self, *, file_id: str, blob_id: str) -> DownloadPayload:
        """Current content for Document Server; a token for superseded content stops working."""
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._live_row_locked(session, file_id)
            if _normalize_text(row.blob_id) != _normalize_text(blob_id):
                raise MyFilesNotFoundError("File not found")
            return self.files._download_payload_for_row_locked(session, row)

    # -- saving -----------------------------------------------------------------------------

    @staticmethod
    def _point_row_at_blob(row: AppMyFile, blob: AppMyFileBlob, *, size: int) -> None:
        row.blob_id = blob.id
        row.original_sha256 = blob.original_sha256
        row.original_size_bytes = int(size)
        row.storage_mode = blob.storage_mode
        row.stored_size_bytes = int(blob.stored_size_bytes or 0)
        row.download_mime_type = _normalize_text(blob.output_mime_type) or row.mime_type
        row.updated_at = _utc_now()

    def _prune_versions_locked(self, session, file_id: str, pending_deletes: list[Path]) -> None:
        keep = oo.load_settings().max_versions
        versions = session.scalars(
            select(AppMyFileVersion)
            .where(AppMyFileVersion.file_id == file_id)
            .order_by(AppMyFileVersion.version_no.asc())
        ).all()
        for version in versions[: max(0, len(versions) - keep)]:
            self.files._release_blob_locked(session, version.blob_id, pending_deletes)
            session.delete(version)

    def _resolve_editor(self, session, row: AppMyFile, editor_user_ids: list[int]) -> tuple[int, str, bool]:
        """Editor to credit and whether the save is allowed.

        Document Server reports the last editor of the session; when it names users and none of them
        may edit the file any more (a collaborator removed mid-session), the save is rejected.
        """
        allowed = {int(row.owner_user_id)} | {
            int(item.user_id)
            for item in session.scalars(
                select(AppMyFileCollaborator).where(AppMyFileCollaborator.file_id == row.id)
            ).all()
        }
        editor_id = next((uid for uid in reversed(editor_user_ids) if uid in allowed), int(row.owner_user_id))
        authorised = not editor_user_ids or any(uid in allowed for uid in editor_user_ids)
        user = session.get(AppUser, editor_id)
        return editor_id, _normalize_text(getattr(user, "username", "")) or f"user-{editor_id}", authorised

    def save_version(
        self,
        *,
        file_id: str,
        document_key: str,
        spool_path: Path,
        editor_user_ids: list[int],
        meta: MyFilesRequestMeta | None = None,
    ) -> str:
        """Store edited content as the new current version: ``saved``, ``unchanged``, ``stale`` or ``forbidden``."""
        files = self.files
        database_url = files._database_url_or_raise()
        normalized_id = _normalize_text(file_id)
        with app_session(database_url) as session:
            row = self._live_row_locked(session, normalized_id)
            if self._session_mode(session, row, document_key) == "stale":
                return "stale"
            owner_user_id = int(row.owner_user_id)
            file_name = _normalize_text(row.original_file_name)
            mime_type = _normalize_text(row.mime_type) or "application/octet-stream"
            current_sha = _normalize_text(row.original_sha256).lower()
            editor_id, editor_name, authorised = self._resolve_editor(session, row, editor_user_ids)
        if not authorised:
            logger.warning("office.save_forbidden file_id=%s users=%s", normalized_id, editor_user_ids)
            return "forbidden"

        files._scan_spool_payload(normalized_id, spool_path, file_name)
        new_sha, new_size = _sha256_file(spool_path)
        if new_sha == current_sha:
            return "unchanged"

        final_path: Path | None = None
        relative_path = ""
        payload = None
        with app_session(database_url) as session:
            existing = files._find_owner_blob(session, owner_user_id=owner_user_id, original_sha256=new_sha)
            usable = False
            if existing is not None:
                try:
                    resolved = files._resolve_stored_path(existing.storage_path)
                    usable = resolved.exists()
                except Exception:
                    usable = False
        if not usable:
            payload = files._build_stored_payload(spool_path, file_name, mime_type, new_sha, new_size)
            final_path, relative_path = files._finalize_blob_path(
                payload, owner_user_id=owner_user_id, original_sha256=new_sha
            )

        pending_deletes: list[Path] = []
        persisted_new_blob = False
        try:
            with app_session(database_url) as session:
                row = session.scalars(
                    select(AppMyFile).where(AppMyFile.id == normalized_id).with_for_update()
                ).first()
                if row is None or row.deleted_at is not None or row.status != STATUS_READY:
                    raise MyFilesNotFoundError("File not found")
                mode = self._session_mode(session, row, document_key)
                if mode == "stale":
                    logger.warning("office.save_stale file_id=%s", normalized_id)
                    return "stale"
                revision = self._revision(session, normalized_id)
                growth = new_size - int(row.original_size_bytes or 0)
                if growth > 0 and (
                    files._quota_used_locked(session, owner_user_id) + growth
                    > files._user_quota_limit_locked(session, owner_user_id)
                ):
                    raise MyFilesValidationError("User storage quota exceeded")
                now = _utc_now()
                blob = files._find_owner_blob(session, owner_user_id=owner_user_id, original_sha256=new_sha)
                if blob is not None:
                    blob.ref_count = int(blob.ref_count or 0) + 1
                    blob.last_used_at = now
                    blob.updated_at = now
                    if final_path is not None and blob.storage_path == relative_path:
                        persisted_new_blob = True  # the published file is the existing blob's file
                else:
                    if payload is None or final_path is None:
                        raise MyFilesValidationError("Stored content is unavailable")
                    blob = AppMyFileBlob(
                        id=uuid.uuid4().hex,
                        owner_user_id=owner_user_id,
                        original_sha256=new_sha.lower(),
                        storage_path=relative_path,
                        storage_mode=payload.mode,
                        stored_sha256=payload.stored_sha256,
                        original_size_bytes=new_size,
                        stored_size_bytes=payload.stored_size_bytes,
                        output_mime_type=payload.output_mime_type,
                        output_extension=payload.output_extension,
                        ref_count=1,
                        created_at=now,
                        updated_at=now,
                        last_used_at=now,
                    )
                    try:
                        with session.begin_nested():
                            session.add(blob)
                            session.flush()
                        persisted_new_blob = True
                    except IntegrityError as exc:
                        raise MyFilesValidationError("Failed to persist the edited content") from exc
                previous_blob_id = _normalize_text(row.blob_id)
                if mode == "new":
                    # The file's reference to the old content moves into the history row.
                    session.add(
                        AppMyFileVersion(
                            id=uuid.uuid4().hex,
                            file_id=normalized_id,
                            version_no=revision + 1,
                            blob_id=previous_blob_id,
                            original_sha256=_normalize_text(row.original_sha256),
                            original_size_bytes=int(row.original_size_bytes or 0),
                            session_key=document_key,
                            created_by_user_id=editor_id,
                            created_by_username=editor_name[:50],
                            created_at=now,
                        )
                    )
                    session.flush()
                    self._point_row_at_blob(row, blob, size=new_size)
                    self._prune_versions_locked(session, normalized_id, pending_deletes)
                else:
                    # Autosave of an open session: replace the content saved earlier in that session.
                    self._point_row_at_blob(row, blob, size=new_size)
                    files._release_blob_locked(session, previous_blob_id, pending_deletes)
                files._queue_preview_for_row_locked(session, row)
                files._write_audit(
                    session,
                    action="office_saved",
                    row=row,
                    actor_user_id=editor_id,
                    actor_username=editor_name,
                    meta=meta,
                )
        finally:
            if final_path is not None and not persisted_new_blob:
                files._delete_physical_file(final_path)
        files._delete_physical_files(pending_deletes)
        return "saved"

    # -- version history --------------------------------------------------------------------

    def list_versions(self, *, file_id: str, user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row, _role = self._access_locked(session, file_id, user_id)
            versions = session.scalars(
                select(AppMyFileVersion)
                .where(AppMyFileVersion.file_id == row.id)
                .order_by(AppMyFileVersion.version_no.desc())
            ).all()
            return [
                {
                    "id": version.id,
                    "version_no": int(version.version_no),
                    "size_bytes": int(version.original_size_bytes or 0),
                    "replaced_by": _normalize_text(version.created_by_username),
                    "replaced_at": _coerce_utc(version.created_at),
                }
                for version in versions
            ]

    def get_version_download(self, *, file_id: str, version_id: str, user_id: int) -> DownloadPayload:
        """Content of a retired version for the owner or a collaborator."""
        files = self.files
        database_url = files._database_url_or_raise()
        with app_session(database_url) as session:
            row, _role = self._access_locked(session, file_id, user_id)
            version = session.get(AppMyFileVersion, _normalize_text(version_id))
            if version is None or version.file_id != row.id:
                raise MyFilesNotFoundError("Version not found")
            blob = session.get(AppMyFileBlob, _normalize_text(version.blob_id))
            if blob is None:
                raise MyFilesNotFoundError("Version not found")
            path = files._resolve_stored_path(blob.storage_path)
            if not path.exists() or not path.is_file():
                raise MyFilesNotFoundError("Version not found")
            download_size = int(version.original_size_bytes or 0)
            if blob.storage_mode == STORAGE_OPTIMIZED_MEDIA:
                download_size = int(blob.stored_size_bytes or 0)
            base_name = _normalize_text(row.download_file_name) or _normalize_text(row.original_file_name) or "file"
            stem, dot, extension = base_name.rpartition(".")
            versioned_name = f"{stem} (версия {int(version.version_no)}).{extension}" if dot and stem else f"{base_name} (версия {int(version.version_no)})"
            return DownloadPayload(
                path=path,
                mode=_normalize_text(blob.storage_mode) or STORAGE_STORED,
                file_name=versioned_name,
                media_type=_normalize_text(row.download_mime_type) or "application/octet-stream",
                download_size_bytes=download_size,
                file_id=row.id,
            )

    def restore_version(
        self,
        *,
        file_id: str,
        version_id: str,
        user_id: int,
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        files = self.files
        database_url = files._database_url_or_raise()
        pending_deletes: list[Path] = []
        with app_session(database_url) as session:
            row, _role = self._access_locked(session, file_id, user_id)
            row = session.scalars(select(AppMyFile).where(AppMyFile.id == row.id).with_for_update()).first()
            version = session.get(AppMyFileVersion, _normalize_text(version_id))
            if version is None or version.file_id != row.id:
                raise MyFilesNotFoundError("Version not found")
            blob = session.get(AppMyFileBlob, version.blob_id)
            if blob is None:
                raise MyFilesNotFoundError("Version not found")
            if _normalize_text(version.blob_id) == _normalize_text(row.blob_id):
                raise MyFilesValidationError("This version is already current")
            editor_id = int(user_id)
            user = session.get(AppUser, editor_id)
            editor_name = _normalize_text(getattr(user, "username", "")) or f"user-{editor_id}"
            revision = self._revision(session, row.id)
            session.add(
                AppMyFileVersion(
                    id=uuid.uuid4().hex,
                    file_id=row.id,
                    version_no=revision + 1,
                    blob_id=_normalize_text(row.blob_id),
                    original_sha256=_normalize_text(row.original_sha256),
                    original_size_bytes=int(row.original_size_bytes or 0),
                    session_key="",
                    created_by_user_id=editor_id,
                    created_by_username=editor_name[:50],
                    created_at=_utc_now(),
                )
            )
            restored_size = int(version.original_size_bytes or 0)
            session.delete(version)
            session.flush()
            self._point_row_at_blob(row, blob, size=restored_size)
            self._prune_versions_locked(session, row.id, pending_deletes)
            files._queue_preview_for_row_locked(session, row)
            files._write_audit(
                session,
                action="office_restored",
                row=row,
                actor=actor,
                meta=meta,
            )
        files._delete_physical_files(pending_deletes)

    # -- collaborators ----------------------------------------------------------------------

    def _owned_row_locked(self, session, file_id: str, owner_user_id: int) -> AppMyFile:
        row = self._live_row_locked(session, file_id)
        if int(row.owner_user_id) != int(owner_user_id):
            raise MyFilesNotFoundError("File not found")
        return row

    def list_collaborators(self, *, file_id: str, owner_user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._owned_row_locked(session, file_id, owner_user_id)
            return self._collaborators_locked(session, row.id)

    @staticmethod
    def _collaborators_locked(session, file_id: str) -> list[dict[str, Any]]:
        rows = session.execute(
            select(AppMyFileCollaborator.user_id, AppUser.username, AppUser.full_name)
            .join(AppUser, AppUser.id == AppMyFileCollaborator.user_id)
            .where(AppMyFileCollaborator.file_id == file_id)
            .order_by(AppUser.username.asc())
        ).all()
        return [
            {
                "user_id": int(user_id),
                "username": _normalize_text(username),
                "full_name": _normalize_text(full_name),
            }
            for user_id, username, full_name in rows
        ]

    def set_collaborators(
        self,
        *,
        file_id: str,
        owner_user_id: int,
        user_ids: list[int],
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> list[dict[str, Any]]:
        wanted = []
        for raw in user_ids:
            uid = int(raw)
            if uid != int(owner_user_id) and uid not in wanted:
                wanted.append(uid)
        if len(wanted) > MAX_COLLABORATORS:
            raise MyFilesValidationError(f"At most {MAX_COLLABORATORS} collaborators are allowed")
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._owned_row_locked(session, file_id, owner_user_id)
            if wanted:
                active = set(
                    session.scalars(
                        select(AppUser.id).where(AppUser.id.in_(wanted), AppUser.is_active.is_(True))
                    ).all()
                )
                if active != set(wanted):
                    raise MyFilesValidationError("Unknown or inactive user")
            existing = {
                int(item.user_id)
                for item in session.scalars(
                    select(AppMyFileCollaborator).where(AppMyFileCollaborator.file_id == row.id)
                ).all()
            }
            removed = existing - set(wanted)
            if removed:
                session.execute(
                    delete(AppMyFileCollaborator).where(
                        AppMyFileCollaborator.file_id == row.id,
                        AppMyFileCollaborator.user_id.in_(removed),
                    )
                )
            now = _utc_now()
            for uid in wanted:
                if uid not in existing:
                    session.add(
                        AppMyFileCollaborator(
                            file_id=row.id,
                            user_id=uid,
                            added_by_user_id=int(owner_user_id),
                            created_at=now,
                        )
                    )
            session.flush()
            added = [uid for uid in wanted if uid not in existing]
            if removed or added:
                files = self.files
                files._write_audit(session, action="collaborators_changed", row=row, actor=actor, meta=meta)
            result = self._collaborators_locked(session, row.id)
            file_name = _normalize_text(row.original_file_name)
            owner_label = (
                _normalize_text(getattr(actor, "full_name", ""))
                or _normalize_text(getattr(actor, "username", ""))
                or _normalize_text(row.owner_username)
            )
            shared_file_id = row.id
        for uid in added:
            _notify_invited(uid, file_id=shared_file_id, file_name=file_name, owner_label=owner_label)
        return result

    def list_shared_with_me(self, *, user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        now = _utc_now()
        with app_session(database_url) as session:
            rows = session.execute(
                select(AppMyFile, AppUser.username)
                .join(AppMyFileCollaborator, AppMyFileCollaborator.file_id == AppMyFile.id)
                .outerjoin(AppUser, AppUser.id == AppMyFile.owner_user_id)
                .where(
                    AppMyFileCollaborator.user_id == int(user_id),
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.status == STATUS_READY,
                    AppMyFile.expires_at > now,
                )
                .order_by(AppMyFile.updated_at.desc())
            ).all()
            return [
                {
                    "id": file_row.id,
                    "file_name": _normalize_text(file_row.original_file_name),
                    "owner_username": _normalize_text(owner_username) or _normalize_text(file_row.owner_username),
                    "size_bytes": int(file_row.original_size_bytes or 0),
                    "updated_at": _coerce_utc(file_row.updated_at),
                    "editable": bool(oo.document_type_for(file_row.original_file_name)),
                }
                for file_row, owner_username in rows
            ]


my_files_collab_service = MyFilesCollabService()
