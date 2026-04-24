"""add auth security stack tables and columns

Revision ID: 20260330_0013
Revises: 20260330_0012
Create Date: 2026-03-30 20:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260330_0013"
down_revision = "20260330_0012"
branch_labels = None
depends_on = None


def _column_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {str(item.get("name") or "").strip().lower() for item in inspector.get_columns(table_name, schema=schema)}


def _index_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def _has_table(schema: str, table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return inspector.has_table(table_name, schema=schema)


def upgrade() -> None:
    user_columns = _column_names("app", "users")
    user_indexes = _index_names("app", "users")

    if "totp_secret_enc" not in user_columns:
        op.add_column(
            "users",
            sa.Column("totp_secret_enc", sa.Text(), nullable=False, server_default=""),
            schema="app",
        )
        op.alter_column("users", "totp_secret_enc", server_default=None, schema="app")

    if "is_2fa_enabled" not in user_columns:
        op.add_column(
            "users",
            sa.Column("is_2fa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            schema="app",
        )
        op.alter_column("users", "is_2fa_enabled", server_default=None, schema="app")

    if "twofa_enabled_at" not in user_columns:
        op.add_column(
            "users",
            sa.Column("twofa_enabled_at", sa.DateTime(timezone=True), nullable=True),
            schema="app",
        )

    if "ix_app_users_is_2fa_enabled" not in user_indexes:
        op.create_index(
            "ix_app_users_is_2fa_enabled",
            "users",
            ["is_2fa_enabled"],
            unique=False,
            schema="app",
        )

    if not _has_table("app", "user_2fa_backup_codes"):
        op.create_table(
            "user_2fa_backup_codes",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("code_hash", sa.Text(), nullable=False),
            sa.Column("code_suffix", sa.String(length=16), nullable=False, server_default=""),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema="app",
        )
        op.alter_column("user_2fa_backup_codes", "code_suffix", server_default=None, schema="app")
    backup_indexes = _index_names("app", "user_2fa_backup_codes")
    if "ix_app_user_2fa_backup_codes_user_id" not in backup_indexes:
        op.create_index(
            "ix_app_user_2fa_backup_codes_user_id",
            "user_2fa_backup_codes",
            ["user_id"],
            unique=False,
            schema="app",
        )

    if not _has_table("app", "trusted_devices"):
        op.create_table(
            "trusted_devices",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("credential_id", sa.Text(), nullable=False),
            sa.Column("public_key_b64", sa.Text(), nullable=False),
            sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("transports_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("aaguid", sa.String(length=128), nullable=True),
            sa.Column("rp_id", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("origin", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("credential_id", name="uq_app_trusted_devices_credential_id"),
            schema="app",
        )
        op.alter_column("trusted_devices", "label", server_default=None, schema="app")
        op.alter_column("trusted_devices", "sign_count", server_default=None, schema="app")
        op.alter_column("trusted_devices", "transports_json", server_default=None, schema="app")
        op.alter_column("trusted_devices", "rp_id", server_default=None, schema="app")
        op.alter_column("trusted_devices", "origin", server_default=None, schema="app")
        op.alter_column("trusted_devices", "is_active", server_default=None, schema="app")
    trusted_indexes = _index_names("app", "trusted_devices")
    if "ix_app_trusted_devices_user_id" not in trusted_indexes:
        op.create_index(
            "ix_app_trusted_devices_user_id",
            "trusted_devices",
            ["user_id"],
            unique=False,
            schema="app",
        )
    if "ix_app_trusted_devices_is_active" not in trusted_indexes:
        op.create_index(
            "ix_app_trusted_devices_is_active",
            "trusted_devices",
            ["is_active"],
            unique=False,
            schema="app",
        )


def downgrade() -> None:
    if _has_table("app", "trusted_devices"):
        trusted_indexes = _index_names("app", "trusted_devices")
        if "ix_app_trusted_devices_is_active" in trusted_indexes:
            op.drop_index("ix_app_trusted_devices_is_active", table_name="trusted_devices", schema="app")
        if "ix_app_trusted_devices_user_id" in trusted_indexes:
            op.drop_index("ix_app_trusted_devices_user_id", table_name="trusted_devices", schema="app")
        op.drop_table("trusted_devices", schema="app")
    if _has_table("app", "user_2fa_backup_codes"):
        backup_indexes = _index_names("app", "user_2fa_backup_codes")
        if "ix_app_user_2fa_backup_codes_user_id" in backup_indexes:
            op.drop_index("ix_app_user_2fa_backup_codes_user_id", table_name="user_2fa_backup_codes", schema="app")
        op.drop_table("user_2fa_backup_codes", schema="app")
    user_indexes = _index_names("app", "users")
    if "ix_app_users_is_2fa_enabled" in user_indexes:
        op.drop_index("ix_app_users_is_2fa_enabled", table_name="users", schema="app")
    user_columns = _column_names("app", "users")
    if "twofa_enabled_at" in user_columns:
        op.drop_column("users", "twofa_enabled_at", schema="app")
    if "is_2fa_enabled" in user_columns:
        op.drop_column("users", "is_2fa_enabled", schema="app")
    if "totp_secret_enc" in user_columns:
        op.drop_column("users", "totp_secret_enc", schema="app")
