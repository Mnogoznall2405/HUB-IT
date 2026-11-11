"""Add Hub task email outbox.

Revision ID: 20260624_0054
Revises: 20260623_0053
Create Date: 2026-06-24 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260624_0054"
down_revision = "20260623_0053"
branch_labels = None
depends_on = None


TABLE_NAME = "hub_task_email_outbox"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _has_index(schema: str | None, table_name: str, index_name: str) -> bool:
    if not _has_table(schema, table_name):
        return False
    return any(
        str(item.get("name") or "").strip().lower() == index_name.lower()
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE_NAME):
        op.create_table(
            TABLE_NAME,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("dedupe_key", sa.String(length=512), nullable=False),
            sa.Column("task_id", sa.String(length=36), nullable=True),
            sa.Column("recipient_user_id", sa.Integer(), nullable=False),
            sa.Column("recipient_email", sa.String(length=320), nullable=False),
            sa.Column("event_type", sa.String(length=80), nullable=False),
            sa.Column("subject", sa.String(length=500), nullable=False),
            sa.Column("body_text", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("available_at", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.String(length=64), nullable=False),
            sa.Column("updated_at", sa.String(length=64), nullable=False),
            sa.Column("sent_at", sa.String(length=64), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
            schema=schema,
        )
    if not _has_index(schema, TABLE_NAME, "uq_hub_task_email_outbox_dedupe"):
        op.create_index(
            "uq_hub_task_email_outbox_dedupe",
            TABLE_NAME,
            ["dedupe_key"],
            unique=True,
            schema=schema,
        )
    if not _has_index(schema, TABLE_NAME, "idx_hub_task_email_outbox_status"):
        op.create_index(
            "idx_hub_task_email_outbox_status",
            TABLE_NAME,
            ["status", "available_at", "created_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_index(schema, TABLE_NAME, "idx_hub_task_email_outbox_status"):
        op.drop_index("idx_hub_task_email_outbox_status", table_name=TABLE_NAME, schema=schema)
    if _has_index(schema, TABLE_NAME, "uq_hub_task_email_outbox_dedupe"):
        op.drop_index("uq_hub_task_email_outbox_dedupe", table_name=TABLE_NAME, schema=schema)
    if _has_table(schema, TABLE_NAME):
        op.drop_table(TABLE_NAME, schema=schema)
