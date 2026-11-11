"""my files blob identity v2 (uuid + per-owner dedup)

Revision ID: 20260909_0110
Revises: 20260908_0109
Create Date: 2026-09-09 10:40:00.000000

Renames legacy blob/preview tables and creates the v2 schema.
Data backfill is performed by scripts/migrate_my_files_storage_v2.py
(with --dry-run support), not inside this revision.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260909_0110"
down_revision = "20260908_0109"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _constraint_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    inspector = sa.inspect(op.get_bind())
    names: set[str] = set()
    pk_name = (inspector.get_pk_constraint(table_name, schema=schema) or {}).get("name")
    if pk_name:
        names.add(str(pk_name))
    for getter in (
        inspector.get_unique_constraints,
        inspector.get_foreign_keys,
        inspector.get_check_constraints,
    ):
        for item in getter(table_name, schema=schema):
            name = item.get("name")
            if name:
                names.add(str(name))
    return names


def _rename_index_if_present(old_name: str, new_name: str, *, table_name: str, schema: str | None) -> None:
    existing = _index_names(schema, table_name)
    if old_name not in existing or new_name in existing:
        return
    if op.get_bind().dialect.name == "postgresql":
        qualified = f'"{schema}"."{old_name}"' if schema else f'"{old_name}"'
        op.execute(sa.text(f'ALTER INDEX {qualified} RENAME TO "{new_name}"'))
        return
    op.execute(sa.text(f'ALTER INDEX "{old_name}" RENAME TO "{new_name}"'))


def _rename_constraint_if_present(
    old_name: str,
    new_name: str,
    *,
    table_name: str,
    schema: str | None,
) -> None:
    existing = _constraint_names(schema, table_name)
    if old_name not in existing or new_name in existing:
        return
    if op.get_bind().dialect.name == "postgresql":
        qualified_table = f'"{schema}"."{table_name}"' if schema else f'"{table_name}"'
        op.execute(
            sa.text(f'ALTER TABLE {qualified_table} RENAME CONSTRAINT "{old_name}" TO "{new_name}"')
        )
        return
    op.execute(sa.text(f'ALTER TABLE "{table_name}" RENAME CONSTRAINT "{old_name}" TO "{new_name}"'))


def _create_index_if_missing(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, schema=schema)


def _prepare_legacy_blob_table(schema: str | None) -> None:
    """Rename legacy table and free schema-global index/constraint names for v2."""
    if not _has_table(schema, "my_file_blobs_v1"):
        op.rename_table("my_file_blobs", "my_file_blobs_v1", schema=schema)
    # Index names are schema-global in PostgreSQL; keep them unique after rename.
    _rename_index_if_present(
        "ix_app_my_file_blobs_ref_count",
        "ix_app_my_file_blobs_v1_ref_count",
        table_name="my_file_blobs_v1",
        schema=schema,
    )
    _rename_constraint_if_present(
        "my_file_blobs_pkey",
        "my_file_blobs_v1_pkey",
        table_name="my_file_blobs_v1",
        schema=schema,
    )


def _prepare_legacy_preview_table(schema: str | None) -> None:
    if not _has_table(schema, "my_file_previews"):
        return
    if not _has_table(schema, "my_file_previews_v1"):
        op.rename_table("my_file_previews", "my_file_previews_v1", schema=schema)
    _rename_index_if_present(
        "ix_app_my_file_previews_status_updated",
        "ix_app_my_file_previews_v1_status_updated",
        table_name="my_file_previews_v1",
        schema=schema,
    )
    _rename_index_if_present(
        "ix_app_my_file_previews_kind_status",
        "ix_app_my_file_previews_v1_kind_status",
        table_name="my_file_previews_v1",
        schema=schema,
    )
    _rename_constraint_if_present(
        "my_file_previews_pkey",
        "my_file_previews_v1_pkey",
        table_name="my_file_previews_v1",
        schema=schema,
    )


def _restore_legacy_blob_names(schema: str | None) -> None:
    _rename_index_if_present(
        "ix_app_my_file_blobs_v1_ref_count",
        "ix_app_my_file_blobs_ref_count",
        table_name="my_file_blobs_v1",
        schema=schema,
    )
    _rename_constraint_if_present(
        "my_file_blobs_v1_pkey",
        "my_file_blobs_pkey",
        table_name="my_file_blobs_v1",
        schema=schema,
    )


def _restore_legacy_preview_names(schema: str | None) -> None:
    _rename_index_if_present(
        "ix_app_my_file_previews_v1_status_updated",
        "ix_app_my_file_previews_status_updated",
        table_name="my_file_previews_v1",
        schema=schema,
    )
    _rename_index_if_present(
        "ix_app_my_file_previews_v1_kind_status",
        "ix_app_my_file_previews_kind_status",
        table_name="my_file_previews_v1",
        schema=schema,
    )
    _rename_constraint_if_present(
        "my_file_previews_v1_pkey",
        "my_file_previews_pkey",
        table_name="my_file_previews_v1",
        schema=schema,
    )


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "my_file_blobs"):
        return

    # Preserve legacy rows for the offline data migrator.
    _prepare_legacy_blob_table(schema)
    _prepare_legacy_preview_table(schema)

    if not _has_table(schema, "my_file_blobs"):
        op.create_table(
            "my_file_blobs",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("owner_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("original_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("storage_path", sa.Text(), nullable=False, server_default=""),
            sa.Column("storage_mode", sa.String(length=32), nullable=False, server_default="stored"),
            sa.Column("stored_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("original_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("stored_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column(
                "output_mime_type",
                sa.String(length=255),
                nullable=False,
                server_default="application/octet-stream",
            ),
            sa.Column("output_extension", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("ref_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint(
                "owner_user_id",
                "original_sha256",
                name="uq_app_my_file_blobs_owner_original_sha",
            ),
            schema=schema,
        )
    for index_name, columns in (
        ("ix_app_my_file_blobs_ref_count", ["ref_count"]),
        ("ix_app_my_file_blobs_owner_user_id", ["owner_user_id"]),
        ("ix_app_my_file_blobs_original_sha256", ["original_sha256"]),
    ):
        _create_index_if_missing(index_name, "my_file_blobs", columns, schema=schema)

    if not _has_table(schema, "my_file_previews"):
        op.create_table(
            "my_file_previews",
            sa.Column("blob_id", sa.String(length=64), primary_key=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
            sa.Column("preview_kind", sa.String(length=32), nullable=False, server_default="unsupported"),
            sa.Column("source_kind", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("source_filename", sa.String(length=512), nullable=False, server_default=""),
            sa.Column(
                "content_type",
                sa.String(length=255),
                nullable=False,
                server_default="application/octet-stream",
            ),
            sa.Column("preview_path", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "preview_mime_type",
                sa.String(length=255),
                nullable=False,
                server_default="application/octet-stream",
            ),
            sa.Column("preview_filename", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sheets_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("error_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
            schema=schema,
        )
    for index_name, columns in (
        ("ix_app_my_file_previews_status_updated", ["status", "updated_at"]),
        ("ix_app_my_file_previews_kind_status", ["preview_kind", "status"]),
    ):
        if _has_table(schema, "my_file_previews"):
            _create_index_if_missing(index_name, "my_file_previews", columns, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, "my_file_blobs") and _has_table(schema, "my_file_blobs_v1"):
        op.drop_table("my_file_blobs", schema=schema)
        _restore_legacy_blob_names(schema)
        op.rename_table("my_file_blobs_v1", "my_file_blobs", schema=schema)
    if _has_table(schema, "my_file_previews") and _has_table(schema, "my_file_previews_v1"):
        op.drop_table("my_file_previews", schema=schema)
        _restore_legacy_preview_names(schema)
        op.rename_table("my_file_previews_v1", "my_file_previews", schema=schema)
