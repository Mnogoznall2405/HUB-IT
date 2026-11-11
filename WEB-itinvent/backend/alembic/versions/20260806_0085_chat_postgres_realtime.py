"""Add PostgreSQL realtime relay and distributed presence tables.

Revision ID: 20260806_0085
Revises: 20260806_0084
Create Date: 2026-08-06 17:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260806_0085"
down_revision = "20260806_0084"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _enabled() -> bool:
    return _scope() != "app" and op.get_bind().dialect.name == "postgresql"


def _schema() -> str:
    return "chat"


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=_schema())


def _has_index(table_name: str, index_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return index_name in {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=_schema())
    }


def upgrade() -> None:
    if not _enabled():
        return
    schema = _schema()
    relay_table = "chat_realtime_events"
    if not _has_table(relay_table):
        op.create_table(
            relay_table,
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("origin_node_id", sa.String(length=128), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    if not _has_index(relay_table, "ix_chat_realtime_events_expires_at"):
        op.create_index(
            "ix_chat_realtime_events_expires_at",
            relay_table,
            ["expires_at"],
            unique=False,
            schema=schema,
        )

    presence_table = "chat_realtime_presence"
    if not _has_table(presence_table):
        op.create_table(
            presence_table,
            sa.Column("node_id", sa.String(length=128), nullable=False),
            sa.Column("connection_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column(
                "touched_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("node_id", "connection_id"),
            schema=schema,
        )
    if not _has_index(presence_table, "ix_chat_realtime_presence_user_expires"):
        op.create_index(
            "ix_chat_realtime_presence_user_expires",
            presence_table,
            ["user_id", "expires_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if not _enabled():
        return
    schema = _schema()
    presence_table = "chat_realtime_presence"
    if _has_index(presence_table, "ix_chat_realtime_presence_user_expires"):
        op.drop_index(
            "ix_chat_realtime_presence_user_expires",
            table_name=presence_table,
            schema=schema,
        )
    if _has_table(presence_table):
        op.drop_table(presence_table, schema=schema)

    relay_table = "chat_realtime_events"
    if _has_index(relay_table, "ix_chat_realtime_events_expires_at"):
        op.drop_index(
            "ix_chat_realtime_events_expires_at",
            table_name=relay_table,
            schema=schema,
        )
    if _has_table(relay_table):
        op.drop_table(relay_table, schema=schema)
