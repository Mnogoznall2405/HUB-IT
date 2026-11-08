"""ONLYOFFICE history snapshots and signed, revocable access to their editing data."""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.models import AppMyFileBlob, AppMyFileVersion, AppUser
from backend.services import onlyoffice_service as oo
from backend.services.my_files_service import (
    DownloadPayload, MyFilesNotFoundError, MyFilesValidationError,
    STORAGE_STORED, _coerce_utc, _sha256_file, _utc_now,
)
from backend.services.my_files_storage_layout import publish_local_to_blob

logger = logging.getLogger(__name__)
MAX_CHANGES_BYTES = 32 * 1024 * 1024
MAX_HISTORY_JSON_BYTES = 2 * 1024 * 1024


def normalize_history(value):
    if not isinstance(value, dict) or not isinstance(value.get("serverVersion"), str) or not 1 <= len(value["serverVersion"]) <= 64:
        return ""
    changes = value.get("changes")
    if not isinstance(changes, list) or not changes or len(changes) > 10000:
        return ""
    clean = []
    for change in changes:
        if not isinstance(change, dict) or not isinstance(change.get("user"), dict):
            return ""
        user = change["user"]
        created, uid, name = change.get("created"), user.get("id"), user.get("name")
        if not isinstance(created, str) or len(created) > 64 or not isinstance(uid, (str, int)) or not isinstance(name, str) or len(name) > 256 or len(str(uid)) > 128:
            return ""
        clean.append({"created": created, "user": {"id": str(uid), "name": name}})
    result = json.dumps({"serverVersion": value["serverVersion"], "changes": clean}, ensure_ascii=False)
    return result if len(result.encode("utf-8")) <= MAX_HISTORY_JSON_BYTES else ""


@dataclass
class PreparedHistory:
    history_json: str
    sha: str
    size: int
    relative_path: str
    published_path: Path | None = None

    def cleanup(self, files, owner_id):
        if self.published_path is None:
            return
        with app_session(files._database_url_or_raise()) as session:
            referenced = session.scalar(select(AppMyFileBlob.id).where(AppMyFileBlob.owner_user_id == owner_id,
                AppMyFileBlob.storage_path == self.relative_path, AppMyFileBlob.ref_count > 0)) is not None
        if not referenced:
            files._delete_physical_file(self.published_path)


def prepare_history(files, *, owner_id, history, changes_path):
    history_json = normalize_history(history)
    if not history_json or changes_path is None:
        return None
    sha, size = _sha256_file(changes_path)
    if not 0 < size <= MAX_CHANGES_BYTES:
        raise MyFilesValidationError("Editing archive is too large")
    with ZipFile(changes_path) as archive:
        entries = archive.infolist()
        if (not entries or len(entries) > 1000 or sum(item.file_size for item in entries) > 256 * 1024 * 1024
                or any(item.flag_bits & 1 or ".." in PurePosixPath(item.filename.replace("\\", "/")).parts
                       or item.filename.startswith(("/", "\\")) for item in entries)
                or archive.testzip() is not None):
            raise MyFilesValidationError("Invalid editing archive")
    scan = files._run_antivirus(changes_path, "office-changes.zip", size)
    if scan.status != "clean" and not files._security_scan_is_size_limited(scan.status, scan.engine):
        raise MyFilesValidationError("Editing archive did not pass security scan")
    # Each in-flight callback owns its publication path. Rolling back one callback must not
    # delete an identical archive concurrently committed by another callback. DB dedup remains by SHA.
    canonical = Path(files._blob_relative_path(owner_id, sha, ".zip"))
    relative = canonical.with_name(f"{sha[:16]}-history-{uuid.uuid4().hex}.zip").as_posix()
    target = files._resolve_stored_path(relative)
    publish_local_to_blob(source=changes_path, destination=target, expected_sha256=sha, expected_size=size)
    return PreparedHistory(history_json, sha, size, relative, target)


def attach_history_locked(files, session, *, row, transition, prepared, pending_deletes):
    """The file row is locked by the caller. A missing archive never gets attributed to new content."""
    if prepared is None and transition.office_result_blob_id == row.blob_id:
        return
    old_id = transition.office_changes_blob_id or ""
    old_size = int(transition.office_changes_size_bytes or 0)
    if prepared and files._quota_used_locked(session, row.owner_user_id) + prepared.size - old_size > files._user_quota_limit_locked(session, row.owner_user_id):
        logger.warning("office.history_quota_exceeded file_id=%s", row.id)
        prepared = None
    new_id = ""
    if prepared:
        blob = files._find_owner_blob(session, owner_user_id=row.owner_user_id, original_sha256=prepared.sha)
        if blob is None:
            blob = AppMyFileBlob(id=uuid.uuid4().hex, owner_user_id=row.owner_user_id, original_sha256=prepared.sha,
                storage_path=prepared.relative_path, storage_mode=STORAGE_STORED, stored_sha256=prepared.sha,
                original_size_bytes=prepared.size, stored_size_bytes=prepared.size, output_mime_type="application/zip",
                output_extension=".zip", ref_count=0, created_at=_utc_now(), updated_at=_utc_now(), last_used_at=_utc_now())
            session.add(blob)
            session.flush()
        new_id = blob.id
        if new_id != old_id:
            blob.ref_count = int(blob.ref_count or 0) + 1
        blob.last_used_at = _utc_now()
    if old_id and old_id != new_id:
        files._release_blob_locked(session, old_id, pending_deletes)
    transition.office_result_blob_id = row.blob_id
    transition.office_history_json = prepared.history_json if prepared else ""
    transition.office_changes_blob_id = new_id
    transition.office_changes_size_bytes = prepared.size if prepared else 0


class MyFilesHistoryService:
    def __init__(self, collab):
        self.collab = collab
        self.files = collab.files

    def _snapshots(self, session, row):
        versions = session.scalars(select(AppMyFileVersion).where(AppMyFileVersion.file_id == row.id)
                                   .order_by(AppMyFileVersion.version_no)).all()
        snapshots = []
        for index, version in enumerate([*versions, None]):
            number = int(version.version_no) if version else self.collab._revision(session, row.id) + 1
            previous = versions[index - 1] if index else None
            adjacent = previous is not None and previous.version_no + 1 == number
            uploader_id = int(row.uploaded_by_user_id or (row.owner_user_id if row.owner_user_id > 0 else 0))
            author_id = previous.created_by_user_id if adjacent else uploader_id if number == 1 else 0
            author = session.get(AppUser, author_id) if author_id else None
            name = (author.full_name or author.username) if author else previous.created_by_username if adjacent else "Автор не указан"
            blob_id = version.blob_id if version else row.blob_id
            transition = previous if adjacent and previous.office_result_blob_id == blob_id else None
            changes = None
            if transition and transition.office_history_json and transition.office_changes_blob_id:
                try:
                    changes = json.loads(transition.office_history_json)
                except ValueError:
                    pass
            snapshots.append({"version": number, "id": version.id if version else "current", "blob_id": blob_id,
                "key": hashlib.sha256(f"history:{row.id}:{number}:{blob_id}".encode()).hexdigest()[:40],
                "user": {"id": str(author_id), "name": name},
                "created": str(_coerce_utc(previous.created_at if adjacent else row.created_at) or ""),
                "transition": transition if changes else None, "editing": changes})
        return snapshots

    def _access(self, session, file_id, user_id):
        user = session.get(AppUser, user_id)
        if not user or not user.is_active:
            raise MyFilesNotFoundError("File not found")
        return self.collab._access_locked(session, file_id, user_id)[0]

    def list_history(self, *, file_id, user_id):
        with app_session(self.files._database_url_or_raise()) as session:
            row = self._access(session, file_id, user_id)
            snapshots = self._snapshots(session, row)
            # The SDK walks this array backwards and takes the preceding entry as the base version.
            return {"currentVersion": snapshots[-1]["version"], "history": [
                {key: snapshot[key] for key in ("version", "key", "user", "created")}
                | (snapshot["editing"] or {}) for snapshot in snapshots]}

    def _asset_url(self, settings, *, row, user_id, version_id, blob_id, kind):
        token = oo.make_url_token(settings, "hist", {"fid": row.id, "uid": int(user_id), "vid": version_id,
            "bid": blob_id, "kind": kind}, ttl_sec=oo.SOURCE_TOKEN_TTL_SEC)
        return f"{settings.app_base_url}/api/v1/my-files/office/history/source?t={token}"

    def history_data(self, *, settings, file_id, user_id, version_no=None):
        with app_session(self.files._database_url_or_raise()) as session:
            row = self._access(session, file_id, user_id)
            snapshots = self._snapshots(session, row)
            snapshot = next((item for item in snapshots if item["version"] == version_no), None) if version_no is not None else snapshots[-1]
            if snapshot is None:
                raise MyFilesNotFoundError("Version not found")
            file_type = Path(row.original_file_name).suffix.lstrip(".").lower()
            data = {"version": snapshot["version"], "key": snapshot["key"], "fileType": file_type,
                "url": self._asset_url(settings, row=row, user_id=user_id, version_id=snapshot["id"], blob_id=snapshot["blob_id"], kind="content")}
            transition = snapshot["transition"]
            if transition:
                previous = next(item for item in snapshots if item["id"] == transition.id)
                data["previous"] = {"key": previous["key"], "fileType": file_type,
                    "url": self._asset_url(settings, row=row, user_id=user_id, version_id=transition.id, blob_id=transition.blob_id, kind="content")}
                data["changesUrl"] = self._asset_url(settings, row=row, user_id=user_id, version_id=transition.id, blob_id=transition.office_changes_blob_id, kind="changes")
            data["token"] = oo.sign_browser_payload(settings, data)
            return {"data": data, "changes_available": bool(transition)}

    def viewer_config(self, *, settings, file_id, user_id, username):
        result = self.history_data(settings=settings, file_id=file_id, user_id=user_id)
        source = self.collab.get_editor_session(file_id=file_id, user_id=user_id)
        config = oo.build_editor_config(settings, file_id=file_id, file_name=source["file_name"],
            blob_id=source["blob_id"], revision=source["revision"], user_id=user_id, user_name=username, role=oo.ROLE_VIEW)
        config["document"].update(key=result["data"]["key"], url=result["data"]["url"])
        config["editorConfig"].pop("callbackUrl", None)
        config["editorConfig"]["customization"]["close"] = {"visible": True, "text": "Вернуться к документу"}
        config["token"] = oo.sign_browser_payload(settings, {key: value for key, value in config.items() if key != "token"})
        return {"config": config, "public_path": settings.public_path}

    def resolve_asset(self, *, file_id, user_id, version_id, blob_id, kind):
        with app_session(self.files._database_url_or_raise()) as session:
            row = self._access(session, file_id, user_id)
            version = session.get(AppMyFileVersion, version_id) if version_id != "current" else None
            if version_id != "current" and (not version or version.file_id != row.id):
                raise MyFilesNotFoundError("Version not found")
            expected = version.office_changes_blob_id if kind == "changes" and version else version.blob_id if version else row.blob_id
            if kind not in {"content", "changes"} or expected != blob_id or (kind == "changes" and version is None):
                raise MyFilesNotFoundError("Version not found")
            blob = session.get(AppMyFileBlob, blob_id)
            if blob is None:
                raise MyFilesNotFoundError("Version not found")
            path = self.files._resolve_stored_path(blob.storage_path)
            if not path.is_file():
                raise MyFilesNotFoundError("Version not found")
            return DownloadPayload(path=path, mode=blob.storage_mode, file_name="changes.zip" if kind == "changes" else row.original_file_name,
                media_type="application/zip" if kind == "changes" else row.mime_type, download_size_bytes=blob.original_size_bytes, file_id=row.id)
