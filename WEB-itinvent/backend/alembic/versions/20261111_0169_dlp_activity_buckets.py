"""Per-PC 5-minute activity buckets (agent 1.4.19: active/passive/away/locked).

Revision ID: 20261111_0169
Revises: 20261111_0168

Agent reports activity in any foreground program; the server upserts by
(computer_name, windows_user, bucket_start) so retries overwrite, not sum.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261111_0169"
down_revision = "20261111_0168"
branch_labels = None
depends_on = None

TABLE = "dlp_activity_buckets"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        return
    op.create_table(
        TABLE,
        sa.Column("computer_name", sa.String(255), nullable=False),
        sa.Column("windows_user", sa.String(255), nullable=False),
        sa.Column("bucket_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("active_sec", sa.Float(), nullable=False, server_default="0"),
        sa.Column("passive_sec", sa.Float(), nullable=False, server_default="0"),
        sa.Column("away_sec", sa.Float(), nullable=False, server_default="0"),
        sa.Column("locked_sec", sa.Float(), nullable=False, server_default="0"),
        sa.Column("apps", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "computer_name", "windows_user", "bucket_start",
            name="pk_app_dlp_activity_buckets",
        ),
        sa.Index("ix_app_dlp_activity_buckets_bucket_start", "bucket_start"),
        sa.Index(
            "ix_app_dlp_activity_buckets_computer_start",
            "computer_name",
            "bucket_start",
        ),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        op.drop_table(TABLE, schema=schema)
