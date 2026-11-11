"""Add isolated OpenCode sandbox sessions, queue, files and permissions.

Revision ID: 20260815_0099
Revises: 20260814_0098
Create Date: 2026-08-15 00:20:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260815_0099"
down_revision = "20260814_0098"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(name: str, schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if not _has_table("ai_sandbox_sessions", schema):
        op.create_table(
            "ai_sandbox_sessions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("workspace_key", sa.String(length=128), nullable=False),
            sa.Column("opencode_session_id", sa.String(length=200), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="new"),
            sa.Column("credential_ref", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("purge_token", sa.String(length=64), nullable=True),
            sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("conversation_id", name="uq_app_ai_sandbox_sessions_conversation"),
            sa.UniqueConstraint("workspace_key", name="uq_app_ai_sandbox_sessions_workspace_key"),
            sa.CheckConstraint(
                "status IN ('new','ready','busy','stopped','purging','purged','failed')",
                name="ck_app_ai_sandbox_sessions_status",
            ),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_sessions_conversation_id", "ai_sandbox_sessions", ["conversation_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_sessions_user_id", "ai_sandbox_sessions", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_sessions_status", "ai_sandbox_sessions", ["status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_sessions_expiry", "ai_sandbox_sessions", ["status", "expires_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_sessions_user_activity", "ai_sandbox_sessions", ["user_id", "last_activity_at"], schema=schema)

    if not _has_table("ai_sandbox_jobs", schema):
        op.create_table(
            "ai_sandbox_jobs",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("prompt_message_id", sa.String(length=36), nullable=False, server_default=""),
            sa.Column("job_type", sa.String(length=24), nullable=False, server_default="prompt"),
            sa.Column("target_file_id", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="preparing"),
            sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("claimed_by", sa.String(length=128), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("finalization_state", sa.String(length=24), nullable=False, server_default="not_required"),
            sa.Column("finalization_markdown", sa.Text(), nullable=False, server_default=""),
            sa.Column("assistant_message_id", sa.String(length=36), nullable=True),
            sa.Column("cleanup_terminal_status", sa.String(length=24), nullable=True),
            sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["session_id"], [f"{schema + '.' if schema else ''}ai_sandbox_sessions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("conversation_id", "prompt_message_id", "job_type", name="uq_app_ai_sandbox_jobs_message_type"),
            sa.CheckConstraint(
                "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending','succeeded','failed','cancelled','expired')",
                name="ck_app_ai_sandbox_jobs_status",
            ),
            sa.CheckConstraint("job_type IN ('prompt','archive','attach_file')", name="ck_app_ai_sandbox_jobs_type"),
            sa.CheckConstraint(
                "finalization_state IN ('not_required','pending','published')",
                name="ck_app_ai_sandbox_jobs_finalization_state",
            ),
            sa.CheckConstraint(
                "cleanup_terminal_status IS NULL OR cleanup_terminal_status IN ('failed','cancelled','expired')",
                name="ck_app_ai_sandbox_jobs_cleanup_terminal",
            ),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_jobs_session_id", "ai_sandbox_jobs", ["session_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_conversation_id", "ai_sandbox_jobs", ["conversation_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_user_id", "ai_sandbox_jobs", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_prompt_message_id", "ai_sandbox_jobs", ["prompt_message_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_job_type", "ai_sandbox_jobs", ["job_type"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_status", "ai_sandbox_jobs", ["status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_deadline_at", "ai_sandbox_jobs", ["deadline_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_status_created", "ai_sandbox_jobs", ["status", "created_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_session_created", "ai_sandbox_jobs", ["session_id", "created_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_jobs_heartbeat", "ai_sandbox_jobs", ["status", "heartbeat_at"], schema=schema)
        op.create_index(
            "ix_app_ai_sandbox_jobs_finalization",
            "ai_sandbox_jobs",
            ["status", "finalization_state", "updated_at"],
            schema=schema,
        )
        op.create_index(
            "uq_app_ai_sandbox_jobs_one_active_per_user",
            "ai_sandbox_jobs",
            ["user_id"],
            unique=True,
            postgresql_where=sa.text(
                "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending')"
            ),
            sqlite_where=sa.text(
                "status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending')"
            ),
            schema=schema,
        )

    if not _has_table("ai_sandbox_files", schema):
        op.create_table(
            "ai_sandbox_files",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("job_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("relative_path", sa.String(length=1024), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("file_kind", sa.String(length=24), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("is_changed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("diff_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("source_message_id", sa.String(length=36), nullable=True),
            sa.Column("source_attachment_id", sa.String(length=36), nullable=True),
            sa.Column("chat_message_id", sa.String(length=36), nullable=True),
            sa.Column("chat_attachment_id", sa.String(length=36), nullable=True),
            sa.Column("delivery_status", sa.String(length=24), nullable=False, server_default="not_applicable"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["session_id"], [f"{schema + '.' if schema else ''}ai_sandbox_sessions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["job_id"], [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("job_id", "relative_path", name="uq_app_ai_sandbox_files_job_path"),
            sa.CheckConstraint("file_kind IN ('input','output','changed','archive')", name="ck_app_ai_sandbox_files_kind"),
            sa.CheckConstraint(
                "delivery_status IN ('not_applicable','pending','attached','unavailable')",
                name="ck_app_ai_sandbox_files_delivery_status",
            ),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_files_session_id", "ai_sandbox_files", ["session_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_files_job_id", "ai_sandbox_files", ["job_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_files_conversation_id", "ai_sandbox_files", ["conversation_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_files_file_kind", "ai_sandbox_files", ["file_kind"], schema=schema)
        op.create_index("ix_app_ai_sandbox_files_session_kind", "ai_sandbox_files", ["session_id", "file_kind", "created_at"], schema=schema)

    if not _has_table("ai_sandbox_permissions", schema):
        op.create_table(
            "ai_sandbox_permissions",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("job_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("opencode_permission_id", sa.String(length=200), nullable=False),
            sa.Column("tool", sa.String(length=64), nullable=False),
            sa.Column("operation", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("arguments_preview_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("action_id", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
            sa.Column("grant_scope", sa.String(length=16), nullable=True),
            sa.Column("responded_by_user_id", sa.Integer(), nullable=True),
            sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["session_id"], [f"{schema + '.' if schema else ''}ai_sandbox_sessions.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["job_id"], [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("session_id", "opencode_permission_id", name="uq_app_ai_sandbox_permissions_opencode"),
            sa.CheckConstraint("status IN ('pending','approved','rejected','expired')", name="ck_app_ai_sandbox_permissions_status"),
            sa.CheckConstraint("grant_scope IS NULL OR grant_scope IN ('once','session')", name="ck_app_ai_sandbox_permissions_scope"),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_permissions_session_id", "ai_sandbox_permissions", ["session_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_permissions_job_id", "ai_sandbox_permissions", ["job_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_permissions_user_id", "ai_sandbox_permissions", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_permissions_status", "ai_sandbox_permissions", ["status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_permissions_action_id", "ai_sandbox_permissions", ["action_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_permissions_user_status", "ai_sandbox_permissions", ["user_id", "status", "requested_at"], schema=schema)

    if not _has_table("ai_sandbox_transfer_grants", schema):
        op.create_table(
            "ai_sandbox_transfer_grants",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("job_id", sa.String(length=64), nullable=False),
            sa.Column("file_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("direction", sa.String(length=24), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="issued"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["job_id"], [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["file_id"], [f"{schema + '.' if schema else ''}ai_sandbox_files.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("token_hash", name="uq_app_ai_sandbox_transfer_grants_token_hash"),
            sa.CheckConstraint(
                "direction IN ('input_download','output_upload')",
                name="ck_app_ai_sandbox_transfer_grants_direction",
            ),
            sa.CheckConstraint(
                "status IN ('issued','claimed','consumed','expired','revoked')",
                name="ck_app_ai_sandbox_transfer_grants_status",
            ),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_transfer_grants_job_id", "ai_sandbox_transfer_grants", ["job_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_file_id", "ai_sandbox_transfer_grants", ["file_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_user_id", "ai_sandbox_transfer_grants", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_status", "ai_sandbox_transfer_grants", ["status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_expires_at", "ai_sandbox_transfer_grants", ["expires_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_expiry", "ai_sandbox_transfer_grants", ["status", "expires_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_transfer_grants_job", "ai_sandbox_transfer_grants", ["job_id", "created_at"], schema=schema)

    if not _has_table("ai_sandbox_gateway_grants", schema):
        op.create_table(
            "ai_sandbox_gateway_grants",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("job_id", sa.String(length=64), nullable=False),
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_requests", sa.Integer(), nullable=False, server_default="128"),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["job_id"], [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["session_id"], [f"{schema + '.' if schema else ''}ai_sandbox_sessions.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("token_hash", name="uq_app_ai_sandbox_gateway_grants_token_hash"),
            sa.CheckConstraint(
                "status IN ('active','revoked','expired','exhausted')",
                name="ck_app_ai_sandbox_gateway_grants_status",
            ),
            sa.CheckConstraint(
                "request_count >= 0 AND max_requests > 0 AND request_count <= max_requests",
                name="ck_app_ai_sandbox_gateway_grants_request_budget",
            ),
            schema=schema,
        )
        op.create_index("ix_app_ai_sandbox_gateway_grants_job_id", "ai_sandbox_gateway_grants", ["job_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_session_id", "ai_sandbox_gateway_grants", ["session_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_user_id", "ai_sandbox_gateway_grants", ["user_id"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_status", "ai_sandbox_gateway_grants", ["status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_expires_at", "ai_sandbox_gateway_grants", ["expires_at"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_job_status", "ai_sandbox_gateway_grants", ["job_id", "status"], schema=schema)
        op.create_index("ix_app_ai_sandbox_gateway_grants_expiry", "ai_sandbox_gateway_grants", ["status", "expires_at"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in (
        "ai_sandbox_gateway_grants",
        "ai_sandbox_transfer_grants",
        "ai_sandbox_permissions",
        "ai_sandbox_files",
        "ai_sandbox_jobs",
        "ai_sandbox_sessions",
    ):
        if _has_table(table_name, schema):
            op.drop_table(table_name, schema=schema)
