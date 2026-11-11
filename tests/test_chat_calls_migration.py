"""Alembic 20261005_0126 (chat_calls, chat_call_participants) on an empty sqlite database.

Migrations are one of the cases where unit-level tests are justified (AGENTS.md): production applies them
only by an explicit command, so a defect is found at release time unless it is proven here first.
Only sqlite files in tmp_path are used.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.script import ScriptDirectory

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

PARENT = "20261002_0125"
REVISION = "20261005_0126"
TABLES = ("chat_calls", "chat_call_participants")


def _sqlite(tmp_path, *, with_conversations=True, scope="chat"):
    build = importlib.import_module("backend.db_migrations").build_alembic_config
    url = f"sqlite:///{(tmp_path / 'mig126.db').as_posix()}"
    engine = sa.create_engine(url)
    if with_conversations:
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)"))
    return engine, build(url, scope=scope)


def _insert_call(connection, call_id, conversation_id, status):
    connection.execute(
        sa.text(
            "INSERT INTO chat_calls (id, conversation_id, initiator_user_id, status) "
            "VALUES (:id, :conv, 1, :status)"
        ),
        {"id": call_id, "conv": conversation_id, "status": status},
    )


@pytest.mark.parametrize("scope", ["chat", "app"])
def test_upgrade_creates_tables_and_one_open_call_per_conversation(tmp_path, scope):
    engine, cfg = _sqlite(tmp_path, scope=scope)  # the scope must not skip the DDL (rule of 20261002_0125)
    command.stamp(cfg, PARENT)
    command.upgrade(cfg, REVISION)
    inspector = sa.inspect(engine)
    for table in TABLES:
        assert inspector.has_table(table)
    assert {col["name"] for col in inspector.get_columns("chat_calls")} >= {
        "id", "conversation_id", "media", "status", "initiator_user_id", "started_at", "answered_at",
        "ended_at", "end_reason",
    }
    assert inspector.get_foreign_keys("chat_call_participants")[0]["referred_table"] == "chat_calls"

    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO chat_conversations (id) VALUES ('c1'), ('c2')"))
        _insert_call(connection, "a", "c1", "ringing")
        _insert_call(connection, "old", "c1", "ended")  # ended calls do not count
        _insert_call(connection, "other", "c2", "active")
    with pytest.raises(sa.exc.IntegrityError):  # a second open call in the same conversation
        with engine.begin() as connection:
            _insert_call(connection, "b", "c1", "active")
    with engine.begin() as connection:
        connection.execute(sa.text("UPDATE chat_calls SET status = 'ended' WHERE id = 'a'"))
        _insert_call(connection, "b", "c1", "ringing")  # free again once the first one ended
    with pytest.raises(sa.exc.IntegrityError):  # one row per (call, user)
        with engine.begin() as connection:
            for _ in range(2):
                connection.execute(sa.text("INSERT INTO chat_call_participants (call_id, user_id) VALUES ('b', 7)"))


def test_migrated_schema_matches_the_orm_models(tmp_path):
    """The ORM (used by tests and dev create_all) and the migration (production) must not drift apart."""
    models = importlib.import_module("backend.chat.models")
    engine, cfg = _sqlite(tmp_path)
    command.stamp(cfg, PARENT)
    command.upgrade(cfg, REVISION)
    inspector = sa.inspect(engine)
    for model in (models.ChatCall, models.ChatCallParticipant):
        table = model.__table__
        migrated = {col["name"]: col for col in inspector.get_columns(table.name)}
        assert set(migrated) == {col.name for col in table.columns}, table.name
        for column in table.columns:
            assert migrated[column.name]["nullable"] == column.nullable, (table.name, column.name)
        # Compared by columns/uniqueness: SQLAlchemy names the ORM's implicit indexes ix_chat_<table>_<col>
        # because of the logical "chat" schema, the migration uses the plain ix_<table>_<col> names.
        orm_indexes = {(tuple(col.name for col in index.columns), bool(index.unique)) for index in table.indexes}
        migrated_indexes = {
            (tuple(item["column_names"]), bool(item["unique"])) for item in inspector.get_indexes(table.name)
        }
        assert orm_indexes <= migrated_indexes, table.name


def test_upgrade_is_idempotent_when_objects_already_exist(tmp_path):
    """Version recorded at the parent but the tables are already there (ORM create_all, partial run)."""
    models = importlib.import_module("backend.chat.models")
    engine, cfg = _sqlite(tmp_path)
    models.Base.metadata.create_all(
        engine.execution_options(schema_translate_map={"chat": None}),  # same mapping the sqlite runtime uses
        tables=[models.ChatCall.__table__, models.ChatCallParticipant.__table__], checkfirst=True
    )  # the FK target chat_conversations is the minimal hand-made table above
    command.stamp(cfg, PARENT)
    command.upgrade(cfg, REVISION)  # must not fail on "already exists"
    for table in TABLES:
        assert sa.inspect(engine).has_table(table)


def test_downgrade_drops_only_the_call_tables(tmp_path):
    engine, cfg = _sqlite(tmp_path)
    command.stamp(cfg, PARENT)
    command.upgrade(cfg, REVISION)
    command.downgrade(cfg, PARENT)
    inspector = sa.inspect(engine)
    assert not any(inspector.has_table(table) for table in TABLES)
    assert inspector.has_table("chat_conversations")
    command.upgrade(cfg, REVISION)  # and it can be applied again
    assert sa.inspect(engine).has_table("chat_calls")


def test_database_without_chat_tables_is_left_alone(tmp_path):
    engine, cfg = _sqlite(tmp_path, with_conversations=False, scope="app")
    command.stamp(cfg, PARENT)
    command.upgrade(cfg, "head")
    assert not any(sa.inspect(engine).has_table(table) for table in TABLES)


def test_calls_revision_is_an_ancestor_of_the_single_head():
    build = importlib.import_module("backend.db_migrations").build_alembic_config
    script = ScriptDirectory.from_config(build("sqlite:///unused.db"))
    heads = script.get_heads()
    assert len(heads) == 1  # no branches
    assert REVISION in {revision.revision for revision in script.walk_revisions(base="base", head=heads[0])}
