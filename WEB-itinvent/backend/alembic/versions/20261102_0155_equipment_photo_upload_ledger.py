"""Add the insert ledger of resumable equipment photo uploads.

Revision ID: 20261102_0155
Revises: 20261102_0154

Created "if missing". Without this table the backend keeps working (uploads fall back to the
previous, non-idempotent insert and log a warning), so it may be applied at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261102_0155"
down_revision = "20261102_0154"
branch_labels = None
depends_on = None

TABLE = "equipment_photo_upload_ledger"


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
    if _has_table(schema, TABLE):
        return
    now = sa.func.now()
    op.create_table(
        TABLE,
        sa.Column("upload_id", sa.String(length=64), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="inserting"),
        sa.Column("file_no", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
        sa.PrimaryKeyConstraint("upload_id", name="pk_app_equipment_photo_upload_ledger"),
        schema=schema,
    )
    op.create_index("ix_app_equipment_photo_upload_ledger_item", TABLE, ["item_id", "state"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, TABLE):
        return
    op.drop_index("ix_app_equipment_photo_upload_ledger_item", table_name=TABLE, schema=schema)
    op.drop_table(TABLE, schema=schema)
