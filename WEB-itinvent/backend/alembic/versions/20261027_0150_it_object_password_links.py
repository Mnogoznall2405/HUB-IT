"""Add it_object_password_links (password vault entry -> IT object).

Revision ID: 20261027_0150
Revises: 20261027_0149

Created "if missing". The password vault treats a missing table as "no entry is linked to an object",
so a restart before this migration is applied does not break the vault; linking entries to objects
answers 503 until it is applied.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261027_0150"
down_revision = "20261027_0149"
branch_labels = None
depends_on = None

TABLE_NAME = "it_object_password_links"


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
    if _has_table(schema, TABLE_NAME):
        return
    op.create_table(
        TABLE_NAME,
        sa.Column("entry_id", sa.String(length=64), nullable=False),
        sa.Column("object_ref", sa.String(length=128), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("entry_id", name="pk_app_it_object_password_links"),
        schema=schema,
    )
    op.create_index("ix_app_it_object_password_links_object", TABLE_NAME, ["object_ref"], schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, TABLE_NAME):
        op.drop_table(TABLE_NAME, schema=schema)
