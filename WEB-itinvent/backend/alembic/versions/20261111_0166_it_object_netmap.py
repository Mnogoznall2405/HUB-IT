"""Add the IT object network map: one drawio (mxfile) document per object.

Revision ID: 20261111_0166
Revises: 20261110_0165

Created "if missing". The netmap API answers 503 until this migration is applied explicitly at
release time; nothing else in the application depends on the table.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261111_0166"
down_revision = "20261110_0165"
branch_labels = None
depends_on = None

TABLE = "it_object_netmaps"


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

    if not _has_table(schema, TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("xml", sa.Text(), nullable=False, server_default=""),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("updated_by_user_id", sa.Integer(), nullable=False),
            sa.Column("updated_by_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_object_netmaps"),
            sa.UniqueConstraint("object_id", name="uq_app_it_object_netmaps_object"),
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, TABLE):
        op.drop_table(TABLE, schema=schema)
