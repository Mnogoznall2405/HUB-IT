"""Allow multiple AI conversations for one user and agent.

Revision ID: 20260814_0097
Revises: 20260813_0096
Create Date: 2026-08-14 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260814_0097"
down_revision = "20260813_0096"
branch_labels = None
depends_on = None


TABLE_NAME = "ai_bot_conversations"
OLD_CONSTRAINT = "uq_app_ai_bot_conversations_bot_user"
NEW_INDEX = "ix_app_ai_bot_conversations_user_bot_updated"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None) -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE_NAME, schema=schema)


def _unique_names(schema: str | None) -> set[str]:
    if not _has_table(schema):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_unique_constraints(TABLE_NAME, schema=schema)
    }


def _index_names(schema: str | None) -> set[str]:
    if not _has_table(schema):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(TABLE_NAME, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema):
        return
    if OLD_CONSTRAINT in _unique_names(schema):
        with op.batch_alter_table(TABLE_NAME, schema=schema) as batch_op:
            batch_op.drop_constraint(OLD_CONSTRAINT, type_="unique")
    if NEW_INDEX not in _index_names(schema):
        op.create_index(
            NEW_INDEX,
            TABLE_NAME,
            ["user_id", "bot_id", "updated_at"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema):
        return
    if NEW_INDEX in _index_names(schema):
        op.drop_index(NEW_INDEX, table_name=TABLE_NAME, schema=schema)
    if OLD_CONSTRAINT not in _unique_names(schema):
        with op.batch_alter_table(TABLE_NAME, schema=schema) as batch_op:
            batch_op.create_unique_constraint(OLD_CONSTRAINT, ["bot_id", "user_id"])
