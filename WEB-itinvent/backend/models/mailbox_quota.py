"""Pydantic models for Exchange mailbox quota snapshots."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class MailboxQuotaRowImport(BaseModel):
    display_name: str = ""
    email: str
    user_principal_name: str = ""
    mailbox_type: str = ""
    used_bytes: Optional[int] = None
    quota_bytes: Optional[int] = None
    free_bytes: Optional[int] = None
    used_percent: Optional[float] = None
    database_name: str = ""

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized:
            raise ValueError("email is required")
        return normalized


class MailboxQuotaSnapshotImport(BaseModel):
    exchange_server: str = ""
    source_host: str = ""
    collected_at: Optional[datetime] = None
    rows: list[MailboxQuotaRowImport] = Field(default_factory=list)

    @field_validator("rows")
    @classmethod
    def validate_rows_not_empty(cls, value: list[MailboxQuotaRowImport]) -> list[MailboxQuotaRowImport]:
        if not value:
            raise ValueError("rows must not be empty")
        return value


class MailboxQuotaSnapshotSummary(BaseModel):
    id: int
    imported_at: datetime
    collected_at: Optional[datetime] = None
    source_host: str = ""
    exchange_server: str = ""
    row_count: int = 0


class MailboxQuotaImportResponse(BaseModel):
    snapshot_id: int
    row_count: int
    duplicate: bool = False


class MailboxQuotaRowResponse(BaseModel):
    id: int
    email: str
    display_name: str = ""
    upn: str = ""
    mailbox_type: str = ""
    used_bytes: Optional[int] = None
    quota_bytes: Optional[int] = None
    free_bytes: Optional[int] = None
    used_percent: Optional[float] = None
    database_name: str = ""
    uses_default_quota: bool = False


class MailboxQuotaRowsPage(BaseModel):
    items: list[MailboxQuotaRowResponse]
    total: int
    snapshot: MailboxQuotaSnapshotSummary


class MailboxQuotaDatabaseSummary(BaseModel):
    name: str
    total: int = 0
    over_quota: int = 0
    warning_90: int = 0


class MailboxQuotaSnapshotStats(BaseModel):
    snapshot_id: int
    total: int = 0
    with_quota: int = 0
    no_quota: int = 0
    over_quota: int = 0
    warning_90: int = 0
    by_database: list[MailboxQuotaDatabaseSummary] = Field(default_factory=list)
