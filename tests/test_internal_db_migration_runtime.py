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


REVISION_CHECKS: list[tuple[str, str]] = []


def _fake_revision_check(engine, database_url, *, scope):
    REVISION_CHECKS.append((database_url, scope))
    return {"status": "current", "current": "x", "expected": "x"}


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
    REVISION_CHECKS.clear()

    def fake_upgrade(database_url, revision="head", *, scope=None):
        calls.append((database_url, revision, scope))

    def fail_create_all(*args, **kwargs):
        pytest.fail("production chat schema init must not use runtime metadata.create_all")

    def fail_runtime_patch(*args, **kwargs):
        pytest.fail("production chat schema init must not use runtime schema patch DDL")

    monkeypatch.setattr(chat_db_module, "get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr(chat_db_module, "_uses_legacy_public_chat_schema", lambda current_engine: legacy_public)
    monkeypatch.setattr(chat_db_module, "upgrade_internal_database", fake_upgrade)
    monkeypatch.setattr(chat_db_module, "check_internal_database_revision", _fake_revision_check)
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


def test_initialize_app_schema_production_postgres_never_applies_migrations(monkeypatch):
    class _FakeDialect:
        name = "postgresql"

    class _FakeEngine:
        dialect = _FakeDialect()

    engine = _FakeEngine()
    calls = {"upgrade": []}
    REVISION_CHECKS.clear()

    def fake_upgrade(database_url, revision="head", *, scope=None):
        calls["upgrade"].append((database_url, revision, scope))

    def fail_create_all(*args, **kwargs):
        pytest.fail("production app schema init must not use runtime metadata.create_all")

    def fail_maintenance(*args, **kwargs):
        pytest.fail("production app schema init must not use runtime maintenance DDL")

    monkeypatch.setattr(app_db_module, "get_app_engine", lambda database_url=None: engine)
    monkeypatch.setattr(app_db_module, "_postgres_has_alembic_version", lambda current_engine: True)
    monkeypatch.setattr("backend.db_migrations.upgrade_internal_database", fake_upgrade)
    monkeypatch.setattr("backend.db_migrations.check_internal_database_revision", _fake_revision_check)
    monkeypatch.setattr(app_db_module.AppBase.metadata, "create_all", fail_create_all)
    monkeypatch.setattr(app_db_module, "_run_postgres_app_schema_maintenance", fail_maintenance)
    monkeypatch.setattr(app_db_module.config.app, "environment", "production", raising=False)

    initialize_app_schema("postgresql://app-prod", force=True)

    # D4-4: production only compares the revision with the code's head; migrations run by command.
    assert calls["upgrade"] == []
    assert REVISION_CHECKS == [("postgresql://app-prod", "app")]


def test_initialize_app_schema_production_postgres_requires_alembic_version(monkeypatch):
    class _FakeDialect:
        name = "postgresql"

    class _FakeEngine:
        dialect = _FakeDialect()

    engine = _FakeEngine()

    monkeypatch.setattr(app_db_module, "get_app_engine", lambda database_url=None: engine)
    monkeypatch.setattr(app_db_module, "_postgres_has_alembic_version", lambda current_engine: False)
    monkeypatch.setattr(
        "backend.db_migrations.upgrade_internal_database",
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
    for name in (
        "_ensure_chat_attachment_preview_table",
        "_ensure_chat_reactions_table",
        "_ensure_chat_mentions_table",
        "_ensure_chat_push_outbox_columns",
    ):
        monkeypatch.setattr(chat_db_module, name, lambda current_engine: None)
    monkeypatch.setattr(chat_db_module.config.app, "environment", "development", raising=False)

    initialize_chat_schema("postgresql://legacy-chat")

    assert calls["upgrade"] == 0
    assert calls["create_all"] == 1
    assert calls["message"] == 1
    assert calls["conversation"] == 1
    assert calls["state"] == 1
    assert calls["attachment"] == 1


def test_legacy_user_state_backfill_zeros_unread_for_inactive_members(monkeypatch):
    executed: list[str] = []

    class _FakeConnection:
        def execute(self, statement):
            executed.append(str(statement))

    class _FakeBegin:
        def __enter__(self):
            return _FakeConnection()

        def __exit__(self, exc_type, exc, traceback):
            return False

    class _FakeEngine(_FakePostgresEngine):
        def begin(self):
            return _FakeBegin()

    inspector = _FakeChatInspector(
        columns_by_table={
            "chat_conversation_user_state": {
                "is_archived",
                "last_read_seq",
                "unread_count",
            },
        },
    )
    monkeypatch.setattr(chat_db_module, "inspect", lambda current_engine: inspector)

    chat_db_module._ensure_chat_user_state_columns(_FakeEngine({CHAT_SCHEMA: None}))

    unread_updates = [statement for statement in executed if "SET unread_count" in statement]
    assert len(unread_updates) == 1
    normalized_sql = " ".join(unread_updates[0].split())
    assert "CASE WHEN EXISTS" in normalized_sql
    assert "chat_members member" in normalized_sql
    assert "member.left_at IS NULL" in normalized_sql
    assert "ELSE 0 END" in normalized_sql


def test_initialize_chat_schema_production_postgres_never_applies_migrations(monkeypatch):
    engine = _FakePostgresEngine()
    inspector = _FakeChatInspector(
        columns_by_table=_complete_chat_columns(),
        indexes_by_table=_complete_chat_indexes(),
    )
    calls = _configure_production_chat_schema_guard(monkeypatch, engine=engine, inspector=inspector)

    initialize_chat_schema("postgresql://chat")

    assert calls == []
    assert REVISION_CHECKS == [("postgresql://chat", "chat")]


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
    for name in ("_ensure_chat_attachment_preview_table", "_ensure_chat_reactions_table", "_ensure_chat_mentions_table"):
        monkeypatch.setattr(chat_db_module, name, lambda current_engine: None)

    initialize_chat_schema("postgresql://legacy-chat")

    assert calls == []
    assert REVISION_CHECKS == [("postgresql://legacy-chat", "chat")]


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


@pytest.mark.unit
def test_chat_schema_template_restores_disabled_chat(tmp_path, monkeypatch):
    import conftest as tests_conftest
    from types import SimpleNamespace

    source_path = tmp_path / "source.db"
    conn = sqlite3.connect(str(source_path))
    conn.close()

    calls: list[str] = []
    captured: dict[str, str] = {}
    monkeypatch.setattr(tests_conftest, "app_schema_template_db", lambda: source_path)
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", False, raising=False)

    def fake_initialize_chat_schema(database_url=None):
        enabled = bool(chat_db_module.config.chat.enabled)
        assert enabled
        captured["url"] = database_url

    def fake_get_chat_engine(database_url=None):
        enabled = bool(chat_db_module.config.chat.enabled)
        assert enabled
        captured["engine_url"] = database_url
        return SimpleNamespace(dispose=lambda: calls.append("disposed"))

    monkeypatch.setattr(chat_db_module, "initialize_chat_schema", fake_initialize_chat_schema)
    monkeypatch.setattr(chat_db_module, "get_chat_engine", fake_get_chat_engine)

    result = tests_conftest.chat_schema_template_db.__wrapped__(
        SimpleNamespace(mktemp=lambda name: tmp_path)
    )

    enabled = bool(chat_db_module.config.chat.enabled)
    expected_url = f"sqlite:///{(tmp_path / 'runtime.db').as_posix()}"
    assert result == tmp_path / "runtime.db"
    assert result.exists()
    assert not enabled
    assert captured["url"] == expected_url
    assert captured["engine_url"] == expected_url
    assert calls == ["disposed"]


@pytest.mark.integration
def test_prebuilt_chat_db_contains_app_and_chat_schema(prebuilt_chat_db):
    conn = sqlite3.connect(str(prebuilt_chat_db))
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert {
            "users",
            "chat_conversations",
            "chat_messages",
            "chat_scheduled_messages",
            "chat_message_mentions",
        } <= tables
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0] == 0
    finally:
        conn.close()


@pytest.mark.integration
@pytest.mark.parametrize("copy_index", [0, 1])
def test_prebuilt_chat_db_does_not_mutate_template(prebuilt_chat_db, chat_schema_template_db, copy_index):
    assert prebuilt_chat_db != chat_schema_template_db
    conn = sqlite3.connect(str(prebuilt_chat_db))
    try:
        conn.execute("CREATE TABLE fixture_only_marker (id INTEGER PRIMARY KEY)")
        conn.execute("INSERT INTO fixture_only_marker (id) VALUES (1)")
        conn.commit()
        assert conn.execute("SELECT id FROM fixture_only_marker").fetchall() == [(1,)]
    finally:
        conn.close()

    template_conn = sqlite3.connect(str(chat_schema_template_db))
    try:
        template_tables = {
            row[0]
            for row in template_conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    finally:
        template_conn.close()
    assert "fixture_only_marker" not in template_tables


@pytest.mark.integration
def test_prebuilt_chat_db_skips_reinitializing_copied_app_schema(prebuilt_chat_db, monkeypatch):
    monkeypatch.setattr(
        app_db_module,
        "_initialize_app_schema_uncached",
        lambda *args, **kwargs: pytest.fail("prebuilt copy must not run schema initialization"),
    )
    initialize_app_schema(f"sqlite:///{prebuilt_chat_db.as_posix()}")


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
