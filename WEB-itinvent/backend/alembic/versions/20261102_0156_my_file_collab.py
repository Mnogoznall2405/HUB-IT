"""Add collaborators and version history for My Files co-editing.

Revision ID: 20261102_0156
Revises: 20261102_0155

Created "if missing". The tables are used only by the ONLYOFFICE co-editing flow
(``ONLYOFFICE_ENABLED``); without them the rest of My Files keeps working.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261102_0156"
down_revision = "20261102_0155"
branch_labels = None
depends_on = None

COLLABORATORS = "my_file_collaborators"
VERSIONS = "my_file_versions"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    now = sa.func.now()
    if not _has_table(schema, COLLABORATORS):
        op.create_table(
            COLLABORATORS,
            sa.Column("file_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("added_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("file_id", "user_id", name="pk_app_my_file_collaborators"),
            schema=schema,
        )
        op.create_index("ix_app_my_file_collaborators_user", COLLABORATORS, ["user_id"], schema=schema)
    if not _has_table(schema, VERSIONS):
        op.create_table(
            VERSIONS,
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("file_id", sa.String(length=64), nullable=False),
            sa.Column("version_no", sa.Integer(), nullable=False),
            sa.Column("blob_id", sa.String(length=64), nullable=False),
            sa.Column("original_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("original_size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("session_key", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("id", name="pk_app_my_file_versions"),
            sa.UniqueConstraint("file_id", "version_no", name="uq_app_my_file_versions_file_no"),
            schema=schema,
        )
        op.create_index("ix_app_my_file_versions_file", VERSIONS, ["file_id", "version_no"], schema=schema)
        op.create_index("ix_app_my_file_versions_blob", VERSIONS, ["blob_id"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, VERSIONS):
        op.drop_index("ix_app_my_file_versions_blob", table_name=VERSIONS, schema=schema)
        op.drop_index("ix_app_my_file_versions_file", table_name=VERSIONS, schema=schema)
        op.drop_table(VERSIONS, schema=schema)
    if _has_table(schema, COLLABORATORS):
        op.drop_index("ix_app_my_file_collaborators_user", table_name=COLLABORATORS, schema=schema)
        op.drop_table(COLLABORATORS, schema=schema)
