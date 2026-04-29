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
    font_family: Mapped[str] = mapped_column(String(32), nullable=False, default="Inter")
    font_scale: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    dashboard_mobile_sections_json: Mapped[str | None] = mapped_column("dashboard_mobile_sections", Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppGlobalSetting(AppBase):
    __tablename__ = "app_settings"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


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
