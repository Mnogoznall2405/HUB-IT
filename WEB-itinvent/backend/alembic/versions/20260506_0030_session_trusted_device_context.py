"""add session trusted-device client context

Revision ID: 20260506_0030
Revises: 20260502_0029
Create Date: 2026-05-06 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260506_0030"
down_revision = "20260502_0029"
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
    if not _has_table(app_schema, "sessions"):
        return

    columns = _column_names(app_schema, "sessions")
    additions = [
        ("auth_method", sa.Column("auth_method", sa.String(length=32), nullable=False, server_default="legacy")),
        ("trusted_device_id", sa.Column("trusted_device_id", sa.String(length=64), nullable=True)),
        ("client_browser_family", sa.Column("client_browser_family", sa.String(length=32), nullable=False, server_default="unknown")),
        ("client_os_family", sa.Column("client_os_family", sa.String(length=32), nullable=False, server_default="unknown")),
        ("client_fingerprint_hash", sa.Column("client_fingerprint_hash", sa.String(length=64), nullable=False, server_default="")),
    ]
    for name, column in additions:
        if name not in columns:
            op.add_column("sessions", column, schema=app_schema)

    indexes = _index_names(app_schema, "sessions")
    if "ix_app_sessions_trusted_device_id" not in indexes:
        op.create_index(
            "ix_app_sessions_trusted_device_id",
            "sessions",
            ["trusted_device_id"],
            unique=False,
            schema=app_schema,
        )


def downgrade() -> None:
    app_schema = _schema("app")
    if not _has_table(app_schema, "sessions"):
        return

    indexes = _index_names(app_schema, "sessions")
    if "ix_app_sessions_trusted_device_id" in indexes:
        op.drop_index("ix_app_sessions_trusted_device_id", table_name="sessions", schema=app_schema)

    columns = _column_names(app_schema, "sessions")
    for name in (
        "client_fingerprint_hash",
        "client_os_family",
        "client_browser_family",
        "trusted_device_id",
        "auth_method",
    ):
        if name in columns:
            op.drop_column("sessions", name, schema=app_schema)
