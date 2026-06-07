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
    status: str
    storage_mode: str
    error_text: str = ""
    security_scan_status: str = "pending"
    is_shared: bool = False
    share_expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None


class MyFileListResponse(BaseModel):
    items: list[MyFileResponse] = Field(default_factory=list)


class MyFileQuotaResponse(BaseModel):
    used_bytes: int
    limit_bytes: int
    remaining_bytes: int


class MyFileShareResponse(BaseModel):
    token: str
    public_path: str
    expires_at: datetime | None = None


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
    created_at: datetime | None = None


class MyFileAuditResponse(BaseModel):
    items: list[MyFileAuditItemResponse] = Field(default_factory=list)
