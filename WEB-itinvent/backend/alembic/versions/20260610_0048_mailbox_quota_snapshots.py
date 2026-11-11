"""mailbox quota snapshots

Revision ID: 20260610_0048
Revises: 20260609_0047
Create Date: 2026-06-10 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260610_0048"
down_revision = "20260609_0047"
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

    if not _has_table(app_schema, "mailbox_quota_snapshots"):
        op.create_table(
            "mailbox_quota_snapshots",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("collected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("source_host", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("exchange_server", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("payload_sha256", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    _create_index_if_missing(
        "ix_app_mailbox_quota_snapshots_imported_at",
        "mailbox_quota_snapshots",
        ["imported_at"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_mailbox_quota_snapshots_payload_sha256",
        "mailbox_quota_snapshots",
        ["payload_sha256"],
        schema=app_schema,
    )

    if not _has_table(app_schema, "mailbox_quota_rows"):
        op.create_table(
            "mailbox_quota_rows",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("snapshot_id", sa.Integer(), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False, server_default=""),
            sa.Column("display_name", sa.String(length=512), nullable=False, server_default=""),
            sa.Column("upn", sa.String(length=320), nullable=False, server_default=""),
            sa.Column("mailbox_type", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("used_bytes", sa.BigInteger(), nullable=True),
            sa.Column("quota_bytes", sa.BigInteger(), nullable=True),
            sa.Column("free_bytes", sa.BigInteger(), nullable=True),
            sa.Column("used_percent", sa.Float(), nullable=True),
            sa.Column("database_name", sa.String(length=255), nullable=False, server_default=""),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    _create_index_if_missing(
        "ix_app_mailbox_quota_rows_snapshot_id",
        "mailbox_quota_rows",
        ["snapshot_id"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_mailbox_quota_rows_snapshot_email",
        "mailbox_quota_rows",
        ["snapshot_id", "email"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_mailbox_quota_rows_snapshot_used_percent",
        "mailbox_quota_rows",
        ["snapshot_id", "used_percent"],
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if _has_table(app_schema, "mailbox_quota_rows"):
        op.drop_table("mailbox_quota_rows", schema=app_schema)
    if _has_table(app_schema, "mailbox_quota_snapshots"):
        op.drop_table("mailbox_quota_snapshots", schema=app_schema)
