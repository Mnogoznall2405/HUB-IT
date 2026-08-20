"""Add mail send idempotency ledger.

Revision ID: 20260818_0100
Revises: 20260815_0099
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260818_0100"
down_revision = "20260815_0099"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("mail_send_idempotency", schema=schema):
        return
    op.create_table(
        "mail_send_idempotency",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("mailbox_id", sa.String(length=128), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_payload_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="reserved"),
        sa.Column("internet_message_id", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("response_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("processing_lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "user_id",
            "mailbox_id",
            "idempotency_key",
            name="uq_app_mail_send_idempotency_scope",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_send_idempotency_user_created",
        "mail_send_idempotency",
        ["user_id", "created_at"],
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_send_idempotency_status_lease",
        "mail_send_idempotency",
        ["status", "processing_lease_until"],
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_send_idempotency_user_id",
        "mail_send_idempotency",
        ["user_id"],
        schema=schema,
    )
    op.create_index(
        "ix_app_mail_send_idempotency_status",
        "mail_send_idempotency",
        ["status"],
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("mail_send_idempotency", schema=schema):
        return
    op.drop_index("ix_app_mail_send_idempotency_status", table_name="mail_send_idempotency", schema=schema)
    op.drop_index("ix_app_mail_send_idempotency_user_id", table_name="mail_send_idempotency", schema=schema)
    op.drop_index("ix_app_mail_send_idempotency_status_lease", table_name="mail_send_idempotency", schema=schema)
    op.drop_index("ix_app_mail_send_idempotency_user_created", table_name="mail_send_idempotency", schema=schema)
    op.drop_table("mail_send_idempotency", schema=schema)
