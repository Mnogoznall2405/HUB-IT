from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb import db as app_db_module
from backend.appdb.db import AppDatabaseConfigurationError, initialize_app_schema
from backend.chat import db as chat_db_module
from backend.chat.db import CHAT_SCHEMA, get_chat_database_url, initialize_chat_schema


class _FakePostgresDialect:
    name = "postgresql"


class _FakePostgresEngine:
    dialect = _FakePostgresDialect()

    def __init__(self, execution_options: dict | None = None) -> None:
        self._execution_options = execution_options or {}

    def get_execution_options(self) -> dict:
        return self._execution_options


class _FakeChatInspector:
    def __init__(
        self,
        *,
        columns_by_table: dict[str, set[str]],
        indexes_by_table: dict[str, set[str]] | None = None,
    ) -> None:
        self._columns_by_table = columns_by_table
        self._indexes_by_table = indexes_by_table or {}

    def has_table(self, table_name: str, *, schema: str | None = None) -> bool:
        return table_name in self._columns_by_table

    def get_columns(self, table_name: str, *, schema: str | None = None) -> list[dict[str, str]]:
        return [{"name": column_name} for column_name in self._columns_by_table.get(table_name, set())]

    def get_indexes(self, table_name: str, *, schema: str | None = None) -> list[dict[str, str]]:
        return [{"name": index_name} for index_name in self._indexes_by_table.get(table_name, set())]


def _complete_chat_columns() -> dict[str, set[str]]:
    return {
        table_name: set(columns)
        for table_name, columns in chat_db_module._CHAT_REQUIRED_COLUMNS.items()
    }


def _complete_chat_indexes() -> dict[str, set[str]]:
    return {
        table_name: {sorted(aliases)[0] for aliases in required_indexes.values()}
        for table_name, required_indexes in chat_db_module._CHAT_REQUIRED_INDEX_ALIASES.items()
    }


def _configure_production_chat_schema_guard(
    monkeypatch,
    *,
    engine: _FakePostgresEngine,
    inspector: _FakeChatInspector,
    legacy_public: bool = False,
) -> list[tuple[str, str, str | None]]:
    calls: list[tuple[str, str, str | None]] = []

    def fake_upgrade(database_url, revision="head", *, scope=None):
        calls.append((database_url, revision, scope))

    def fail_create_all(*args, **kwargs):
        pytest.fail("production chat schema init must not use runtime metadata.create_all")

    def fail_runtime_patch(*args, **kwargs):
        pytest.fail("production chat schema init must not use runtime schema patch DDL")

    monkeypatch.setattr(chat_db_module, "get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr(chat_db_module, "_uses_legacy_public_chat_schema", lambda current_engine: legacy_public)
    monkeypatch.setattr(chat_db_module, "upgrade_internal_database", fake_upgrade)
    monkeypatch.setattr(chat_db_module, "inspect", lambda current_engine: inspector)
    monkeypatch.setattr(chat_db_module.Base.metadata, "create_all", fail_create_all)
    monkeypatch.setattr(chat_db_module, "_ensure_chat_message_columns", fail_runtime_patch)
    monkeypatch.setattr(chat_db_module, "_ensure_chat_conversation_columns", fail_runtime_patch)
    monkeypatch.setattr(chat_db_module, "_ensure_chat_user_state_columns", fail_runtime_patch)
    monkeypatch.setattr(chat_db_module, "_ensure_chat_attachment_columns", fail_runtime_patch)
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.app, "environment", "production", raising=False)
    return calls


def test_chat_database_url_falls_back_to_app_database(monkeypatch):
    fallback_url = "sqlite:///fallback-chat.db"

    monkeypatch.setattr("backend.chat.db.config.chat.enabled", True, raising=False)
    monkeypatch.setattr("backend.chat.db.config.chat.database_url", None, raising=False)
    monkeypatch.setattr("backend.chat.db.config.app_db.database_url", fallback_url, raising=False)

    assert get_chat_database_url() == fallback_url


def test_initialize_app_schema_creates_sqlite_tables(temp_dir):
    database_path = Path(temp_dir) / "app_schema.db"
    database_url = f"sqlite:///{database_path.as_posix()}"

    initialize_app_schema(database_url)

    conn = sqlite3.connect(str(database_path))
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    conn.close()

    tables = {row[0] for row in rows}
    assert "users" in tables
    assert "sessions" in tables
    assert "user_settings" in tables
    assert "vcs_computers" in tables
    assert "ad_user_branch_overrides" in tables
    assert "inventory_hosts" in tables
    assert "inventory_change_events" in tables
    assert "json_documents" in tables
    assert "json_records" in tables


def test_initialize_app_schema_production_postgres_uses_migration_only(monkeypatch):
    class _FakeDialect:
        name = "postgresql"

    class _FakeEngine:
        dialect = _FakeDialect()

    engine = _FakeEngine()
    calls = {"upgrade": []}

    def fake_upgrade(database_url, revision="head", *, scope=None):
        calls["upgrade"].append((database_url, revision, scope))

    def fail_create_all(*args, **kwargs):
        pytest.fail("production app schema init must not use runtime metadata.create_all")

    def fail_maintenance(*args, **kwargs):
        pytest.fail("production app schema init must not use runtime maintenance DDL")

    monkeypatch.setattr(app_db_module, "get_app_engine", lambda database_url=None: engine)
    monkeypatch.setattr(app_db_module, "_postgres_has_alembic_version", lambda current_engine: True)
    monkeypatch.setattr(app_db_module, "upgrade_internal_database", fake_upgrade)
    monkeypatch.setattr(app_db_module.AppBase.metadata, "create_all", fail_create_all)
    monkeypatch.setattr(app_db_module, "_run_postgres_app_schema_maintenance", fail_maintenance)
    monkeypatch.setattr(app_db_module.config.app, "environment", "production", raising=False)

    initialize_app_schema("postgresql://app-prod", force=True)

    assert calls["upgrade"] == [("postgresql://app-prod", "head", "app")]


def test_initialize_app_schema_production_postgres_requires_alembic_version(monkeypatch):
    class _FakeDialect:
        name = "postgresql"

    class _FakeEngine:
        dialect = _FakeDialect()

    engine = _FakeEngine()

    monkeypatch.setattr(app_db_module, "get_app_engine", lambda database_url=None: engine)
    monkeypatch.setattr(app_db_module, "_postgres_has_alembic_version", lambda current_engine: False)
    monkeypatch.setattr(
        app_db_module,
        "upgrade_internal_database",
        lambda *args, **kwargs: pytest.fail("must not run migrations before Alembic state exists"),
    )
    monkeypatch.setattr(
        app_db_module.AppBase.metadata,
        "create_all",
        lambda *args, **kwargs: pytest.fail("must not create schema at production startup"),
    )
    monkeypatch.setattr(app_db_module.config.app, "environment", "production", raising=False)

    with pytest.raises(AppDatabaseConfigurationError, match="Alembic-initialized"):
        initialize_app_schema("postgresql://app-prod-uninitialized", force=True)


def test_initialize_chat_schema_creates_sqlite_tables(temp_dir, monkeypatch):
    database_path = Path(temp_dir) / "chat_schema.db"
    database_url = f"sqlite:///{database_path.as_posix()}"

    monkeypatch.setattr("backend.chat.db.config.chat.enabled", True, raising=False)

    initialize_chat_schema(database_url)

    conn = sqlite3.connect(str(database_path))
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    conn.close()

    tables = {row[0] for row in rows}
    assert "chat_conversations" in tables
    assert "chat_messages" in tables
    assert "chat_push_subscriptions" in tables


def test_initialize_chat_schema_uses_legacy_public_postgres_tables(monkeypatch):
    class _FakeDialect:
        name = "postgresql"

    class _FakeEngine:
        dialect = _FakeDialect()

        @staticmethod
        def get_execution_options():
            return {"schema_translate_map": {CHAT_SCHEMA: None}}

    engine = _FakeEngine()
    calls = {"upgrade": 0, "create_all": 0, "message": 0, "conversation": 0, "state": 0, "attachment": 0}

    monkeypatch.setattr("backend.chat.db.get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr("backend.chat.db.upgrade_internal_database", lambda database_url, revision='head': calls.__setitem__("upgrade", calls["upgrade"] + 1))
    monkeypatch.setattr(chat_db_module.Base.metadata, "create_all", lambda *args, **kwargs: calls.__setitem__("create_all", calls["create_all"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_message_columns", lambda current_engine: calls.__setitem__("message", calls["message"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_conversation_columns", lambda current_engine: calls.__setitem__("conversation", calls["conversation"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_user_state_columns", lambda current_engine: calls.__setitem__("state", calls["state"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_attachment_columns", lambda current_engine: calls.__setitem__("attachment", calls["attachment"] + 1))
    monkeypatch.setattr(chat_db_module.config.app, "environment", "development", raising=False)

    initialize_chat_schema("postgresql://legacy-chat")

    assert calls["upgrade"] == 0
    assert calls["create_all"] == 1
    assert calls["message"] == 1
    assert calls["conversation"] == 1
    assert calls["state"] == 1
    assert calls["attachment"] == 1


def test_initialize_chat_schema_production_postgres_uses_migration_only(monkeypatch):
    engine = _FakePostgresEngine()
    inspector = _FakeChatInspector(
        columns_by_table=_complete_chat_columns(),
        indexes_by_table=_complete_chat_indexes(),
    )
    calls = _configure_production_chat_schema_guard(monkeypatch, engine=engine, inspector=inspector)

    initialize_chat_schema("postgresql://chat")

    assert calls == [("postgresql://chat", "head", "chat")]


def test_initialize_chat_schema_production_legacy_public_postgres_verifies_schema(monkeypatch):
    engine = _FakePostgresEngine({CHAT_SCHEMA: None})
    inspector = _FakeChatInspector(
        columns_by_table=_complete_chat_columns(),
        indexes_by_table=_complete_chat_indexes(),
    )
    calls = _configure_production_chat_schema_guard(
        monkeypatch,
        engine=engine,
        inspector=inspector,
        legacy_public=True,
    )

    initialize_chat_schema("postgresql://legacy-chat")

    assert calls == []


def test_initialize_chat_schema_production_postgres_rejects_missing_column(monkeypatch):
    columns_by_table = _complete_chat_columns()
    columns_by_table["chat_messages"].remove("body_format")
    engine = _FakePostgresEngine()
    inspector = _FakeChatInspector(
        columns_by_table=columns_by_table,
        indexes_by_table=_complete_chat_indexes(),
    )
    _configure_production_chat_schema_guard(monkeypatch, engine=engine, inspector=inspector)

    with pytest.raises(chat_db_module.ChatSchemaConfigurationError, match="chat_messages.body_format"):
        initialize_chat_schema("postgresql://chat")


def test_initialize_chat_schema_production_postgres_rejects_missing_index(monkeypatch):
    indexes_by_table = _complete_chat_indexes()
    indexes_by_table["chat_messages"].remove(sorted(chat_db_module._CHAT_REQUIRED_INDEX_ALIASES["chat_messages"]["body_format"])[0])
    engine = _FakePostgresEngine()
    inspector = _FakeChatInspector(
        columns_by_table=_complete_chat_columns(),
        indexes_by_table=indexes_by_table,
    )
    _configure_production_chat_schema_guard(monkeypatch, engine=engine, inspector=inspector)

    with pytest.raises(chat_db_module.ChatSchemaConfigurationError, match="chat_messages.body_format"):
        initialize_chat_schema("postgresql://chat")
