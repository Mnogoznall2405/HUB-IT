"""Repair missing OpenCode sandbox grant tables from 0099.

Revision ID: 20260909_0111
Revises: 20260909_0110
Create Date: 2026-09-09 14:50:00.000000

Production already has 0099 session/job/file/permission tables but is missing
transfer/gateway grant tables required by the sandbox runtime. This revision
is idempotent and creates only the absent objects.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260909_0111"
down_revision = "20260909_0110"
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

    if not _has_table("ai_sandbox_jobs", schema) or not _has_table("ai_sandbox_files", schema):
        raise RuntimeError("0099 parent sandbox tables are required before grant repair")

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
            sa.ForeignKeyConstraint(
                ["job_id"],
                [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["file_id"],
                [f"{schema + '.' if schema else ''}ai_sandbox_files.id"],
                ondelete="CASCADE",
            ),
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
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_job_id",
            "ai_sandbox_transfer_grants",
            ["job_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_file_id",
            "ai_sandbox_transfer_grants",
            ["file_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_user_id",
            "ai_sandbox_transfer_grants",
            ["user_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_status",
            "ai_sandbox_transfer_grants",
            ["status"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_expires_at",
            "ai_sandbox_transfer_grants",
            ["expires_at"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_expiry",
            "ai_sandbox_transfer_grants",
            ["status", "expires_at"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_transfer_grants_job",
            "ai_sandbox_transfer_grants",
            ["job_id", "created_at"],
            schema=schema,
        )

    if not _has_table("ai_sandbox_gateway_grants", schema):
        if not _has_table("ai_sandbox_sessions", schema):
            raise RuntimeError("ai_sandbox_sessions is required before gateway grants")
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
            sa.ForeignKeyConstraint(
                ["job_id"],
                [f"{schema + '.' if schema else ''}ai_sandbox_jobs.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["session_id"],
                [f"{schema + '.' if schema else ''}ai_sandbox_sessions.id"],
                ondelete="CASCADE",
            ),
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
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_job_id",
            "ai_sandbox_gateway_grants",
            ["job_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_session_id",
            "ai_sandbox_gateway_grants",
            ["session_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_user_id",
            "ai_sandbox_gateway_grants",
            ["user_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_status",
            "ai_sandbox_gateway_grants",
            ["status"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_expires_at",
            "ai_sandbox_gateway_grants",
            ["expires_at"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_job_status",
            "ai_sandbox_gateway_grants",
            ["job_id", "status"],
            schema=schema,
        )
        op.create_index(
            "ix_app_ai_sandbox_gateway_grants_expiry",
            "ai_sandbox_gateway_grants",
            ["status", "expires_at"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in ("ai_sandbox_gateway_grants", "ai_sandbox_transfer_grants"):
        if _has_table(table_name, schema):
            op.drop_table(table_name, schema=schema)
