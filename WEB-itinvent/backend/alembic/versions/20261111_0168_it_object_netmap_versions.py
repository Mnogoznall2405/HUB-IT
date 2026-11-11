"""IT object network map history and PNG preview.

Revision ID: 20261111_0168
Revises: 20261111_0167

- ``it_object_netmaps.preview_png``: PNG thumbnail rendered by the embed editor
  export action; NULL until the first save from the editor.
- ``it_object_netmap_versions``: snapshot of every saved map revision so a
  version can be viewed or restored later.

Both created "if missing" / added "if missing"; the netmap API answers 503 until
this migration is applied explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261111_0168"
down_revision = "20261111_0167"
branch_labels = None
depends_on = None

TABLE = "it_object_netmaps"
VERSIONS_TABLE = "it_object_netmap_versions"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def _columns(schema: str | None, table_name: str) -> set[str]:
    return {
        str(item.get("name") or "").strip()
        for item in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    if _has_table(schema, TABLE) and "preview_png" not in _columns(schema, TABLE):
        op.add_column(TABLE, sa.Column("preview_png", sa.LargeBinary(), nullable=True), schema=schema)

    if not _has_table(schema, VERSIONS_TABLE):
        now = sa.func.now()
        op.create_table(
            VERSIONS_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("xml", sa.Text(), nullable=False, server_default=""),
            sa.Column("saved_by_user_id", sa.Integer(), nullable=False),
            sa.Column("saved_by_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_object_netmap_versions"),
            sa.UniqueConstraint("object_id", "version", name="uq_app_it_object_netmap_versions_obj_ver"),
            schema=schema,
        )
        op.create_index(
            "ix_app_it_object_netmap_versions_obj",
            VERSIONS_TABLE,
            ["object_id"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, VERSIONS_TABLE):
        op.drop_table(VERSIONS_TABLE, schema=schema)
    if _has_table(schema, TABLE) and "preview_png" in _columns(schema, TABLE):
        op.drop_column(TABLE, "preview_png", schema=schema)
