"""my files storage

Revision ID: 20260603_0040
Revises: 20260603_0039
Create Date: 2026-06-03 15:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260603_0040"
down_revision = "20260603_0039"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _create_index_if_missing(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")

    if not _has_table(app_schema, "my_file_blobs"):
        op.create_table(
            "my_file_blobs",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("storage_path", sa.Text(), nullable=False, server_default=""),
            sa.Column("storage_mode", sa.String(length=32), nullable=False, server_default="stored"),
            sa.Column("stored_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("original_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("stored_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("output_mime_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("output_extension", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("ref_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    _create_index_if_missing(
        "ix_app_my_file_blobs_ref_count",
        "my_file_blobs",
        ["ref_count"],
        schema=app_schema,
    )

    if not _has_table(app_schema, "my_files"):
        op.create_table(
            "my_files",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), nullable=False),
            sa.Column("owner_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("original_file_name", sa.String(length=512), nullable=False, server_default="file.bin"),
            sa.Column("download_file_name", sa.String(length=512), nullable=False, server_default="file.bin"),
            sa.Column("mime_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("download_mime_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("original_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("stored_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("retention_days", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
            sa.Column("storage_mode", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("original_sha256", sa.String(length=64), nullable=True),
            sa.Column("blob_id", sa.String(length=64), nullable=True),
            sa.Column("spool_path", sa.Text(), nullable=False, server_default=""),
            sa.Column("error_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("share_token_hash", sa.String(length=64), nullable=True),
            sa.Column("share_created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    for index_name, columns in (
        ("ix_app_my_files_owner_user_id", ["owner_user_id"]),
        ("ix_app_my_files_status", ["status"]),
        ("ix_app_my_files_expires_at", ["expires_at"]),
        ("ix_app_my_files_owner_status_created", ["owner_user_id", "status", "created_at"]),
        ("ix_app_my_files_status_created", ["status", "created_at"]),
        ("ix_app_my_files_expires_status", ["expires_at", "status"]),
        ("ix_app_my_files_share_token_hash", ["share_token_hash"]),
        ("ix_app_my_files_original_sha256", ["original_sha256"]),
    ):
        _create_index_if_missing(index_name, "my_files", columns, schema=app_schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if _has_table(app_schema, "my_files"):
        for index_name in (
            "ix_app_my_files_original_sha256",
            "ix_app_my_files_share_token_hash",
            "ix_app_my_files_expires_status",
            "ix_app_my_files_status_created",
            "ix_app_my_files_owner_status_created",
            "ix_app_my_files_expires_at",
            "ix_app_my_files_status",
            "ix_app_my_files_owner_user_id",
        ):
            if index_name in _index_names(app_schema, "my_files"):
                op.drop_index(index_name, table_name="my_files", schema=app_schema)
        op.drop_table("my_files", schema=app_schema)
    if _has_table(app_schema, "my_file_blobs"):
        if "ix_app_my_file_blobs_ref_count" in _index_names(app_schema, "my_file_blobs"):
            op.drop_index("ix_app_my_file_blobs_ref_count", table_name="my_file_blobs", schema=app_schema)
        op.drop_table("my_file_blobs", schema=app_schema)
