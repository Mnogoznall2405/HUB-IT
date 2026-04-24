from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.db import initialize_app_schema
from backend.chat.db import CHAT_SCHEMA, get_chat_database_url, initialize_chat_schema


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
    calls = {"upgrade": 0, "message": 0, "state": 0}

    monkeypatch.setattr("backend.chat.db.get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr("backend.chat.db.upgrade_internal_database", lambda database_url, revision='head': calls.__setitem__("upgrade", calls["upgrade"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_message_columns", lambda current_engine: calls.__setitem__("message", calls["message"] + 1))
    monkeypatch.setattr("backend.chat.db._ensure_chat_user_state_columns", lambda current_engine: calls.__setitem__("state", calls["state"] + 1))

    initialize_chat_schema("postgresql://legacy-chat")

    assert calls["upgrade"] == 0
    assert calls["message"] == 1
    assert calls["state"] == 1
