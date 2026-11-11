"""Administrator metadata browser. Content still uses the normal guarded file routes."""
from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased

from backend.appdb.db import app_session
from backend.appdb.models import AppMyFile, AppMyFileFolder, AppMyFileLibrary, AppMyFilePreview, AppUser
from backend.services.my_files_service import MyFilesNotFoundError, _coerce_utc, _normalize_text, _utc_now, my_files_service


class MyFilesAdminService:
    def __init__(self, files=None):
        self.files = files or my_files_service

    def list_files(self, *, actor, query="", owner_user_id=None, scope="all", state="active", limit=50, offset=0, file_id=None):
        with app_session(self.files._database_url_or_raise()) as session:
            if not self.files.is_admin_locked(session, int(actor.id)):
                raise MyFilesNotFoundError("Administrator access required")
            owner, uploader = aliased(AppUser), aliased(AppUser)
            statement = (select(AppMyFile, owner.username, owner.full_name, uploader.username,
                                AppMyFileFolder.name, AppMyFileLibrary.id, AppMyFileLibrary.name)
                         .outerjoin(owner, owner.id == AppMyFile.owner_user_id)
                         .outerjoin(uploader, uploader.id == AppMyFile.uploaded_by_user_id)
                         .outerjoin(AppMyFileFolder, AppMyFileFolder.id == AppMyFile.folder_id)
                         .outerjoin(AppMyFileLibrary, AppMyFileLibrary.owner_user_id == AppMyFile.owner_user_id))
            if file_id:
                statement = statement.where(AppMyFile.id == file_id)
            if state == "active":
                statement = statement.where(AppMyFile.deleted_at.is_(None), AppMyFile.status != "deleted")
            elif state == "trash":
                statement = statement.where(AppMyFile.deleted_at.is_not(None), AppMyFile.status != "deleted")
            if owner_user_id is not None:
                statement = statement.where(AppMyFile.owner_user_id == int(owner_user_id))
            if scope == "personal":
                statement = statement.where(AppMyFile.owner_user_id > 0)
            elif scope == "library":
                statement = statement.where(AppMyFile.owner_user_id < 0)
            needle = _normalize_text(query)
            if needle:
                pattern = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                statement = statement.where(or_(*[
                    column.ilike(pattern, escape="\\") for column in (
                        AppMyFile.original_file_name, owner.username, owner.full_name,
                        uploader.username, AppMyFileFolder.name, AppMyFileLibrary.name,
                    )
                ]))
            total = int(session.scalar(select(func.count()).select_from(statement.subquery())) or 0)
            rows = session.execute(statement.order_by(AppMyFile.updated_at.desc(), AppMyFile.id)
                                   .limit(limit).offset(offset)).all()
            counts = self.files._collab_counts_locked(session, [row.id for row, *_ in rows])
            blob_ids = {row.blob_id for row, *_ in rows if row.blob_id}
            previews = {preview.blob_id: preview for preview in session.scalars(
                select(AppMyFilePreview).where(AppMyFilePreview.blob_id.in_(blob_ids))
            ).all()} if blob_ids else {}
            now = _utc_now()
            items = []
            for row, username, full_name, uploader_name, folder_name, library_id, library_name in rows:
                expires_at = _coerce_utc(row.expires_at)
                available = (row.deleted_at is None and row.status == "ready"
                             and (expires_at is None or expires_at > now)
                             and self.files._security_scan_allows_access(row))
                item = self.files._response(row, session=session, viewer_user_id=int(actor.id),
                                            preview=previews.get(row.blob_id), folder_name=folder_name or "",
                                            collaborators_count=counts.get(row.id, 0))
                item.update(owner_user_id=int(row.owner_user_id),
                            owner_username=username or row.owner_username,
                            owner_label=library_name or full_name or username or row.owner_username,
                            uploaded_by_user_id=row.uploaded_by_user_id,
                            uploaded_by_username=uploader_name or (username or row.owner_username if row.owner_user_id > 0 else ""),
                            library_id=library_id, library_name=library_name or "",
                            deleted_at=_coerce_utc(row.deleted_at), can_open=available,
                            can_manage_access=available,
                            can_restore=row.deleted_at is not None and row.status != "deleted")
                items.append(item)
            return {"items": items, "total": total, "limit": limit, "offset": offset}

    def get_file(self, *, actor, file_id):
        result = self.list_files(actor=actor, file_id=file_id, state="all", limit=1)
        if not result["items"]:
            raise MyFilesNotFoundError("File not found")
        return result["items"][0]


my_files_admin_service = MyFilesAdminService()
