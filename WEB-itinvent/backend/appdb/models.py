"""SQLAlchemy models for unified internal application storage."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

def utcnow() -> datetime:
    return datetime.now(timezone.utc)

APP_SCHEMA = "app"
SYSTEM_SCHEMA = "system"


def _table_args(*constraints, schema: str | None = None):
    if schema:
        if constraints:
            return (*constraints, {"schema": schema})
        return {"schema": schema}
    if constraints:
        return constraints
    return ()


class AppBase(DeclarativeBase):
    """Declarative base for app-owned internal tables."""


class AppUser(AppBase):
    __tablename__ = "users"
    __table_args__ = _table_args(
        UniqueConstraint("username", name="uq_app_users_username"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    username: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    use_custom_permissions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    custom_permissions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    auth_source: Mapped[str] = mapped_column(String(20), nullable=False, default="local")
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    assigned_database: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mailbox_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mailbox_login: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mailbox_password_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    mail_signature_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    mail_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    totp_secret_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_2fa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    twofa_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False, default="")
    password_salt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppDepartment(AppBase):
    __tablename__ = "departments"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppDepartmentMembership(AppBase):
    __tablename__ = "department_memberships"
    __table_args__ = _table_args(
        UniqueConstraint("department_id", "user_id", "role", name="uq_app_department_membership_role"),
        Index("ix_app_department_memberships_user_active", "user_id", "is_active"),
        Index("ix_app_department_memberships_department_active", "department_id", "is_active"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    department_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="member")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppUserMailbox(AppBase):
    __tablename__ = "user_mailboxes"
    __table_args__ = _table_args(
        UniqueConstraint("user_id", "mailbox_email", name="uq_app_user_mailboxes_user_email"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    mailbox_email: Mapped[str] = mapped_column(String(255), nullable=False)
    mailbox_login: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mailbox_password_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    auth_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="stored_credentials", index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_selected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppTaskDelegateUserLink(AppBase):
    __tablename__ = "task_delegate_user_links"
    __table_args__ = _table_args(
        UniqueConstraint("owner_user_id", "delegate_user_id", name="uq_app_task_delegate_owner_delegate"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    delegate_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    role_type: Mapped[str] = mapped_column(String(32), nullable=False, default="assistant")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppSessionRecord(AppBase):
    __tablename__ = "sessions"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    ip_address: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idle_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trusted_device_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    device_label: Mapped[str | None] = mapped_column(String(255), nullable=True)


class AppSessionAuthContext(AppBase):
    __tablename__ = "session_auth_context"
    __table_args__ = _table_args(schema=SYSTEM_SCHEMA)

    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    auth_source: Mapped[str] = mapped_column(String(20), nullable=False, default="local")
    exchange_login: Mapped[str] = mapped_column(String(255), nullable=False)
    password_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppUser2FABackupCode(AppBase):
    __tablename__ = "user_2fa_backup_codes"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    code_suffix: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppTrustedDevice(AppBase):
    __tablename__ = "trusted_devices"
    __table_args__ = _table_args(
        UniqueConstraint("credential_id", name="uq_app_trusted_devices_credential_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    credential_id: Mapped[str] = mapped_column(Text, nullable=False)
    public_key_b64: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    transports_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    aaguid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    origin: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)


class AppUserSetting(AppBase):
    __tablename__ = "user_settings"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    pinned_database: Mapped[str | None] = mapped_column(String(128), nullable=True)
    theme_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="light")
    font_family: Mapped[str] = mapped_column(String(32), nullable=False, default="Aptos")
    font_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    dashboard_mobile_sections_json: Mapped[str | None] = mapped_column("dashboard_mobile_sections", Text, nullable=True)
    mobile_bottom_nav_items_json: Mapped[str | None] = mapped_column("mobile_bottom_nav_items", Text, nullable=True)
    database_branch_filters_json: Mapped[str | None] = mapped_column("database_branch_filters", Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppEquipmentRecentCard(AppBase):
    __tablename__ = "equipment_recent_cards"
    __table_args__ = _table_args(
        UniqueConstraint("user_id", "db_id", "inv_no", name="uq_app_equipment_recent_cards_user_db_inv"),
        Index("ix_app_equipment_recent_cards_user_db_activity", "user_id", "db_id", "last_activity_at"),
        Index("ix_app_equipment_recent_cards_user_activity", "user_id", "last_activity_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    db_id: Mapped[str] = mapped_column(String(128), nullable=False, default="default")
    inv_no: Mapped[str] = mapped_column(String(64), nullable=False)
    last_action: Mapped[str] = mapped_column(String(64), nullable=False, default="view")
    last_action_label: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    activity_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppPasswordVaultEntry(AppBase):
    __tablename__ = "password_vault_entries"
    __table_args__ = _table_args(
        Index("ix_app_password_vault_entries_group_archived", "group_name", "is_archived"),
        Index("ix_app_password_vault_entries_login_archived", "login", "is_archived"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    login: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    password_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    updated_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppPasswordVaultGroup(AppBase):
    __tablename__ = "password_vault_groups"
    __table_args__ = _table_args(
        UniqueConstraint("name", name="uq_app_password_vault_groups_name"),
        Index("ix_app_password_vault_groups_active_sort", "is_active", "sort_order", "name"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    updated_by_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppPasswordVaultAudit(AppBase):
    __tablename__ = "password_vault_audit"
    __table_args__ = _table_args(
        Index("ix_app_password_vault_audit_entry_created", "entry_id", "created_at"),
        Index("ix_app_password_vault_audit_actor_created", "actor_user_id", "created_at"),
        Index("ix_app_password_vault_audit_action_created", "action", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actor_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    entry_group: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    entry_login: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppMyFileBlob(AppBase):
    __tablename__ = "my_file_blobs"
    __table_args__ = _table_args(
        Index("ix_app_my_file_blobs_ref_count", "ref_count"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    storage_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="stored")
    stored_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    original_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    stored_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    output_mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    output_extension: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    ref_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppMyFilePreview(AppBase):
    __tablename__ = "my_file_previews"
    __table_args__ = _table_args(
        Index("ix_app_my_file_previews_status_updated", "status", "updated_at"),
        Index("ix_app_my_file_previews_kind_status", "preview_kind", "status"),
        schema=APP_SCHEMA,
    )

    blob_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    preview_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="unsupported")
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    source_filename: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    content_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    preview_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    preview_mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    preview_filename: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sheets_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    error_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppMyFile(AppBase):
    __tablename__ = "my_files"
    __table_args__ = _table_args(
        Index("ix_app_my_files_owner_status_created", "owner_user_id", "status", "created_at"),
        Index("ix_app_my_files_status_created", "status", "created_at"),
        Index("ix_app_my_files_expires_status", "expires_at", "status"),
        Index("ix_app_my_files_share_token_hash", "share_token_hash"),
        Index("ix_app_my_files_original_sha256", "original_sha256"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    owner_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    original_file_name: Mapped[str] = mapped_column(String(512), nullable=False, default="file.bin")
    download_file_name: Mapped[str] = mapped_column(String(512), nullable=False, default="file.bin")
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    download_mime_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    original_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    stored_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", index=True)
    storage_mode: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    original_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    blob_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    spool_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    error_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    security_scan_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    security_scan_engine: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    security_scanned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    share_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    share_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    share_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AppMyFileAudit(AppBase):
    __tablename__ = "my_file_audit"
    __table_args__ = _table_args(
        Index("ix_app_my_file_audit_file_created", "file_id", "created_at"),
        Index("ix_app_my_file_audit_actor_created", "actor_user_id", "created_at"),
        Index("ix_app_my_file_audit_action_created", "action", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actor_username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppMyFileDownloadGrant(AppBase):
    __tablename__ = "my_file_download_grants"
    __table_args__ = _table_args(
        Index("ix_app_my_file_download_grants_file_id", "file_id"),
        Index("ix_app_my_file_download_grants_owner_created", "owner_user_id", "created_at"),
        Index("ix_app_my_file_download_grants_expires_at", "expires_at"),
        schema=APP_SCHEMA,
    )

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_id: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppGlobalSetting(AppBase):
    __tablename__ = "app_settings"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppNativePushToken(AppBase):
    __tablename__ = "native_push_tokens"
    __table_args__ = _table_args(
        UniqueConstraint("token_hash", name="uq_app_native_push_tokens_token_hash"),
        Index("ix_app_native_push_tokens_user_active", "user_id", "is_active"),
        Index("ix_app_native_push_tokens_device_id", "device_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="fcm", index=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="android", index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    token_text: Mapped[str] = mapped_column(Text, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    device_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error_text: Mapped[str | None] = mapped_column(Text, nullable=True)


class AppAiBot(AppBase):
    __tablename__ = "ai_bots"
    __table_args__ = _table_args(
        UniqueConstraint("slug", name="uq_app_ai_bots_slug"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.2)
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=2000)
    allowed_kb_scope_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    enabled_tools_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    tool_settings_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    allow_file_input: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_generated_artifacts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_kb_document_delivery: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    bot_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiBotConversation(AppBase):
    __tablename__ = "ai_bot_conversations"
    __table_args__ = _table_args(
        UniqueConstraint("bot_id", "user_id", name="uq_app_ai_bot_conversations_bot_user"),
        UniqueConstraint("conversation_id", name="uq_app_ai_bot_conversations_conversation"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bot_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiBotRun(AppBase):
    __tablename__ = "ai_bot_runs"
    __table_args__ = _table_args(
        Index("ix_app_ai_bot_runs_status_created_at", "status", "created_at"),
        Index("ix_app_ai_bot_runs_bot_conversation_created_at", "bot_id", "conversation_id", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    bot_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    trigger_message_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", index=True)
    stage: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    usage_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppTransferActJob(AppBase):
    __tablename__ = "transfer_act_jobs"
    __table_args__ = _table_args(
        Index("ix_app_transfer_act_jobs_status_created_at", "status", "created_at"),
        Index("ix_app_transfer_act_jobs_user_created_at", "user_id", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="queued", index=True)
    status_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    db_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiPendingAction(AppBase):
    __tablename__ = "ai_pending_actions"
    __table_args__ = _table_args(
        Index("ix_app_ai_pending_actions_run_status", "run_id", "status"),
        Index("ix_app_ai_pending_actions_status_expires_at", "status", "expires_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    action_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    requester_user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    database_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    executed_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiKbDocument(AppBase):
    __tablename__ = "ai_kb_documents"
    __table_args__ = _table_args(
        UniqueConstraint("kb_article_id", name="uq_app_ai_kb_documents_article"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kb_article_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="published", index=True)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiKbChunk(AppBase):
    __tablename__ = "ai_kb_chunks"
    __table_args__ = _table_args(
        Index("ix_app_ai_kb_chunks_document_id_chunk_index", "document_id", "chunk_index"),
        Index("ix_app_ai_kb_chunks_kb_article_id", "kb_article_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    document_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kb_article_id: Mapped[str] = mapped_column(String(64), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppUserDatabaseSelection(AppBase):
    __tablename__ = "user_db_selection"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    database_id: Mapped[str] = mapped_column(String(128), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppVcsComputer(AppBase):
    __tablename__ = "vcs_computers"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    ip_address: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAdUserBranchOverride(AppBase):
    __tablename__ = "ad_user_branch_overrides"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    login: Mapped[str] = mapped_column(String(255), primary_key=True)
    branch_no: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppInventoryHost(AppBase):
    __tablename__ = "inventory_hosts"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    mac_address: Mapped[str] = mapped_column(String(64), primary_key=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    user_login: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    user_full_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    ip_primary: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    report_type: Mapped[str] = mapped_column(String(32), nullable=False, default="full_snapshot")
    last_seen_at: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    last_full_snapshot_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppInventoryUserProfile(AppBase):
    __tablename__ = "inventory_user_profiles"
    __table_args__ = _table_args(
        Index("ix_app_inventory_user_profiles_mac_address", "mac_address"),
        Index("ix_app_inventory_user_profiles_user_name", "user_name"),
        Index("ix_app_inventory_user_profiles_profile_path", "profile_path"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac_address: Mapped[str] = mapped_column(String(64), nullable=False)
    user_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    files_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dirs_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    partial: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppInventoryOutlookFile(AppBase):
    __tablename__ = "inventory_outlook_files"
    __table_args__ = _table_args(
        Index("ix_app_inventory_outlook_files_mac_address", "mac_address"),
        Index("ix_app_inventory_outlook_files_kind", "kind"),
        Index("ix_app_inventory_outlook_files_file_path", "file_path"),
        Index("ix_app_inventory_outlook_files_file_type", "file_type"),
        Index("ix_app_inventory_outlook_files_size_bytes", "size_bytes"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac_address: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="archive")
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_modified_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppInventoryHostSqlContext(AppBase):
    __tablename__ = "inventory_host_sql_contexts"
    __table_args__ = _table_args(
        UniqueConstraint("mac_address", "hostname", "db_id", name="uq_app_inventory_host_sql_context"),
        Index("ix_app_inventory_host_sql_contexts_mac_address", "mac_address"),
        Index("ix_app_inventory_host_sql_contexts_hostname", "hostname"),
        Index("ix_app_inventory_host_sql_contexts_db_id", "db_id"),
        Index("ix_app_inventory_host_sql_contexts_branch_name", "branch_name"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mac_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    hostname: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    db_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    branch_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    location_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    employee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inventory_inv_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    inventory_model_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppInventoryChangeEvent(AppBase):
    __tablename__ = "inventory_change_events"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    event_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    mac_address: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    hostname: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    detected_at: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    report_type: Mapped[str] = mapped_column(String(32), nullable=False, default="full_snapshot")
    change_types_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    diff_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    before_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    after_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppJsonDocument(AppBase):
    __tablename__ = "json_documents"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    file_name: Mapped[str] = mapped_column(String(255), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="dict")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppJsonRecord(AppBase):
    __tablename__ = "json_records"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class SystemMigrationCheckpoint(AppBase):
    __tablename__ = "migration_checkpoints"
    __table_args__ = _table_args(schema=SYSTEM_SCHEMA)

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppMailboxQuotaSnapshot(AppBase):
    __tablename__ = "mailbox_quota_snapshots"
    __table_args__ = _table_args(
        Index("ix_app_mailbox_quota_snapshots_imported_at", "imported_at"),
        Index("ix_app_mailbox_quota_snapshots_payload_sha256", "payload_sha256"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_host: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    exchange_server: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AppMailboxQuotaRow(AppBase):
    __tablename__ = "mailbox_quota_rows"
    __table_args__ = _table_args(
        Index("ix_app_mailbox_quota_rows_snapshot_email", "snapshot_id", "email"),
        Index("ix_app_mailbox_quota_rows_snapshot_used_percent", "snapshot_id", "used_percent"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    display_name: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    upn: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    mailbox_type: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    used_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    free_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    used_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    database_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class AppAuthRuntimeItem(AppBase):
    __tablename__ = "auth_runtime_items"
    __table_args__ = _table_args(
        Index("ix_system_auth_runtime_items_namespace", "namespace"),
        Index("ix_system_auth_runtime_items_expires_at", "expires_at"),
        schema=SYSTEM_SCHEMA,
    )

    namespace: Mapped[str] = mapped_column(String(64), primary_key=True)
    item_key: Mapped[str] = mapped_column(String(512), primary_key=True)
    value_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppMailRuntimeSnapshot(AppBase):
    """Shared, non-secret mail preview/count snapshot for snapshot-first reads."""

    __tablename__ = "mail_runtime_snapshots"
    __table_args__ = _table_args(
        UniqueConstraint(
            "user_id",
            "mailbox_id",
            "snapshot_type",
            "context_key",
            name="uq_app_mail_runtime_snapshot_scope",
        ),
        Index("ix_app_mail_runtime_snapshots_expires", "expires_at"),
        Index("ix_app_mail_runtime_snapshots_user_type", "user_id", "snapshot_type"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    mailbox_id: Mapped[str] = mapped_column(String(128), nullable=False, default="aggregate")
    snapshot_type: Mapped[str] = mapped_column(String(32), nullable=False)
    context_key: Mapped[str] = mapped_column(String(255), nullable=False, default="default")
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCItemLink(AppBase):
    """Approved (or explicitly excluded) 1C nomenclature link for one HUB item.

    The legacy SQL Server ``ITEMS.PART_NO`` stays a projection during migration;
    this app-owned row is the auditable source of truth for reconciliation.
    """

    __tablename__ = "one_c_item_links"
    __table_args__ = _table_args(
        UniqueConstraint(
            "hub_db_id",
            "hub_item_id",
            "source_base",
            name="uq_app_one_c_item_links_hub_item_source",
        ),
        Index("ix_app_one_c_item_links_nomenclature", "source_base", "nomenclature_ref"),
        Index("ix_app_one_c_item_links_status", "hub_db_id", "status"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    hub_db_id: Mapped[str] = mapped_column(String(128), nullable=False)
    hub_item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_base: Mapped[str] = mapped_column(String(64), nullable=False, default="buh20")
    nomenclature_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nomenclature_code_snapshot: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    verified_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCWarehouseOwnerLink(AppBase):
    """Explicit warehouse-to-HUB-owner mapping; FIO matching only suggests it."""

    __tablename__ = "one_c_warehouse_owner_links"
    __table_args__ = _table_args(
        UniqueConstraint(
            "source_base",
            "warehouse_ref",
            "hub_db_id",
            "owner_no",
            name="uq_app_one_c_warehouse_owner_links",
        ),
        Index("ix_app_one_c_warehouse_owner_links_warehouse", "source_base", "warehouse_ref"),
        Index("ix_app_one_c_warehouse_owner_links_owner", "hub_db_id", "owner_no"),
        Index(
            "uq_app_one_c_warehouse_owner_links_active_warehouse",
            "source_base",
            "warehouse_ref",
            "hub_db_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_base: Mapped[str] = mapped_column(String(64), nullable=False, default="buh20")
    warehouse_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    hub_db_id: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    verified_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCEmployeeOwnerLink(AppBase):
    """Explicit ZUP employee-code to HUB-owner mapping for status enrichment."""

    __tablename__ = "one_c_employee_owner_links"
    __table_args__ = _table_args(
        UniqueConstraint(
            "source_base",
            "employee_code",
            "hub_db_id",
            "owner_no",
            name="uq_app_one_c_employee_owner_links",
        ),
        Index("ix_app_one_c_employee_owner_links_employee", "source_base", "employee_code"),
        Index("ix_app_one_c_employee_owner_links_owner", "hub_db_id", "owner_no"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_base: Mapped[str] = mapped_column(String(64), nullable=False, default="zar31")
    employee_code: Mapped[str] = mapped_column(String(128), nullable=False)
    hub_db_id: Mapped[str] = mapped_column(String(128), nullable=False)
    owner_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    verified_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCReconcileEvent(AppBase):
    """Append-only audit event for a reconciliation decision or run."""

    __tablename__ = "one_c_reconcile_events"
    __table_args__ = _table_args(
        Index("ix_app_one_c_reconcile_events_hub_item", "hub_db_id", "hub_item_id", "created_at"),
        Index("ix_app_one_c_reconcile_events_correlation", "correlation_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    correlation_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    hub_db_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    hub_item_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    after_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCCatalogSnapshot(AppBase):
    """Current app-owned, read-only snapshot state for a 1C directory source.

    The first ``active_generation`` is committed only after a complete import.
    Later small diffs are applied in one MVCC transaction, so readers still
    never observe a partially imported 1C catalogue.
    """

    __tablename__ = "one_c_catalog_snapshots"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    source_base: Mapped[str] = mapped_column(String(64), primary_key=True)
    active_generation: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    nomenclature_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    warehouses_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    nomenclature_truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    warehouses_truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    nomenclature_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    warehouses_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCCatalogEntry(AppBase):
    """One indexed catalogue entry in the atomically maintained snapshot."""

    __tablename__ = "one_c_catalog_entries"
    __table_args__ = _table_args(
        UniqueConstraint(
            "source_base",
            "generation",
            "catalog_type",
            "ref",
            name="uq_app_one_c_catalog_entries_generation_ref",
        ),
        Index(
            "ix_app_one_c_catalog_entries_ref",
            "source_base",
            "generation",
            "catalog_type",
            "ref",
        ),
        Index(
            "ix_app_one_c_catalog_entries_name",
            "source_base",
            "generation",
            "catalog_type",
            "name_normalized",
        ),
        Index(
            "ix_app_one_c_catalog_entries_code",
            "source_base",
            "generation",
            "catalog_type",
            "code_normalized",
        ),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_base: Mapped[str] = mapped_column(String(64), nullable=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False)
    catalog_type: Mapped[str] = mapped_column(String(16), nullable=False)
    ref: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    code_normalized: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    name_normalized: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppOneCCatalogToken(AppBase):
    """Token index for directory autocomplete without a Python-wide index."""

    __tablename__ = "one_c_catalog_tokens"
    __table_args__ = _table_args(
        UniqueConstraint(
            "source_base",
            "generation",
            "catalog_type",
            "entry_ref",
            "token",
            name="uq_app_one_c_catalog_tokens_entry_token",
        ),
        Index(
            "ix_app_one_c_catalog_tokens_lookup",
            "source_base",
            "generation",
            "catalog_type",
            "token",
            "entry_ref",
        ),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_base: Mapped[str] = mapped_column(String(64), nullable=False)
    generation: Mapped[int] = mapped_column(Integer, nullable=False)
    catalog_type: Mapped[str] = mapped_column(String(16), nullable=False)
    entry_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    token: Mapped[str] = mapped_column(String(200), nullable=False)
