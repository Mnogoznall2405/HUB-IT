from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.appdb.models import APP_SCHEMA, AppBase, utcnow


def _fk(table: str, column: str = "id") -> str:
    return f"{APP_SCHEMA}.{table}.{column}"


class AppAiSandboxSession(AppBase):
    __tablename__ = "ai_sandbox_sessions"
    __table_args__ = (
        UniqueConstraint("conversation_id", name="uq_app_ai_sandbox_sessions_conversation"),
        UniqueConstraint("workspace_key", name="uq_app_ai_sandbox_sessions_workspace_key"),
        Index("ix_app_ai_sandbox_sessions_user_activity", "user_id", "last_activity_at"),
        Index("ix_app_ai_sandbox_sessions_expiry", "status", "expires_at"),
        CheckConstraint(
            "status IN ('new','ready','busy','stopped','purging','purged','failed')",
            name="ck_app_ai_sandbox_sessions_status",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    workspace_key: Mapped[str] = mapped_column(String(128), nullable=False)
    opencode_session_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="new", index=True)
    credential_ref: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    purge_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiSandboxJob(AppBase):
    __tablename__ = "ai_sandbox_jobs"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id",
            "prompt_message_id",
            "job_type",
            name="uq_app_ai_sandbox_jobs_message_type",
        ),
        Index("ix_app_ai_sandbox_jobs_status_created", "status", "created_at"),
        Index("ix_app_ai_sandbox_jobs_session_created", "session_id", "created_at"),
        Index("ix_app_ai_sandbox_jobs_heartbeat", "status", "heartbeat_at"),
        Index("ix_app_ai_sandbox_jobs_finalization", "status", "finalization_state", "updated_at"),
        Index(
            "uq_app_ai_sandbox_jobs_one_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=text(
                "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending')"
            ),
            sqlite_where=text(
                "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending')"
            ),
        ),
        CheckConstraint(
            "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending',"
            "'succeeded','failed','cancelled','expired')",
            name="ck_app_ai_sandbox_jobs_status",
        ),
        CheckConstraint(
            "finalization_state IN ('not_required','pending','published')",
            name="ck_app_ai_sandbox_jobs_finalization_state",
        ),
        CheckConstraint(
            "cleanup_terminal_status IS NULL OR cleanup_terminal_status IN ('failed','cancelled','expired')",
            name="ck_app_ai_sandbox_jobs_cleanup_terminal",
        ),
        CheckConstraint(
            "job_type IN ('prompt','archive','attach_file')",
            name="ck_app_ai_sandbox_jobs_type",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_sessions"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    prompt_message_id: Mapped[str] = mapped_column(String(36), nullable=False, default="", index=True)
    job_type: Mapped[str] = mapped_column(String(24), nullable=False, default="prompt", index=True)
    target_file_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="preparing", index=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    claimed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    finalization_state: Mapped[str] = mapped_column(String(24), nullable=False, default="not_required", index=True)
    finalization_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    assistant_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    cleanup_terminal_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    error_code: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiSandboxFile(AppBase):
    __tablename__ = "ai_sandbox_files"
    __table_args__ = (
        UniqueConstraint("job_id", "relative_path", name="uq_app_ai_sandbox_files_job_path"),
        Index("ix_app_ai_sandbox_files_session_kind", "session_id", "file_kind", "created_at"),
        CheckConstraint(
            "file_kind IN ('input','output','changed','archive')",
            name="ck_app_ai_sandbox_files_kind",
        ),
        CheckConstraint(
            "delivery_status IN ('not_applicable','pending','attached','unavailable')",
            name="ck_app_ai_sandbox_files_delivery_status",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_sessions"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_jobs"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    relative_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    is_changed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    diff_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_attachment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    chat_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    chat_attachment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    delivery_status: Mapped[str] = mapped_column(String(24), nullable=False, default="not_applicable")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiSandboxPermission(AppBase):
    __tablename__ = "ai_sandbox_permissions"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "opencode_permission_id",
            name="uq_app_ai_sandbox_permissions_opencode",
        ),
        Index("ix_app_ai_sandbox_permissions_user_status", "user_id", "status", "requested_at"),
        CheckConstraint(
            "status IN ('pending','approved','rejected','expired')",
            name="ck_app_ai_sandbox_permissions_status",
        ),
        CheckConstraint(
            "grant_scope IS NULL OR grant_scope IN ('once','session')",
            name="ck_app_ai_sandbox_permissions_scope",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_sessions"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    job_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_jobs"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    opencode_permission_id: Mapped[str] = mapped_column(String(200), nullable=False)
    tool: Mapped[str] = mapped_column(String(64), nullable=False)
    operation: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    arguments_preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    action_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending", index=True)
    grant_scope: Mapped[str | None] = mapped_column(String(16), nullable=True)
    responded_by_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiSandboxTransferGrant(AppBase):
    """Short-lived one-time content transfer grant.

    Only a SHA-256 token digest is persisted. Raw tokens live in worker memory
    long enough to perform one authenticated transfer and are never logged.
    """

    __tablename__ = "ai_sandbox_transfer_grants"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_app_ai_sandbox_transfer_grants_token_hash"),
        Index("ix_app_ai_sandbox_transfer_grants_expiry", "status", "expires_at"),
        Index("ix_app_ai_sandbox_transfer_grants_job", "job_id", "created_at"),
        CheckConstraint(
            "direction IN ('input_download','output_upload')",
            name="ck_app_ai_sandbox_transfer_grants_direction",
        ),
        CheckConstraint(
            "status IN ('issued','claimed','consumed','expired','revoked')",
            name="ck_app_ai_sandbox_transfer_grants_status",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_jobs"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_files"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(24), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="issued", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class AppAiSandboxGatewayGrant(AppBase):
    """Short-lived LLM gateway credential scoped to exactly one active job.

    The raw bearer is intentionally absent from the schema. A gateway request
    must present the matching job, session and user scope in addition to the
    bearer, and the worker revokes the grant when the container stops.
    """

    __tablename__ = "ai_sandbox_gateway_grants"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_app_ai_sandbox_gateway_grants_token_hash"),
        Index("ix_app_ai_sandbox_gateway_grants_job_status", "job_id", "status"),
        Index("ix_app_ai_sandbox_gateway_grants_expiry", "status", "expires_at"),
        CheckConstraint(
            "status IN ('active','revoked','expired','exhausted')",
            name="ck_app_ai_sandbox_gateway_grants_status",
        ),
        CheckConstraint(
            "request_count >= 0 AND max_requests > 0 AND request_count <= max_requests",
            name="ck_app_ai_sandbox_gateway_grants_request_budget",
        ),
        {"schema": APP_SCHEMA},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    job_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_jobs"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey(_fk("ai_sandbox_sessions"), ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active", index=True)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_requests: Mapped[int] = mapped_column(Integer, nullable=False, default=128)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
