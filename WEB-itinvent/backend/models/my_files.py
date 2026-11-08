"""API schemas for the personal file storage feature."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MyFileResponse(BaseModel):
    id: str
    original_file_name: str
    download_file_name: str
    mime_type: str
    download_mime_type: str
    original_size_bytes: int
    stored_size_bytes: int
    saved_size_bytes: int
    retention_days: int
    folder_id: str | None = None
    status: str
    storage_mode: str
    error_text: str = ""
    security_scan_status: str = "pending"
    preview_kind: str = "unsupported"
    preview_available: bool = False
    preview_status: str = "unsupported"
    preview_max_bytes: int = 0
    is_shared: bool = False
    is_favorite: bool = False
    collaborators_count: int = 0
    shared_with_me: bool = False
    can_manage_access: bool = False
    my_role: str = ""
    owner_username: str = ""
    folder_name: str = ""
    # Set only on rows that come from a shared library but are listed outside it (recent files, search).
    library_id: str | None = None
    library_name: str = ""
    share_expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None


class MyFileFolderResponse(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    file_count: int = 0
    is_shared: bool = False
    is_favorite: bool = False
    collaborators_count: int = 0
    shared_with_me: bool = False
    my_role: str = ""
    owner_username: str = ""
    library_id: str | None = None
    library_name: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MyFileCopyRequest(BaseModel):
    """Where the copy goes: a folder (of the disk or of a library), a library root, or the disk root."""

    folder_id: str | None = Field(default=None, max_length=64)
    library_id: str | None = Field(default=None, max_length=64)


class MyFileBlankDocumentRequest(BaseModel):
    kind: str = Field(min_length=1, max_length=8)
    name: str | None = Field(default=None, max_length=255)
    folder_id: str | None = Field(default=None, max_length=64)
    library_id: str | None = Field(default=None, max_length=64)


class MyFileFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: str | None = Field(default=None, max_length=64)
    library_id: str | None = Field(default=None, max_length=64)


class MyFileFolderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: str | None = Field(default=None, max_length=64)
    is_favorite: bool | None = None


class MyFileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=512)
    folder_id: str | None = Field(default=None, max_length=64)
    is_favorite: bool | None = None


class MyFileLibraryInfo(BaseModel):
    id: str
    name: str
    my_role: str = ""


class MyFileListResponse(BaseModel):
    items: list[MyFileResponse] = Field(default_factory=list)
    folders: list[MyFileFolderResponse] = Field(default_factory=list)
    breadcrumbs: list[MyFileFolderResponse] = Field(default_factory=list)
    folder: MyFileFolderResponse | None = None
    library: MyFileLibraryInfo | None = None


class MyFileFolderListResponse(BaseModel):
    items: list[MyFileFolderResponse] = Field(default_factory=list)


class MyFileTrashResponse(BaseModel):
    items: list[MyFileResponse] = Field(default_factory=list)
    folders: list[MyFileFolderResponse] = Field(default_factory=list)


class MyFileQuotaResponse(BaseModel):
    used_bytes: int
    limit_bytes: int
    remaining_bytes: int


class MyFileUploadSessionCreateRequest(BaseModel):
    file_name: str = Field(min_length=1, max_length=512)
    file_size: int = Field(gt=0)
    retention_days: int = 1
    mime_type: str = Field(default="application/octet-stream", max_length=255)
    folder_id: str | None = Field(default=None, max_length=64)
    library_id: str | None = Field(default=None, max_length=64)


class MyFileUploadSessionResponse(BaseModel):
    file_id: str
    chunk_size_bytes: int
    uploaded_bytes: int
    file_size_bytes: int
    ranges: list[list[int]] = Field(default_factory=list)
    complete: bool = False


class MyFileShareResponse(BaseModel):
    token: str
    public_path: str
    expires_at: datetime | None = None


class PublicMyFolderFileResponse(BaseModel):
    id: str
    file_name: str
    relative_path: str = ""
    size_bytes: int
    mime_type: str
    preview_kind: str = "unsupported"
    preview_available: bool = False
    expires_at: datetime | None = None


class PublicMyFolderResponse(BaseModel):
    folder_name: str
    share_created_at: datetime | None = None
    items: list[PublicMyFolderFileResponse] = Field(default_factory=list)


class PublicMyFilePreviewResponse(BaseModel):
    preview_kind: str
    source_kind: str = ""
    source_filename: str = ""
    pdf_filename: str = ""
    page_count: int = 0
    sheets: list[dict] = Field(default_factory=list)
    preview_url: str = ""


class PublicMyFileResponse(BaseModel):
    file_name: str
    size_bytes: int
    mime_type: str
    expires_at: datetime | None = None
    preview_kind: str = "unsupported"
    preview_available: bool = False
    preview_max_bytes: int = 0


class MyFileDownloadGrantResponse(BaseModel):
    download_path: str
    expires_at: datetime | None = None
    expires_in_seconds: int = 120


class MyFileAuditItemResponse(BaseModel):
    id: int
    file_id: str | None = None
    action: str
    actor_user_id: int
    actor_username: str
    ip_address: str
    user_agent: str
    details: str = ""
    created_at: datetime | None = None


class MyFileAuditResponse(BaseModel):
    items: list[MyFileAuditItemResponse] = Field(default_factory=list)
    download_count: int = 0
    unique_download_ips: int = 0


class MyFilesAdminUserStat(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    files_count: int = 0
    used_bytes: int = 0
    shared_count: int = 0
    folders_count: int = 0
    active_uploads: int = 0
    last_activity_at: datetime | None = None
    quota_limit_bytes: int = 0
    quota_is_custom: bool = False


class MyFilesAdminTotals(BaseModel):
    files_count: int = 0
    used_bytes: int = 0
    stored_bytes: int = 0
    storage_total_bytes: int = 0
    storage_free_bytes: int = 0
    shared_count: int = 0
    active_uploads: int = 0
    processing_queue: int = 0


class MyFilesAdminStatsResponse(BaseModel):
    items: list[MyFilesAdminUserStat] = Field(default_factory=list)
    total: int = 0
    totals: MyFilesAdminTotals = Field(default_factory=MyFilesAdminTotals)


class MyFilesAdminFileResponse(MyFileResponse):
    owner_user_id: int
    owner_label: str = ""
    uploaded_by_user_id: int | None = None
    uploaded_by_username: str = ""
    deleted_at: datetime | None = None
    can_open: bool = False
    can_restore: bool = False


class MyFilesAdminFileListResponse(BaseModel):
    items: list[MyFilesAdminFileResponse] = Field(default_factory=list)
    total: int
    limit: int
    offset: int
