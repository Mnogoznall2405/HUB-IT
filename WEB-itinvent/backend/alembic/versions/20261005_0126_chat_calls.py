"""Add chat_calls and chat_call_participants (voice/video calls on LiveKit).

Revision ID: 20261005_0126
Revises: 20261002_0125

The tables are created in the schema where the chat tables really live (logical ``chat`` schema, or
``public`` on the legacy PostgreSQL runtime). Per the rule introduced by 20261002_0125 the DDL is NOT
skipped by ``itinvent_scope``: it is skipped only when the database has no chat tables at all. Every
object is created "if it is missing", so a partially applied or repeated run is harmless.

Not applied on production by the code change: calls stay off (CALLS_ENABLED=false) until this migration
is run explicitly at release time.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261005_0126"
down_revision = "20261002_0125"
branch_labels = None
depends_on = None

CALLS = "chat_calls"
PARTICIPANTS = "chat_call_participants"
OPEN_CALL_INDEX = "uq_chat_calls_one_open_per_conversation"


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(schema: str | None, table_name: str) -> set[str]:
    return {str(item.get("name")) for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)}


def _chat_conversations_schema() -> tuple[bool, str | None]:
    """(chat tables are in this database, schema they live in)."""
    chat_schema = _schema("chat")
    if _has_table(chat_schema, "chat_conversations"):
        return True, chat_schema
    if _has_table(None, "chat_conversations"):
        return True, None
    return False, chat_schema


def _ensure_index(schema: str | None, table_name: str, name: str, columns: list[str], **kwargs) -> None:
    if name not in _index_names(schema, table_name):
        op.create_index(name, table_name, columns, schema=schema, **kwargs)


def upgrade() -> None:
    present, schema = _chat_conversations_schema()
    if not present:
        return
    prefix = f"{schema}." if schema else ""

    if not _has_table(schema, CALLS):
        op.create_table(
            CALLS,
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("conversation_id", sa.String(36), nullable=False),
            sa.Column("conversation_kind", sa.String(20), nullable=False, server_default="direct"),
            sa.Column("media", sa.String(8), nullable=False, server_default="audio"),
            sa.Column("status", sa.String(16), nullable=False, server_default="ringing"),
            sa.Column("initiator_user_id", sa.Integer(), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("end_reason", sa.String(16), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["conversation_id"], [f"{prefix}chat_conversations.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
    _ensure_index(schema, CALLS, "ix_chat_calls_conversation_id", ["conversation_id"])
    _ensure_index(schema, CALLS, "ix_chat_calls_status_started_at", ["status", "started_at"])
    _ensure_index(
        schema,
        CALLS,
        OPEN_CALL_INDEX,
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("status <> 'ended'"),
        sqlite_where=sa.text("status <> 'ended'"),
    )

    if not _has_table(schema, PARTICIPANTS):
        op.create_table(
            PARTICIPANTS,
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("call_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("state", sa.String(16), nullable=False, server_default="invited"),
            sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["call_id"], [f"{prefix}chat_calls.id"], ondelete="CASCADE"),
            sa.UniqueConstraint("call_id", "user_id", name="uq_chat_call_participants_call_user"),
            schema=schema,
        )
    _ensure_index(schema, PARTICIPANTS, "ix_chat_call_participants_call_id", ["call_id"])
    _ensure_index(schema, PARTICIPANTS, "ix_chat_call_participants_user_state", ["user_id", "state"])


def downgrade() -> None:
    present, schema = _chat_conversations_schema()
    if not present:
        return
    # Dropping a table drops its indexes; the participants go first (FK to chat_calls).
    if _has_table(schema, PARTICIPANTS):
        op.drop_table(PARTICIPANTS, schema=schema)
    if _has_table(schema, CALLS):
        op.drop_table(CALLS, schema=schema)
