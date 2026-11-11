"""personal 1C docflow credentials and audit

Revision ID: 20260728_0072
Revises: 20260723_0071
Create Date: 2026-07-28 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260728_0072"
down_revision = "20260723_0071"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if not _has_table(schema, "docflow_credentials"):
        op.create_table(
            "docflow_credentials",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("login", sa.String(length=128), nullable=False),
            sa.Column("password_enc", sa.Text(), nullable=False),
            sa.Column("key_version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("credential_version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("status", sa.String(length=32), server_default="configured", nullable=False),
            sa.Column("last_error_code", sa.String(length=64), nullable=True),
            sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("user_id", name="pk_app_docflow_credentials"),
            sa.UniqueConstraint("user_id", name="uq_app_docflow_credentials_user"),
            schema=schema,
        )
        op.create_index(
            "ix_app_docflow_credentials_status",
            "docflow_credentials",
            ["status"],
            schema=schema,
        )

    if not _has_table(schema, "docflow_audit_events"):
        op.create_table(
            "docflow_audit_events",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(length=64), nullable=False),
            sa.Column("outcome", sa.String(length=32), nullable=False),
            sa.Column("error_code", sa.String(length=64), nullable=True),
            sa.Column("correlation_id", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_docflow_audit_events"),
            schema=schema,
        )
        op.create_index(
            "ix_app_docflow_audit_events_user_id",
            "docflow_audit_events",
            ["user_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_docflow_audit_events_event_type",
            "docflow_audit_events",
            ["event_type"],
            schema=schema,
        )
        op.create_index(
            "ix_app_docflow_audit_events_correlation_id",
            "docflow_audit_events",
            ["correlation_id"],
            schema=schema,
        )
        op.create_index(
            "ix_app_docflow_audit_user_created",
            "docflow_audit_events",
            ["user_id", "created_at"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, "docflow_audit_events"):
        op.drop_table("docflow_audit_events", schema=schema)
    if _has_table(schema, "docflow_credentials"):
        op.drop_table("docflow_credentials", schema=schema)
