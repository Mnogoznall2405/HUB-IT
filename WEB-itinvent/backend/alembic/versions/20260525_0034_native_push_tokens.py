"""add native push token storage

Revision ID: 20260525_0034
Revises: 20260511_0033
Create Date: 2026-05-25 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260525_0034"
down_revision = "20260511_0033"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "native_push_tokens"):
        op.create_table(
            "native_push_tokens",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("provider", sa.String(length=32), nullable=False),
            sa.Column("platform", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("token_text", sa.Text(), nullable=False),
            sa.Column("device_id", sa.String(length=128), nullable=True),
            sa.Column("device_label", sa.String(length=255), nullable=True),
            sa.Column("app_version", sa.String(length=64), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("failure_count", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_push_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error_text", sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash", name="uq_app_native_push_tokens_token_hash"),
            schema=app_schema,
        )

    indexes = _index_names(app_schema, "native_push_tokens")
    if "ix_native_push_tokens_user_id" not in indexes:
        op.create_index("ix_native_push_tokens_user_id", "native_push_tokens", ["user_id"], unique=False, schema=app_schema)
    if "ix_native_push_tokens_provider" not in indexes:
        op.create_index("ix_native_push_tokens_provider", "native_push_tokens", ["provider"], unique=False, schema=app_schema)
    if "ix_native_push_tokens_platform" not in indexes:
        op.create_index("ix_native_push_tokens_platform", "native_push_tokens", ["platform"], unique=False, schema=app_schema)
    if "ix_native_push_tokens_is_active" not in indexes:
        op.create_index("ix_native_push_tokens_is_active", "native_push_tokens", ["is_active"], unique=False, schema=app_schema)
    if "ix_app_native_push_tokens_user_active" not in indexes:
        op.create_index(
            "ix_app_native_push_tokens_user_active",
            "native_push_tokens",
            ["user_id", "is_active"],
            unique=False,
            schema=app_schema,
        )
    if "ix_app_native_push_tokens_device_id" not in indexes:
        op.create_index("ix_app_native_push_tokens_device_id", "native_push_tokens", ["device_id"], unique=False, schema=app_schema)


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")
    if not _has_table(app_schema, "native_push_tokens"):
        return

    indexes = _index_names(app_schema, "native_push_tokens")
    for index_name in (
        "ix_app_native_push_tokens_device_id",
        "ix_app_native_push_tokens_user_active",
        "ix_native_push_tokens_is_active",
        "ix_native_push_tokens_platform",
        "ix_native_push_tokens_provider",
        "ix_native_push_tokens_user_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="native_push_tokens", schema=app_schema)
    op.drop_table("native_push_tokens", schema=app_schema)
