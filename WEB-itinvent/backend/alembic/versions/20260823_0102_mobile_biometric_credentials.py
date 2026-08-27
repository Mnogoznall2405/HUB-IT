"""Add revocable APK biometric renewal credentials.

Revision ID: 20260823_0102
Revises: 20260822_0101
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260823_0102"
down_revision = "20260822_0101"
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
    if not op.get_context().as_sql:
        inspector = sa.inspect(op.get_bind())
        if inspector.has_table("mobile_biometric_credentials", schema=schema):
            return
    op.create_table(
        "mobile_biometric_credentials",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("client_device_key_hash", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_device_key_hash", name="uq_app_mobile_biometric_user_device"),
        sa.UniqueConstraint("token_hash", name="uq_app_mobile_biometric_token_hash"),
        schema=schema,
    )
    for name, columns in (
        ("ix_app_mobile_biometric_credentials_user_id", ["user_id"]),
        ("ix_app_mobile_biometric_credentials_client_device_key_hash", ["client_device_key_hash"]),
        ("ix_app_mobile_biometric_credentials_is_active", ["is_active"]),
        ("ix_app_mobile_biometric_user_active", ["user_id", "is_active"]),
    ):
        op.create_index(name, "mobile_biometric_credentials", columns, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if op.get_context().as_sql:
        op.drop_table("mobile_biometric_credentials", schema=schema)
        return
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("mobile_biometric_credentials", schema=schema):
        op.drop_table("mobile_biometric_credentials", schema=schema)
