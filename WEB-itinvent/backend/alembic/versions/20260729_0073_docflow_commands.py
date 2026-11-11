"""idempotent command ledger for 1C docflow actions

Revision ID: 20260729_0073
Revises: 20260728_0072
Create Date: 2026-07-29 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260729_0073"
down_revision = "20260728_0072"
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
    if _has_table(schema, "docflow_commands"):
        return
    op.create_table(
        "docflow_commands",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("task_ref", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=True),
        sa.Column("state_token_hash", sa.String(length=64), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=False),
        sa.Column("remote_before_json", sa.Text(), server_default="{}", nullable=False),
        sa.Column("remote_after_json", sa.Text(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_app_docflow_commands"),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_app_docflow_command_user_key"),
        schema=schema,
    )
    for name, columns in (
        ("ix_app_docflow_commands_user_id", ["user_id"]),
        ("ix_app_docflow_commands_task_ref", ["task_ref"]),
        ("ix_app_docflow_commands_status", ["status"]),
        ("ix_app_docflow_commands_correlation_id", ["correlation_id"]),
        ("ix_app_docflow_command_user_created", ["user_id", "created_at"]),
        ("ix_app_docflow_command_status_updated", ["status", "updated_at"]),
    ):
        op.create_index(name, "docflow_commands", columns, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, "docflow_commands"):
        op.drop_table("docflow_commands", schema=schema)
