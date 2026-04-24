"""add DB-backed auth runtime store and trusted-device expiry

Revision ID: 20260424_0022
Revises: 20260418_0021
Create Date: 2026-04-24 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260424_0022"
down_revision = "20260418_0021"
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    return None if op.get_bind().dialect.name == "sqlite" else name


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _column_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip().lower() for item in inspector.get_columns(table_name, schema=schema)}


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    app_schema = _schema("app")
    system_schema = _schema("system")
    if system_schema:
        op.execute('CREATE SCHEMA IF NOT EXISTS "system"')

    if not _has_table(system_schema, "auth_runtime_items"):
        op.create_table(
            "auth_runtime_items",
            sa.Column("namespace", sa.String(length=64), nullable=False),
            sa.Column("item_key", sa.String(length=512), nullable=False),
            sa.Column("value_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("namespace", "item_key"),
            schema=system_schema,
        )
        if op.get_bind().dialect.name != "sqlite":
            op.alter_column("auth_runtime_items", "value_text", server_default=None, schema=system_schema)

    runtime_indexes = _index_names(system_schema, "auth_runtime_items")
    if "ix_system_auth_runtime_items_namespace" not in runtime_indexes:
        op.create_index(
            "ix_system_auth_runtime_items_namespace",
            "auth_runtime_items",
            ["namespace"],
            unique=False,
            schema=system_schema,
        )
    if "ix_system_auth_runtime_items_expires_at" not in runtime_indexes:
        op.create_index(
            "ix_system_auth_runtime_items_expires_at",
            "auth_runtime_items",
            ["expires_at"],
            unique=False,
            schema=system_schema,
        )

    trusted_columns = _column_names(app_schema, "trusted_devices")
    if trusted_columns and "expires_at" not in trusted_columns:
        op.add_column(
            "trusted_devices",
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            schema=app_schema,
        )
    trusted_indexes = _index_names(app_schema, "trusted_devices")
    if trusted_columns and "ix_app_trusted_devices_expires_at" not in trusted_indexes:
        op.create_index(
            "ix_app_trusted_devices_expires_at",
            "trusted_devices",
            ["expires_at"],
            unique=False,
            schema=app_schema,
        )


def downgrade() -> None:
    app_schema = _schema("app")
    system_schema = _schema("system")

    if _has_table(app_schema, "trusted_devices"):
        trusted_indexes = _index_names(app_schema, "trusted_devices")
        if "ix_app_trusted_devices_expires_at" in trusted_indexes:
            op.drop_index("ix_app_trusted_devices_expires_at", table_name="trusted_devices", schema=app_schema)
        trusted_columns = _column_names(app_schema, "trusted_devices")
        if "expires_at" in trusted_columns:
            op.drop_column("trusted_devices", "expires_at", schema=app_schema)

    if _has_table(system_schema, "auth_runtime_items"):
        runtime_indexes = _index_names(system_schema, "auth_runtime_items")
        if "ix_system_auth_runtime_items_expires_at" in runtime_indexes:
            op.drop_index("ix_system_auth_runtime_items_expires_at", table_name="auth_runtime_items", schema=system_schema)
        if "ix_system_auth_runtime_items_namespace" in runtime_indexes:
            op.drop_index("ix_system_auth_runtime_items_namespace", table_name="auth_runtime_items", schema=system_schema)
        op.drop_table("auth_runtime_items", schema=system_schema)
