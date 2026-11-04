"""Add folder-level access (edit / comment / view) for My Files co-editing.

Revision ID: 20261103_0159
Revises: 20261103_0158

Created "if missing". A grant on a folder applies to every file in the folder and its subfolders,
including files added later; without the table file-level collaborators keep working.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261103_0159"
down_revision = "20261103_0158"
branch_labels = None
depends_on = None

TABLE = "my_file_folder_collaborators"
INDEX = "ix_app_my_file_folder_collaborators_user"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema):
        return
    op.create_table(
        TABLE,
        sa.Column("folder_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("added_by_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="edit"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("folder_id", "user_id", name="pk_app_my_file_folder_collaborators"),
        schema=schema,
    )
    op.create_index(INDEX, TABLE, ["user_id"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema):
        op.drop_index(INDEX, table_name=TABLE, schema=schema)
        op.drop_table(TABLE, schema=schema)
