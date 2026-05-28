"""Password vault API models."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _normalize_tag(value: object) -> str:
    text = _normalize_text(value)
    while text.startswith("#"):
        text = text[1:].strip()
    return text[:64]


class PasswordVaultEntryBase(BaseModel):
    group: str = Field(..., min_length=1, max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=20)
    login: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=4000)

    @field_validator("group", "login", "description", mode="before")
    @classmethod
    def _strip_text(cls, value):
        return _normalize_text(value)

    @field_validator("tags", mode="before")
    @classmethod
    def _normalize_tags(cls, value):
        if value is None:
            return []
        raw_items = value if isinstance(value, list) else str(value).split(",")
        result: list[str] = []
        seen: set[str] = set()
        for item in raw_items:
            normalized = _normalize_tag(item)
            key = normalized.lower()
            if not normalized or key in seen:
                continue
            seen.add(key)
            result.append(normalized)
        return result[:20]


class PasswordVaultEntryCreate(PasswordVaultEntryBase):
    password: str = Field(..., min_length=1, max_length=4096)

    @field_validator("password", mode="before")
    @classmethod
    def _normalize_password(cls, value):
        return str(value or "")


class PasswordVaultEntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group: Optional[str] = Field(default=None, min_length=1, max_length=120)
    tags: Optional[list[str]] = Field(default=None, max_length=20)
    login: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=4000)
    password: Optional[str] = Field(default=None, min_length=1, max_length=4096)

    @field_validator("group", "login", "description", mode="before")
    @classmethod
    def _strip_text(cls, value):
        if value is None:
            return None
        return _normalize_text(value)

    @field_validator("password", mode="before")
    @classmethod
    def _normalize_password(cls, value):
        if value is None:
            return None
        return str(value or "")

    @field_validator("tags", mode="before")
    @classmethod
    def _normalize_tags(cls, value):
        if value is None:
            return None
        raw_items = value if isinstance(value, list) else str(value).split(",")
        result: list[str] = []
        seen: set[str] = set()
        for item in raw_items:
            normalized = _normalize_tag(item)
            key = normalized.lower()
            if not normalized or key in seen:
                continue
            seen.add(key)
            result.append(normalized)
        return result[:20]


class PasswordVaultEntryResponse(PasswordVaultEntryBase):
    id: str
    is_archived: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    password_configured: bool = True


class PasswordVaultListResponse(BaseModel):
    items: list[PasswordVaultEntryResponse] = Field(default_factory=list)
    groups: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    unlocked_until: Optional[str] = None


class PasswordVaultGroupBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    sort_order: int = Field(default=0, ge=0, le=10000)

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value):
        return _normalize_text(value)


class PasswordVaultGroupCreate(PasswordVaultGroupBase):
    pass


class PasswordVaultGroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    sort_order: Optional[int] = Field(default=None, ge=0, le=10000)
    is_active: Optional[bool] = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value):
        if value is None:
            return None
        return _normalize_text(value)


class PasswordVaultGroupResponse(PasswordVaultGroupBase):
    id: str
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None


class PasswordVaultGroupListResponse(BaseModel):
    items: list[PasswordVaultGroupResponse] = Field(default_factory=list)


class PasswordVaultUnlockRequest(BaseModel):
    totp_code: Optional[str] = Field(default=None, min_length=6, max_length=16)
    backup_code: Optional[str] = Field(default=None, min_length=6, max_length=32)

    @field_validator("totp_code", "backup_code", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        text = _normalize_text(value)
        return text or None


class PasswordVaultUnlockResponse(BaseModel):
    unlocked_until: str


class PasswordVaultRevealRequest(BaseModel):
    purpose: Literal["show", "copy"] = "show"


class PasswordVaultRevealResponse(BaseModel):
    password: str
    unlocked_until: str


class PasswordVaultAuditEntry(BaseModel):
    id: int
    entry_id: Optional[str] = None
    action: str
    actor_user_id: int
    actor_username: str
    entry_group: str = ""
    entry_login: str = ""
    ip_address: str = ""
    user_agent: str = ""
    created_at: Optional[str] = None


class PasswordVaultAuditResponse(BaseModel):
    items: list[PasswordVaultAuditEntry] = Field(default_factory=list)
