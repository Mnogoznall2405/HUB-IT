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
    AppMyFileFolder,
    AppMyFileFolderCollaborator,
    AppMyFileVersion,
    AppUser,
)
from backend.services import onlyoffice_service as oo
from backend.services.my_files_history_service import attach_history_locked, prepare_history
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

MAX_COLLABORATORS = 200

INVITE_EVENT_TYPE = "my_files.collab_invited"
INVITE_ENTITY_TYPE = "my_file"


ROLE_LABELS = {oo.ROLE_EDIT: "правка", oo.ROLE_COMMENT: "комментарии", oo.ROLE_VIEW: "просмотр"}
_INVITE_TITLES = {
    oo.ROLE_EDIT: "Вам открыт документ для совместной правки",
    oo.ROLE_COMMENT: "Вам открыт документ для комментирования",
    oo.ROLE_VIEW: "Вам открыт документ для просмотра",
}


def _notify_invited(user_id: int, *, file_id: str, file_name: str, owner_label: str, role: str = oo.ROLE_EDIT) -> None:
    """Best effort: the access is already stored, a failed notification must not undo it."""
    try:
        from backend.services.hub_service import hub_service

        hub_service.create_user_notification(
            recipient_user_id=int(user_id),
            event_type=INVITE_EVENT_TYPE,
            title=_INVITE_TITLES.get(role, _INVITE_TITLES[oo.ROLE_EDIT]),
            body=f"{owner_label or 'Пользователь'} открыл(а) вам «{file_name}»"[:300],
            entity_type=INVITE_ENTITY_TYPE,
            entity_id=file_id,
        )
    except Exception:
        logger.warning("office.invite_notification_failed user_id=%s file_id=%s", user_id, file_id, exc_info=True)


FOLDER_INVITE_EVENT_TYPE = "my_files.folder_invited"
FOLDER_INVITE_ENTITY_TYPE = "my_file_folder"
_FOLDER_INVITE_TITLES = {
    oo.ROLE_EDIT: "Вам открыта папка для совместной правки",
    oo.ROLE_COMMENT: "Вам открыта папка для комментирования",
    oo.ROLE_VIEW: "Вам открыта папка для просмотра",
}


def _notify_folder_invited(
    user_id: int, *, folder_id: str, folder_name: str, owner_label: str, role: str = oo.ROLE_EDIT
) -> None:
    """Best effort, like :func:`_notify_invited`: the grant is already stored."""
    try:
        from backend.services.hub_service import hub_service

        hub_service.create_user_notification(
            recipient_user_id=int(user_id),
            event_type=FOLDER_INVITE_EVENT_TYPE,
            title=_FOLDER_INVITE_TITLES.get(role, _FOLDER_INVITE_TITLES[oo.ROLE_EDIT]),
            body=f"{owner_label or 'Пользователь'} открыл(а) вам папку «{folder_name}»"[:300],
            entity_type=FOLDER_INVITE_ENTITY_TYPE,
            entity_id=folder_id,
        )
    except Exception:
        logger.warning("office.folder_invite_notification_failed user_id=%s folder_id=%s", user_id, folder_id, exc_info=True)


def _size_label(value: int) -> str:
    size = float(max(0, int(value or 0)))
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if size < 1024 or unit == "ГБ":
            return f"{int(size)} {unit}" if unit == "Б" else f"{size:.1f} {unit}"
        size /= 1024
    return ""


def _user_labels(session, user_ids) -> list[str]:
    """``Full Name (login)`` for each id, ordered by name; unknown ids keep a numeric placeholder."""
    ids = sorted({int(uid) for uid in user_ids})
    if not ids:
        return []
    found = {
        int(uid): (_normalize_text(full_name), _normalize_text(username))
        for uid, username, full_name in session.execute(
            select(AppUser.id, AppUser.username, AppUser.full_name).where(AppUser.id.in_(ids))
        ).all()
    }
    labels = []
    for uid in ids:
        full_name, username = found.get(uid, ("", f"user-{uid}"))
        labels.append(f"{full_name} ({username})" if full_name and full_name != username else username)
    return sorted(labels, key=str.casefold)


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
        """The live file and the caller's role: ``owner`` or the collaborator's ``edit``/``comment``/``view``."""
        row = self._live_row_locked(session, file_id)
        role = self.files.effective_role_locked(session, row, user_id)
        if not role:
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
                "is_owner": int(row.owner_user_id) == int(user_id),
                "can_manage_access": self.files.may_manage_file_access_locked(session, row, user_id),
            }

    def rename_document(self, *, settings: oo.OnlyOfficeSettings, file_id: str, name: str,
                        actor: Any, meta: MyFilesRequestMeta | None = None) -> dict[str, Any]:
        user_id = int(actor.id)
        current = self.get_editor_session(file_id=file_id, user_id=user_id)
        if current["role"] != oo.ROLE_OWNER:
            raise MyFilesNotFoundError("File not found")
        suffix = Path(current["file_name"]).suffix
        title = str(name or "").strip()
        if title.lower().endswith(suffix.lower()):
            title = title[:-len(suffix)].strip()
        if not title or any(char in title for char in ("/", "\\", "\x00")):
            raise MyFilesValidationError("Укажите имя файла без пути")
        updated = self.files.update_file(actor=actor, file_id=file_id, name=title + suffix, meta=meta)
        # Each DB transaction has ended before any HTTP request. Re-read after delivery so a delayed
        # notification cannot leave the old title behind a concurrent rename in HUB.
        notified = False
        for _ in range(3):
            try:
                latest = self.get_editor_session(file_id=file_id, user_id=user_id)
                key = oo.build_document_key(file_id, latest["revision"])
                notified = oo.notify_document_title(settings, key=key, title=latest["file_name"])
                after = self.get_editor_session(file_id=file_id, user_id=user_id)
            except MyFilesNotFoundError:
                notified = False
                break
            updated["original_file_name"] = after["file_name"]
            updated["download_file_name"] = after["file_name"]
            if (latest["file_name"], latest["revision"]) == (after["file_name"], after["revision"]):
                break
            notified = False
        return {"file": updated, "editor_notified": notified}

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
            if version.office_changes_blob_id:
                self.files._release_blob_locked(session, version.office_changes_blob_id, pending_deletes)
            session.delete(version)

    def _resolve_editor(self, session, row: AppMyFile, editor_user_ids: list[int]) -> tuple[int, str, bool]:
        """Editor to credit and whether the save is allowed.

        Document Server reports the last editor of the session; when it names users and none of them
        may edit the file any more (a collaborator removed mid-session), the save is rejected.
        """
        # a viewer cannot change the file; folder grants count like the file's own collaborators
        allowed = self.files.writer_ids_locked(session, row, oo.WRITING_ROLES)
        editor_id = next((uid for uid in reversed(editor_user_ids) if uid in allowed), int(row.owner_user_id))
        authorised = not editor_user_ids or any(uid in allowed for uid in editor_user_ids)
        user = session.get(AppUser, editor_id)
        return editor_id, _normalize_text(getattr(user, "username", "")) or f"user-{editor_id}", authorised

    def save_version(
        self, *, file_id: str, document_key: str, spool_path: Path, editor_user_ids: list[int],
        meta: MyFilesRequestMeta | None = None, history=None, changes_path: Path | None = None,
    ) -> str:
        prepared = None
        owner_id = 0
        try:
            if history and changes_path:
                with app_session(self.files._database_url_or_raise()) as session:
                    row = self._live_row_locked(session, file_id)
                    owner_id = int(row.owner_user_id)
                    eligible = (self._session_mode(session, row, document_key) != "stale"
                                and self._resolve_editor(session, row, editor_user_ids)[2])
                if eligible:
                    try:
                        prepared = prepare_history(self.files, owner_id=owner_id, history=history, changes_path=changes_path)
                    except Exception as exc:
                        # The edited document remains more important than optional editing data.
                        logger.warning("office.history_archive_unavailable file_id=%s reason=%s", file_id, type(exc).__name__)
            result = self._save_version(file_id=file_id, document_key=document_key, spool_path=spool_path,
                editor_user_ids=editor_user_ids, meta=meta, prepared_history=prepared)
            if result == "unchanged" and prepared:
                pending = []
                with app_session(self.files._database_url_or_raise()) as session:
                    row = session.scalars(select(AppMyFile).where(AppMyFile.id == file_id).with_for_update()).first()
                    row = self._live_row_locked(session, file_id)
                    if self._session_mode(session, row, document_key) == "same" and self._resolve_editor(session, row, editor_user_ids)[2]:
                        transition = session.scalars(select(AppMyFileVersion).where(
                            AppMyFileVersion.file_id == file_id, AppMyFileVersion.session_key == document_key)
                            .order_by(AppMyFileVersion.version_no.desc())).first()
                        if transition:
                            attach_history_locked(self.files, session, row=row, transition=transition,
                                prepared=prepared, pending_deletes=pending)
                self.files._delete_physical_files(pending)
            return result
        finally:
            if prepared:
                prepared.cleanup(self.files, owner_id)

    def _save_version(
        self,
        *,
        file_id: str,
        document_key: str,
        spool_path: Path,
        editor_user_ids: list[int],
        meta: MyFilesRequestMeta | None = None,
        prepared_history=None,
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
            with app_session(database_url) as session:
                row = session.get(AppMyFile, normalized_id)
                if row is not None:
                    files._write_audit(
                        session,
                        action="office_save_denied",
                        row=row,
                        actor_user_id=int(editor_user_ids[-1]),
                        actor_username=", ".join(_user_labels(session, editor_user_ids))[:50],
                        meta=meta,
                        details="Правки не сохранены: у автора больше нет доступа к файлу.",
                    )
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
                self._live_row_locked(session, normalized_id)
                editor_id, editor_name, authorised = self._resolve_editor(session, row, editor_user_ids)
                if not authorised:
                    return "forbidden"
                mode = self._session_mode(session, row, document_key)
                if mode == "stale":
                    logger.warning("office.save_stale file_id=%s", normalized_id)
                    return "stale"
                if _normalize_text(row.original_sha256).lower() == new_sha:
                    return "unchanged"
                revision = self._revision(session, normalized_id)
                growth = new_size if mode == "new" else new_size - int(row.original_size_bytes or 0)
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
                old_size = int(row.original_size_bytes or 0)
                if mode == "new":
                    # The file's reference to the old content moves into the history row.
                    transition = AppMyFileVersion(
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
                    session.add(transition)
                    session.flush()
                    self._point_row_at_blob(row, blob, size=new_size)
                    detail = (
                        f"Изменения сохранены, прежнее содержимое осталось как версия №{revision + 1}. "
                        f"Размер: {_size_label(old_size)} → {_size_label(new_size)}."
                    )
                else:
                    transition = session.scalars(select(AppMyFileVersion).where(
                        AppMyFileVersion.file_id == normalized_id, AppMyFileVersion.session_key == document_key)
                        .order_by(AppMyFileVersion.version_no.desc())).first()
                    # Autosave of an open session: replace the content saved earlier in that session.
                    self._point_row_at_blob(row, blob, size=new_size)
                    files._release_blob_locked(session, previous_blob_id, pending_deletes)
                    detail = (
                        f"Дополнены изменения той же сессии редактирования. "
                        f"Размер: {_size_label(old_size)} → {_size_label(new_size)}."
                    )
                if transition:
                    attach_history_locked(files, session, row=row, transition=transition,
                        prepared=prepared_history, pending_deletes=pending_deletes)
                self._prune_versions_locked(session, normalized_id, pending_deletes)
                files._queue_preview_for_row_locked(session, row)
                files._write_audit(
                    session,
                    action="office_saved",
                    row=row,
                    actor_user_id=editor_id,
                    actor_username=editor_name,
                    meta=meta,
                    details=detail,
                )
        finally:
            if final_path is not None and not persisted_new_blob:
                files._delete_physical_file(final_path)
        files._delete_physical_files(pending_deletes)
        return "saved"

    # -- version history --------------------------------------------------------------------

    def list_versions(self, *, file_id: str, user_id: int) -> dict[str, Any]:
        """Retired versions (newest first) with who wrote each one, plus the current content.

        A version row stores the editor whose save retired it, so the author of a version is the editor
        recorded on the previous row (the uploader for the first one) and the author of the current
        content is the editor on the newest row.
        """
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row, _role = self._access_locked(session, file_id, user_id)
            versions = session.scalars(
                select(AppMyFileVersion)
                .where(AppMyFileVersion.file_id == row.id)
                .order_by(AppMyFileVersion.version_no.asc())
            ).all()
            uploader = _normalize_text(row.owner_username)
            if row.uploaded_by_user_id:
                uploader_user = session.get(AppUser, int(row.uploaded_by_user_id))
                uploader = _normalize_text(getattr(uploader_user, "username", "")) or uploader
            created_at = _coerce_utc(row.created_at)
            author, authored_at = uploader, created_at
            items: list[dict[str, Any]] = []
            for version in versions:
                items.append(
                    {
                        "id": version.id,
                        "version_no": int(version.version_no),
                        "size_bytes": int(version.original_size_bytes or 0),
                        "replaced_by": _normalize_text(version.created_by_username),
                        "replaced_at": _coerce_utc(version.created_at),
                        "author": author,
                        "authored_at": authored_at,
                    }
                )
                author = _normalize_text(version.created_by_username) or author
                authored_at = _coerce_utc(version.created_at)
            items.reverse()
            current = {
                "author": author,
                "authored_at": _coerce_utc(row.updated_at) or authored_at,
                "size_bytes": int(row.original_size_bytes or 0),
            }
            return {"items": items, "current": current}

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
            row, role = self._access_locked(session, file_id, user_id)
            if role not in oo.EDITING_ROLES:
                raise MyFilesValidationError("Your access level does not allow restoring versions")
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
            restored_no = int(version.version_no)
            if version.office_changes_blob_id:
                files._release_blob_locked(session, version.office_changes_blob_id, pending_deletes)
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
                details=(
                    f"Возвращена версия №{restored_no} ({_size_label(restored_size)}); "
                    f"текущее содержимое сохранено как версия №{revision + 1}."
                ),
            )
        files._delete_physical_files(pending_deletes)

    # -- collaborators ----------------------------------------------------------------------

    def _owned_row_locked(self, session, file_id: str, owner_user_id: int) -> AppMyFile:
        row = self._live_row_locked(session, file_id)
        if not self.files.may_manage_file_access_locked(session, row, owner_user_id):
            raise MyFilesNotFoundError("File not found")
        return row

    def collaborator_settings(self, *, file_id: str, user_id: int) -> dict[str, Any]:
        with app_session(self.files._database_url_or_raise()) as session:
            row = self._owned_row_locked(session, file_id, user_id)
            library = self.files._library_by_owner_locked(session, row.owner_user_id)
            owner_id = int(row.uploaded_by_user_id or 0) if library else int(row.owner_user_id)
            owner = session.get(AppUser, owner_id) if owner_id > 0 else None
            chain = self.files._folder_chain_locked(session, row.folder_id, row.owner_user_id)
            inherited = bool(library)
            if chain and self.files._folder_shares_present(session):
                inherited = inherited or bool(session.scalar(select(AppMyFileFolderCollaborator.user_id)
                    .where(AppMyFileFolderCollaborator.folder_id.in_(chain)).limit(1)))
            return {
                "items": self._collaborators_locked(session, row.id),
                "owner": {"user_id": owner_id, "username": owner.username, "full_name": owner.full_name or "", "role": "owner"} if owner else None,
                "owner_kind": "author" if library else "owner",
                "inherited_access": inherited,
                "library_name": _normalize_text(library.name) if library else "",
            }

    def list_collaborators(self, *, file_id: str, owner_user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._owned_row_locked(session, file_id, owner_user_id)
            return self._collaborators_locked(session, row.id)

    @staticmethod
    def _collaborators_locked(session, file_id: str) -> list[dict[str, Any]]:
        rows = session.execute(
            select(AppMyFileCollaborator.user_id, AppUser.username, AppUser.full_name, AppMyFileCollaborator.role)
            .join(AppUser, AppUser.id == AppMyFileCollaborator.user_id)
            .where(AppMyFileCollaborator.file_id == file_id)
            .order_by(AppUser.username.asc())
        ).all()
        return [
            {
                "user_id": int(user_id),
                "username": _normalize_text(username),
                "full_name": _normalize_text(full_name),
                "role": oo.normalize_role(role),
            }
            for user_id, username, full_name, role in rows
        ]

    @staticmethod
    def _change_details(session, wanted: dict[int, str], added, changed, removed) -> str:
        """Journal text: who got which role, whose role changed, who lost access."""
        parts = []
        for role in oo.COLLABORATOR_ROLES:
            names = _user_labels(session, [uid for uid in added if wanted[uid] == role])
            if names:
                parts.append(f"Добавлены ({ROLE_LABELS[role]}): " + ", ".join(names))
        for role in oo.COLLABORATOR_ROLES:
            names = _user_labels(session, [uid for uid in changed if wanted[uid] == role])
            if names:
                parts.append(f"Доступ изменён на «{ROLE_LABELS[role]}»: " + ", ".join(names))
        if removed:
            parts.append("Убраны: " + ", ".join(_user_labels(session, removed)))
        return ". ".join(parts) + "."

    def _wanted_members(self, members: list[tuple[int, str]], owner_user_id: int) -> dict[int, str]:
        wanted: dict[int, str] = {}
        for raw_id, raw_role in members:
            uid = int(raw_id)
            if uid != int(owner_user_id):
                wanted[uid] = oo.normalize_role(raw_role)
        if len(wanted) > MAX_COLLABORATORS:
            raise MyFilesValidationError(f"At most {MAX_COLLABORATORS} collaborators are allowed")
        return wanted

    @staticmethod
    def _require_active_users(session, wanted: dict[int, str]) -> None:
        if not wanted:
            return
        active = set(
            session.scalars(select(AppUser.id).where(AppUser.id.in_(list(wanted)), AppUser.is_active.is_(True))).all()
        )
        if active != set(wanted):
            raise MyFilesValidationError("Unknown or inactive user")

    # -- folder access ----------------------------------------------------------------------

    def _owned_folder_locked(self, session, folder_id: str, owner_user_id: int) -> AppMyFileFolder:
        folder = session.get(AppMyFileFolder, _normalize_text(folder_id))
        if (folder is None or folder.deleted_at is not None or int(folder.owner_user_id) < 0
                or (int(folder.owner_user_id) != int(owner_user_id) and not self.files.is_admin_locked(session, owner_user_id))):
            raise MyFilesNotFoundError("Folder not found")
        return folder

    @staticmethod
    def _folder_members_locked(session, folder_id: str) -> list[dict[str, Any]]:
        rows = session.execute(
            select(
                AppMyFileFolderCollaborator.user_id,
                AppUser.username,
                AppUser.full_name,
                AppMyFileFolderCollaborator.role,
            )
            .join(AppUser, AppUser.id == AppMyFileFolderCollaborator.user_id)
            .where(AppMyFileFolderCollaborator.folder_id == folder_id)
            .order_by(AppUser.username.asc())
        ).all()
        return [
            {
                "user_id": int(user_id),
                "username": _normalize_text(username),
                "full_name": _normalize_text(full_name),
                "role": oo.normalize_role(role),
            }
            for user_id, username, full_name, role in rows
        ]

    def list_folder_collaborators(self, *, folder_id: str, owner_user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            folder = self._owned_folder_locked(session, folder_id, owner_user_id)
            if not self.files._folder_shares_present(session):
                return []
            return self._folder_members_locked(session, folder.id)

    def set_folder_collaborators(
        self,
        *,
        folder_id: str,
        owner_user_id: int,
        members: list[tuple[int, str]],
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> list[dict[str, Any]]:
        """Replace the access list of a folder: every file inside, now and later, gets the member's role."""
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            folder = self._owned_folder_locked(session, folder_id, owner_user_id)
            wanted = self._wanted_members(members, int(folder.owner_user_id))
            if not self.files._folder_shares_present(session):
                raise MyFilesValidationError("Folder sharing is not available yet")
            self._require_active_users(session, wanted)
            current = {
                int(item.user_id): item
                for item in session.scalars(
                    select(AppMyFileFolderCollaborator).where(AppMyFileFolderCollaborator.folder_id == folder.id)
                ).all()
            }
            removed = [uid for uid in current if uid not in wanted]
            if removed:
                session.execute(
                    delete(AppMyFileFolderCollaborator).where(
                        AppMyFileFolderCollaborator.folder_id == folder.id,
                        AppMyFileFolderCollaborator.user_id.in_(removed),
                    )
                )
            added = [uid for uid in wanted if uid not in current]
            changed = [
                uid for uid, item in current.items() if uid in wanted and oo.normalize_role(item.role) != wanted[uid]
            ]
            for uid in changed:
                current[uid].role = wanted[uid]
            now = _utc_now()
            for uid in added:
                session.add(
                    AppMyFileFolderCollaborator(
                        folder_id=folder.id,
                        user_id=uid,
                        added_by_user_id=int(owner_user_id),
                        role=wanted[uid],
                        created_at=now,
                    )
                )
            session.flush()
            folder_name = _normalize_text(folder.name)
            if removed or added or changed:
                self.files._write_audit(
                    session,
                    action="folder_access_changed",
                    row=None,
                    actor=actor,
                    meta=meta,
                    details=f"Папка «{folder_name}». " + self._change_details(session, wanted, added, changed, removed),
                )
            result = self._folder_members_locked(session, folder.id)
            owner_label = (
                _normalize_text(getattr(actor, "full_name", ""))
                or _normalize_text(getattr(actor, "username", ""))
                or _normalize_text(session.scalar(select(AppUser.username).where(AppUser.id == int(owner_user_id))))
            )
            shared_folder_id = folder.id
            to_notify = [(uid, wanted[uid]) for uid in added + changed]
        for uid, role in to_notify:
            _notify_folder_invited(
                uid, folder_id=shared_folder_id, folder_name=folder_name, owner_label=owner_label, role=role
            )
        return result

    def set_collaborators(
        self,
        *,
        file_id: str,
        owner_user_id: int,
        members: list[tuple[int, str]],
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> list[dict[str, Any]]:
        """Replace the whole list: ``members`` are ``(user_id, role)`` pairs, the last pair of a user wins."""
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            row = self._owned_row_locked(session, file_id, owner_user_id)
            principal = int(row.owner_user_id) if int(row.owner_user_id) > 0 else int(row.uploaded_by_user_id or 0)
            wanted = self._wanted_members(members, principal)
            self._require_active_users(session, wanted)
            current = {
                int(item.user_id): item
                for item in session.scalars(
                    select(AppMyFileCollaborator).where(AppMyFileCollaborator.file_id == row.id)
                ).all()
            }
            removed = [uid for uid in current if uid not in wanted]
            if removed:
                session.execute(
                    delete(AppMyFileCollaborator).where(
                        AppMyFileCollaborator.file_id == row.id,
                        AppMyFileCollaborator.user_id.in_(removed),
                    )
                )
            now = _utc_now()
            added = [uid for uid in wanted if uid not in current]
            changed = [
                uid for uid, item in current.items()
                if uid in wanted and oo.normalize_role(item.role) != wanted[uid]
            ]
            previous_roles = {uid: oo.normalize_role(current[uid].role) for uid in changed}
            for uid in changed:
                current[uid].role = wanted[uid]
            for uid in added:
                session.add(
                    AppMyFileCollaborator(
                        file_id=row.id,
                        user_id=uid,
                        added_by_user_id=int(owner_user_id),
                        role=wanted[uid],
                        created_at=now,
                    )
                )
            session.flush()
            if removed or added or changed:
                self.files._write_audit(
                    session,
                    action="collaborators_changed",
                    row=row,
                    actor=actor,
                    meta=meta,
                    details=self._change_details(session, wanted, added, changed, removed),
                )
            result = self._collaborators_locked(session, row.id)
            file_name = _normalize_text(row.original_file_name)
            owner_label = (
                _normalize_text(getattr(actor, "full_name", ""))
                or _normalize_text(getattr(actor, "username", ""))
                or _normalize_text(row.owner_username)
            )
            shared_file_id = row.id
            to_notify = [(uid, wanted[uid]) for uid in added + changed]
        for uid, role in to_notify:
            _notify_invited(uid, file_id=shared_file_id, file_name=file_name, owner_label=owner_label, role=role)
        return result

    # -- one link ---------------------------------------------------------------------------

    def public_editor_access(self, *, token: str, user_id: int | None) -> dict[str, Any]:
        """What the visitor of a public link may do besides downloading.

        Guests (and users who are not on the list) only download; a collaborator or the owner who
        is signed in gets ``can_open`` with the file id and the role.
        """
        database_url = self.files._database_url_or_raise()
        settings = oo.load_settings()
        ready = bool(settings.enabled and settings.jwt_secret and settings.internal_url and settings.app_base_url)
        with app_session(database_url) as session:
            row = self.files._public_row_locked(session, token)
            editable = ready and bool(oo.document_type_for(row.original_file_name))
            collaborative = False
            role = ""
            if editable and self.files._collab_tables_present(session):
                collaborative = session.execute(
                    select(AppMyFileCollaborator.user_id).where(AppMyFileCollaborator.file_id == row.id).limit(1)
                ).first() is not None or bool(
                    self.files.folder_grant_user_ids_locked(session, row.folder_id, row.owner_user_id)
                )
                if user_id:
                    role = self.files.effective_role_locked(session, row, int(user_id))
            return {
                "signed_in": bool(user_id),
                "editable": editable,
                "collaborative": collaborative,
                "can_open": bool(role),
                "role": role,
                "file_id": row.id if role else "",
            }

    # -- groups -----------------------------------------------------------------------------

    @staticmethod
    def list_groups() -> list[dict[str, Any]]:
        """Departments that can be added to a file at once (members are copied, not linked)."""
        from backend.services.department_service import department_service

        return [
            {
                "id": str(item.get("id") or ""),
                "name": _normalize_text(item.get("name")),
                "members_count": int(item.get("members_count") or 0) + int(item.get("managers_count") or 0),
            }
            for item in department_service.list_departments()
            if str(item.get("id") or "")
        ]

    def list_group_members(self, *, group_id: str) -> list[dict[str, Any]]:
        from backend.services.department_service import department_service

        if not department_service.get_department(group_id):
            raise MyFilesNotFoundError("Group not found")
        member_ids = {int(item["user_id"]) for item in department_service.list_memberships(department_id=group_id)}
        if not member_ids:
            return []
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            rows = session.execute(
                select(AppUser.id, AppUser.username, AppUser.full_name)
                .where(AppUser.id.in_(member_ids), AppUser.is_active.is_(True))
                .order_by(AppUser.username.asc())
            ).all()
        return [
            {"user_id": int(uid), "username": _normalize_text(username), "full_name": _normalize_text(full_name)}
            for uid, username, full_name in rows
        ]

    def list_shared_with_me(self, *, user_id: int) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        now = _utc_now()
        with app_session(database_url) as session:
            shared = self.files.shared_rows_locked(session, int(user_id), now)
            owners = {
                int(uid): _normalize_text(username)
                for uid, username in session.execute(
                    select(AppUser.id, AppUser.username).where(
                        AppUser.id.in_({int(file_row.owner_user_id) for file_row, _role in shared} or {0})
                    )
                ).all()
            }
            return [
                {
                    "id": file_row.id,
                    "file_name": _normalize_text(file_row.original_file_name),
                    "owner_username": owners.get(int(file_row.owner_user_id)) or _normalize_text(file_row.owner_username),
                    "size_bytes": int(file_row.original_size_bytes or 0),
                    "updated_at": _coerce_utc(file_row.updated_at),
                    "editable": bool(oo.document_type_for(file_row.original_file_name)),
                    "role": oo.normalize_role(role),
                }
                for file_row, role in shared
            ]


my_files_collab_service = MyFilesCollabService()
