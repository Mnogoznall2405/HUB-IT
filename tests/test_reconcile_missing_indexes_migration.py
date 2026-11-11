"""Revision 20261020_0140 adds indexes/unique constraints that the live database lacks (audit B-17).

Unit-level on purpose: a migration cannot be exercised through an HTTP boundary. The tests pin the
production-relevant behaviour: it creates what is missing, is idempotent, never touches duplicate data,
and does nothing when the tables are absent.
"""
from __future__ import annotations

import logging
import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20261020_0140_reconcile_missing_indexes.py"
)


def _run(connection, step: str = "upgrade") -> None:
    namespace = runpy.run_path(str(REVISION))
    function = namespace[step]
    function.__globals__["op"] = Operations(MigrationContext.configure(connection))
    function()


def _legacy_tables(connection) -> None:
    for statement in (
        "CREATE TABLE chat_members (id INTEGER PRIMARY KEY, conversation_id VARCHAR(36), user_id INTEGER, left_at DATETIME)",
        "CREATE TABLE chat_messages (id VARCHAR(36) PRIMARY KEY, conversation_id VARCHAR(36), created_at DATETIME)",
        "CREATE TABLE chat_message_reactions (id INTEGER PRIMARY KEY, message_id VARCHAR(36), user_id INTEGER, emoji VARCHAR(32))",
        "CREATE TABLE ai_bots (id INTEGER PRIMARY KEY, surface VARCHAR(32), placement VARCHAR(32))",
        "CREATE TABLE ai_user_memories (id INTEGER PRIMARY KEY, user_id INTEGER, normalized_hash VARCHAR(64))",
    ):
        connection.execute(sa.text(statement))


def _indexes(connection, table: str) -> dict:
    return {
        item["name"]: (tuple(item["column_names"]), bool(item.get("unique")))
        for item in sa.inspect(connection).get_indexes(table)
    }


def test_creates_the_missing_objects_and_is_idempotent():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        _legacy_tables(connection)
        _run(connection)
        _run(connection)  # second run must change nothing and not fail

        assert _indexes(connection, "chat_members")["ix_chat_members_user_id_left_at_conversation_id"] == (
            ("user_id", "left_at", "conversation_id"), False)
        assert "ix_chat_members_conversation_id_left_at_user_id" in _indexes(connection, "chat_members")
        assert "ix_chat_messages_conversation_id_created_at_id" in _indexes(connection, "chat_messages")
        assert {"ix_app_ai_bots_surface", "ix_app_ai_bots_placement"} <= set(_indexes(connection, "ai_bots"))
        assert _indexes(connection, "chat_message_reactions")["uq_chat_message_reactions_message_user_emoji"] == (
            ("message_id", "user_id", "emoji"), True)
        assert _indexes(connection, "ai_user_memories")["uq_app_ai_user_memories_user_hash"] == (
            ("user_id", "normalized_hash"), True)


def test_duplicates_block_the_unique_constraint_but_not_the_rest(caplog):
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        _legacy_tables(connection)
        for _ in range(2):
            connection.execute(sa.text("INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ('m1', 1, 'x')"))
        with caplog.at_level(logging.WARNING, logger="alembic.runtime.migration"):
            _run(connection)

        assert "uq_chat_message_reactions_message_user_emoji" not in _indexes(connection, "chat_message_reactions")
        assert connection.execute(sa.text("SELECT COUNT(*) FROM chat_message_reactions")).scalar() == 2
        assert "duplicate rows exist" in caplog.text
        assert "ix_chat_messages_conversation_id_created_at_id" in _indexes(connection, "chat_messages")


def test_existing_equivalent_unique_is_not_duplicated():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        _legacy_tables(connection)
        connection.execute(sa.text("CREATE UNIQUE INDEX other_name ON ai_user_memories (user_id, normalized_hash)"))
        _run(connection)

        assert set(_indexes(connection, "ai_user_memories")) == {"other_name"}


def test_missing_tables_are_skipped_and_downgrade_keeps_everything():
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        _run(connection)  # no tables at all: must not raise
        _legacy_tables(connection)
        _run(connection)
        _run(connection, "downgrade")

        assert "ix_chat_messages_conversation_id_created_at_id" in _indexes(connection, "chat_messages")
