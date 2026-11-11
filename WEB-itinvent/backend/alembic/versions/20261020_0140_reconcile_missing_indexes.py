"""Add the indexes and unique constraints that exist in the models but are absent from the live database.

Revision ID: 20261020_0140
Revises: 20261020_0139

A read-only comparison of the ORM models with `pg_indexes`/`pg_constraint` of the production database
(audit B-17) found that the following were never created there, although earlier revisions define them:

* `chat_members` (`ix_chat_members_user_id_left_at_conversation_id`,
  `ix_chat_members_conversation_id_left_at_user_id`) and `chat_messages`
  (`ix_chat_messages_conversation_id_created_at_id`): revision 20260406_0015 skipped them on a
  database that keeps the chat tables in the legacy `public` schema;
* `ai_bots` (`ix_app_ai_bots_surface`, `ix_app_ai_bots_placement`);
* unique `(message_id, user_id, emoji)` on `chat_message_reactions` and unique `(user_id, normalized_hash)`
  on `ai_user_memories` (the tables were created by development DDL without the constraint).

Every step is "create if missing" and never looks at `itinvent_scope`: it inspects the real tables. A
table that does not exist is skipped; an index with the same name, or (for the unique cases) any unique
constraint/index over the same columns, counts as present. A unique constraint is created only when the
table holds no duplicates, otherwise it is skipped with a warning (the data is never changed here).

The affected tables are small (tens of thousands of rows at most), so plain `CREATE INDEX` is used.
Downgrade is a no-op: the objects may predate this revision and are harmless to keep.
"""
from __future__ import annotations

import logging

from alembic import op
import sqlalchemy as sa


revision = "20261020_0140"
down_revision = "20261020_0139"
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")

# (table, name, columns); chat tables live in schema `chat` or in the legacy `public`/default schema.
CHAT_INDEXES = (
    ("chat_members", "ix_chat_members_user_id_left_at_conversation_id", ("user_id", "left_at", "conversation_id")),
    ("chat_members", "ix_chat_members_conversation_id_left_at_user_id", ("conversation_id", "left_at", "user_id")),
    ("chat_messages", "ix_chat_messages_conversation_id_created_at_id", ("conversation_id", "created_at", "id")),
)
APP_INDEXES = (
    ("ai_bots", "ix_app_ai_bots_surface", ("surface",)),
    ("ai_bots", "ix_app_ai_bots_placement", ("placement",)),
)
CHAT_UNIQUES = (
    ("chat_message_reactions", "uq_chat_message_reactions_message_user_emoji", ("message_id", "user_id", "emoji")),
)
APP_UNIQUES = (
    ("ai_user_memories", "uq_app_ai_user_memories_user_hash", ("user_id", "normalized_hash")),
)


def _find_schema(inspector, table: str, candidates: tuple) -> tuple[bool, str | None]:
    for schema in candidates:
        if inspector.has_table(table, schema=schema):
            return True, schema
    return False, None


def _chat_candidates(dialect: str) -> tuple:
    return ("chat", None) if dialect == "postgresql" else (None,)


def _app_candidates(dialect: str) -> tuple:
    return ("app",) if dialect == "postgresql" else (None,)


def _index_names(inspector, table: str, schema: str | None) -> set[str]:
    return {str(item["name"]) for item in inspector.get_indexes(table, schema=schema)}


def _has_unique_over(inspector, table: str, schema: str | None, columns: tuple) -> bool:
    wanted = set(columns)
    for item in inspector.get_unique_constraints(table, schema=schema):
        if set(item["column_names"]) == wanted:
            return True
    for item in inspector.get_indexes(table, schema=schema):
        if item.get("unique") and set(item["column_names"]) == wanted:
            return True
    return False


def _has_duplicates(bind, table: str, schema: str | None, columns: tuple) -> bool:
    qualified = f'"{schema}"."{table}"' if schema else f'"{table}"'
    cols = ", ".join(f'"{name}"' for name in columns)
    row = bind.execute(
        sa.text(f"SELECT 1 FROM {qualified} GROUP BY {cols} HAVING COUNT(*) > 1 LIMIT 1")
    ).first()
    return row is not None


def _add_indexes(bind, specs: tuple, candidates: tuple) -> None:
    for table, name, columns in specs:
        inspector = sa.inspect(bind)
        found, schema = _find_schema(inspector, table, candidates)
        if not found:
            continue
        if name in _index_names(inspector, table, schema):
            continue
        op.create_index(name, table, list(columns), unique=False, schema=schema)


def _add_uniques(bind, specs: tuple, candidates: tuple) -> None:
    for table, name, columns in specs:
        inspector = sa.inspect(bind)
        found, schema = _find_schema(inspector, table, candidates)
        if not found or _has_unique_over(inspector, table, schema, columns):
            continue
        if _has_duplicates(bind, table, schema, columns):
            logger.warning(
                "reconcile_missing_indexes skipped unique %s on %s: duplicate rows exist, resolve them first",
                name,
                table,
            )
            continue
        if bind.dialect.name == "postgresql":
            op.create_unique_constraint(name, table, list(columns), schema=schema)
        else:
            op.create_index(name, table, list(columns), unique=True, schema=schema)


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    _add_indexes(bind, CHAT_INDEXES, _chat_candidates(dialect))
    _add_indexes(bind, APP_INDEXES, _app_candidates(dialect))
    _add_uniques(bind, CHAT_UNIQUES, _chat_candidates(dialect))
    _add_uniques(bind, APP_UNIQUES, _app_candidates(dialect))


def downgrade() -> None:
    # Intentionally a no-op: see the module docstring (the objects may predate this revision).
    return
