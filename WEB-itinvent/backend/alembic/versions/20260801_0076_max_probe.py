"""max probe chats + media tables

Revision ID: 20260801_0076
Revises: 20260801_0075
Create Date: 2026-08-01 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260801_0076"
down_revision = "20260801_0075"
branch_labels = None
depends_on = None


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

    if not _has_table(schema, "max_probe_chats"):
        op.create_table(
            "max_probe_chats",
            sa.Column("id", sa.String(length=255), nullable=False),
            sa.Column("computer_name", sa.String(length=255), nullable=False),
            sa.Column("windows_user", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("chat_id", sa.String(length=128), nullable=False),
            sa.Column("chat_name", sa.String(length=512), nullable=False),
            sa.Column("messages_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_max_probe_chats"),
            sa.UniqueConstraint(
                "computer_name",
                "chat_id",
                name="uq_app_max_probe_chats_host_chat",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_app_max_probe_chats_updated_at",
            "max_probe_chats",
            ["updated_at"],
            schema=schema,
        )
        op.create_index(
            "ix_app_max_probe_chats_computer",
            "max_probe_chats",
            ["computer_name"],
            schema=schema,
        )

    if not _has_table(schema, "max_probe_media"):
        op.create_table(
            "max_probe_media",
            sa.Column("id", sa.String(length=512), nullable=False),
            sa.Column("computer_name", sa.String(length=255), nullable=False),
            sa.Column("file_name", sa.String(length=512), nullable=False),
            sa.Column("content", sa.LargeBinary(), nullable=True),
            sa.Column(
                "content_type",
                sa.String(length=128),
                nullable=False,
                server_default="application/octet-stream",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_max_probe_media"),
            sa.UniqueConstraint(
                "computer_name",
                "file_name",
                name="uq_app_max_probe_media_host_file",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_app_max_probe_media_computer",
            "max_probe_media",
            ["computer_name"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table in ("max_probe_media", "max_probe_chats"):
        if _has_table(schema, table):
            op.drop_table(table, schema=schema)
