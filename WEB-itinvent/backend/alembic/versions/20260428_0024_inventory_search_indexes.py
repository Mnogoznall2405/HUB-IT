"""add inventory search index tables

Revision ID: 20260428_0024
Revises: 20260427_0023
Create Date: 2026-04-28 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260428_0024"
down_revision = "20260427_0023"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def _create_index(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, unique=False, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if not _has_table(schema, "inventory_user_profiles"):
        op.create_table(
            "inventory_user_profiles",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("mac_address", sa.String(length=64), nullable=False),
            sa.Column("user_name", sa.String(length=255), nullable=True),
            sa.Column("profile_path", sa.Text(), nullable=True),
            sa.Column("total_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("files_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("dirs_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("errors_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("partial", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    _create_index("ix_app_inventory_user_profiles_mac_address", "inventory_user_profiles", ["mac_address"], schema=schema)
    _create_index("ix_app_inventory_user_profiles_user_name", "inventory_user_profiles", ["user_name"], schema=schema)
    _create_index("ix_app_inventory_user_profiles_profile_path", "inventory_user_profiles", ["profile_path"], schema=schema)

    if not _has_table(schema, "inventory_outlook_files"):
        op.create_table(
            "inventory_outlook_files",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("mac_address", sa.String(length=64), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False, server_default="archive"),
            sa.Column("file_path", sa.Text(), nullable=True),
            sa.Column("file_type", sa.String(length=32), nullable=True),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("last_modified_at", sa.Integer(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    _create_index("ix_app_inventory_outlook_files_mac_address", "inventory_outlook_files", ["mac_address"], schema=schema)
    _create_index("ix_app_inventory_outlook_files_kind", "inventory_outlook_files", ["kind"], schema=schema)
    _create_index("ix_app_inventory_outlook_files_file_path", "inventory_outlook_files", ["file_path"], schema=schema)
    _create_index("ix_app_inventory_outlook_files_file_type", "inventory_outlook_files", ["file_type"], schema=schema)
    _create_index("ix_app_inventory_outlook_files_size_bytes", "inventory_outlook_files", ["size_bytes"], schema=schema)

    if not _has_table(schema, "inventory_host_sql_contexts"):
        op.create_table(
            "inventory_host_sql_contexts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("mac_address", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("hostname", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("db_id", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("branch_no", sa.String(length=64), nullable=True),
            sa.Column("branch_name", sa.String(length=255), nullable=True),
            sa.Column("location_name", sa.String(length=255), nullable=True),
            sa.Column("employee_name", sa.String(length=255), nullable=True),
            sa.Column("ip_address", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("mac_address", "hostname", "db_id", name="uq_app_inventory_host_sql_context"),
            schema=schema,
        )
    _create_index("ix_app_inventory_host_sql_contexts_mac_address", "inventory_host_sql_contexts", ["mac_address"], schema=schema)
    _create_index("ix_app_inventory_host_sql_contexts_hostname", "inventory_host_sql_contexts", ["hostname"], schema=schema)
    _create_index("ix_app_inventory_host_sql_contexts_db_id", "inventory_host_sql_contexts", ["db_id"], schema=schema)
    _create_index("ix_app_inventory_host_sql_contexts_branch_name", "inventory_host_sql_contexts", ["branch_name"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    for name in [
        "ix_app_inventory_host_sql_contexts_branch_name",
        "ix_app_inventory_host_sql_contexts_db_id",
        "ix_app_inventory_host_sql_contexts_hostname",
        "ix_app_inventory_host_sql_contexts_mac_address",
    ]:
        if _has_table(schema, "inventory_host_sql_contexts") and name in _index_names(schema, "inventory_host_sql_contexts"):
            op.drop_index(name, table_name="inventory_host_sql_contexts", schema=schema)
    if _has_table(schema, "inventory_host_sql_contexts"):
        op.drop_table("inventory_host_sql_contexts", schema=schema)

    for name in [
        "ix_app_inventory_outlook_files_size_bytes",
        "ix_app_inventory_outlook_files_file_type",
        "ix_app_inventory_outlook_files_file_path",
        "ix_app_inventory_outlook_files_kind",
        "ix_app_inventory_outlook_files_mac_address",
    ]:
        if _has_table(schema, "inventory_outlook_files") and name in _index_names(schema, "inventory_outlook_files"):
            op.drop_index(name, table_name="inventory_outlook_files", schema=schema)
    if _has_table(schema, "inventory_outlook_files"):
        op.drop_table("inventory_outlook_files", schema=schema)

    for name in [
        "ix_app_inventory_user_profiles_profile_path",
        "ix_app_inventory_user_profiles_user_name",
        "ix_app_inventory_user_profiles_mac_address",
    ]:
        if _has_table(schema, "inventory_user_profiles") and name in _index_names(schema, "inventory_user_profiles"):
            op.drop_index(name, table_name="inventory_user_profiles", schema=schema)
    if _has_table(schema, "inventory_user_profiles"):
        op.drop_table("inventory_user_profiles", schema=schema)
