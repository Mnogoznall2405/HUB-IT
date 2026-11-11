"""Add background my-files preview cache

Revision ID: 20260608_0046
Revises: 20260607_0046
Create Date: 2026-06-08 13:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260608_0046"
down_revision = "20260607_0046"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _columns(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _add_column_if_missing(table_name: str, column: sa.Column, *, schema: str | None) -> None:
    if column.name in _columns(schema, table_name):
        return
    op.add_column(table_name, column, schema=schema)


def _drop_column_if_present(table_name: str, column_name: str, *, schema: str | None) -> None:
    if column_name not in _columns(schema, table_name):
        return
    op.drop_column(table_name, column_name, schema=schema)


def _create_index_if_missing(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, unique=False, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")

    if not _has_table(app_schema, "my_file_previews"):
        op.create_table(
            "my_file_previews",
            sa.Column("blob_id", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
            sa.Column("preview_kind", sa.String(length=32), nullable=False, server_default="unsupported"),
            sa.Column("source_kind", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("source_filename", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("content_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("preview_path", sa.Text(), nullable=False, server_default=""),
            sa.Column("preview_mime_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            sa.Column("preview_filename", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sheets_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("error_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("blob_id"),
            schema=app_schema,
        )
    else:
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("source_kind", sa.String(length=32), nullable=False, server_default=""),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("source_filename", sa.String(length=512), nullable=False, server_default=""),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("content_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("preview_path", sa.Text(), nullable=False, server_default=""),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("preview_mime_type", sa.String(length=255), nullable=False, server_default="application/octet-stream"),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("preview_filename", sa.String(length=512), nullable=False, server_default=""),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("sheets_json", sa.Text(), nullable=False, server_default="[]"),
            schema=app_schema,
        )
        _add_column_if_missing(
            "my_file_previews",
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
            schema=app_schema,
        )
        columns = _columns(app_schema, "my_file_previews")
        if "document_path" in columns:
            quoted_schema = '"app".' if app_schema else ""
            op.execute(
                sa.text(
                    f"""
                    UPDATE {quoted_schema}"my_file_previews"
                    SET preview_path = COALESCE(NULLIF(preview_path, ''), document_path, ''),
                        preview_mime_type = COALESCE(NULLIF(preview_mime_type, ''), document_mime_type, 'application/pdf'),
                        preview_filename = COALESCE(NULLIF(preview_filename, ''), 'preview.pdf'),
                        generated_at = COALESCE(generated_at, updated_at)
                    """
                )
            )
        _drop_column_if_present("my_file_previews", "thumbnail_path", schema=app_schema)
        _drop_column_if_present("my_file_previews", "document_path", schema=app_schema)
        _drop_column_if_present("my_file_previews", "document_mime_type", schema=app_schema)

    _create_index_if_missing(
        "ix_app_my_file_previews_status_updated",
        "my_file_previews",
        ["status", "updated_at"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_my_file_previews_kind_status",
        "my_file_previews",
        ["preview_kind", "status"],
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if "ix_app_my_file_previews_kind_status" in _index_names(app_schema, "my_file_previews"):
        op.drop_index("ix_app_my_file_previews_kind_status", table_name="my_file_previews", schema=app_schema)
    if "ix_app_my_file_previews_status_updated" in _index_names(app_schema, "my_file_previews"):
        op.drop_index("ix_app_my_file_previews_status_updated", table_name="my_file_previews", schema=app_schema)
    if _has_table(app_schema, "my_file_previews"):
        op.drop_table("my_file_previews", schema=app_schema)
