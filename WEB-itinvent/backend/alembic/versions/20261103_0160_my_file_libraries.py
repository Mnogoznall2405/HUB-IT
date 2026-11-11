"""Add shared libraries ("Общие папки") for My Files.

Revision ID: 20261103_0160
Revises: 20261103_0159

A library is an owner namespace of its own: its files and folders carry a negative
``owner_user_id`` stored in ``my_file_libraries``, so they never count against a person's quota or
retention. Members are portal users or whole departments (resolved live) with a role.
``my_files.uploaded_by_user_id`` remembers who really uploaded a file into a library.
Created "if missing"; without the tables personal files keep working.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261103_0160"
down_revision = "20261103_0159"
branch_labels = None
depends_on = None

LIBRARIES = "my_file_libraries"
MEMBERS = "my_file_library_members"
MEMBERS_INDEX = "ix_app_my_file_library_members_principal"
FILES = "my_files"
UPLOADED_BY = "uploaded_by_user_id"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(name: str, schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=schema)


def _has_column(table: str, column: str, schema: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(item["name"] == column for item in inspector.get_columns(table, schema=schema))


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(LIBRARIES, schema):
        op.create_table(
            LIBRARIES,
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), nullable=False),
            sa.Column("quota_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id", name="pk_app_my_file_libraries"),
            sa.UniqueConstraint("owner_user_id", name="uq_app_my_file_libraries_owner"),
            schema=schema,
        )
    if not _has_table(MEMBERS, schema):
        op.create_table(
            MEMBERS,
            sa.Column("library_id", sa.String(length=64), nullable=False),
            sa.Column("principal_type", sa.String(length=16), nullable=False),
            sa.Column("principal_id", sa.String(length=64), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="edit"),
            sa.Column("added_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("library_id", "principal_type", "principal_id", name="pk_app_my_file_library_members"),
            schema=schema,
        )
        op.create_index(MEMBERS_INDEX, MEMBERS, ["principal_type", "principal_id"], schema=schema)
    if not _has_column(FILES, UPLOADED_BY, schema):
        op.add_column(FILES, sa.Column(UPLOADED_BY, sa.Integer(), nullable=True), schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_column(FILES, UPLOADED_BY, schema):
        with op.batch_alter_table(FILES, schema=schema) as batch:
            batch.drop_column(UPLOADED_BY)
    if _has_table(MEMBERS, schema):
        op.drop_index(MEMBERS_INDEX, table_name=MEMBERS, schema=schema)
        op.drop_table(MEMBERS, schema=schema)
    if _has_table(LIBRARIES, schema):
        op.drop_table(LIBRARIES, schema=schema)
