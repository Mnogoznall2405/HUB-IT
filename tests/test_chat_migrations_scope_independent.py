"""Chat migrations decide by what exists in the database, never by ``itinvent_scope`` (AGENTS.md).

Before, 21 chat revisions returned early for scope ``app`` yet the revision was still stamped, so a
database migrated that way silently diverged from its history. Unit-level on purpose: migrations
cannot be exercised through an HTTP boundary.
"""
from __future__ import annotations

import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

VERSIONS = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "alembic" / "versions"
CHAT_REVISIONS = sorted(
    path for path in VERSIONS.glob("*.py") if "_chat_tables_present" in path.read_text(encoding="utf-8-sig")
)


def _load(path: Path, connection, scope: str) -> dict:
    namespace = runpy.run_path(str(path))
    operations = Operations(MigrationContext.configure(connection))
    for value in list(namespace.values()):
        globals_ = getattr(value, "__globals__", None)
        if globals_ is namespace or (globals_ is not None and globals_.get("__file__") == str(path)):
            globals_["op"] = operations
            if "_scope" in globals_:
                globals_["_scope"] = lambda: scope
    return namespace


def test_all_twenty_one_gated_revisions_are_covered():
    assert len(CHAT_REVISIONS) == 21


@pytest.mark.parametrize("path", CHAT_REVISIONS, ids=lambda path: path.name[:13])
@pytest.mark.parametrize("step", ["upgrade", "downgrade"])
def test_database_without_chat_tables_is_left_alone_in_any_scope(path, step):
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        namespace = _load(path, connection, scope="app")

        namespace[step]()

        assert sa.inspect(connection).get_table_names() == []


@pytest.mark.parametrize("scope", ["app", "chat", "all"])
def test_muted_until_is_added_when_chat_tables_exist_whatever_the_scope(scope):
    path = next(item for item in CHAT_REVISIONS if "0122_chat_muted_until" in item.name)
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE chat_conversation_user_state (conversation_id VARCHAR(36), user_id INTEGER)"
        )
        namespace = _load(path, connection, scope=scope)

        namespace["upgrade"]()

        columns = {item["name"] for item in sa.inspect(connection).get_columns("chat_conversation_user_state")}
        assert "muted_until" in columns


@pytest.mark.parametrize("scope", ["app", "chat", "all"])
def test_scheduled_messages_table_is_created_when_chat_tables_exist_whatever_the_scope(scope):
    path = next(item for item in CHAT_REVISIONS if "0124_chat_scheduled_messages" in item.name)
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE chat_messages (id VARCHAR(36) PRIMARY KEY)")
        namespace = _load(path, connection, scope=scope)

        namespace["upgrade"]()

        assert sa.inspect(connection).has_table("chat_scheduled_messages")
