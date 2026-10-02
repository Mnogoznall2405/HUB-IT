"""D4-4: production start-up only compares alembic_version with the code's head."""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend import db_migrations
from backend.appdb import db as app_db_module
from backend.chat import db as chat_db_module


def _sqlite(tmp_path, version: str | None):
    url = f"sqlite:///{(tmp_path / 'rev.db').as_posix()}"
    engine = create_engine(url)
    if version is not None:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
            connection.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": version})
    return engine, url


def _head(url: str) -> str:
    return ",".join(sorted(ScriptDirectory.from_config(db_migrations.build_alembic_config(url)).get_heads()))


def _all_revisions(url: str) -> list[str]:
    script = ScriptDirectory.from_config(db_migrations.build_alembic_config(url))
    return [revision.revision for revision in script.walk_revisions()]  # newest first


def test_current_revision_is_silent(tmp_path, caplog):
    engine, url = _sqlite(tmp_path, None)
    engine, url = _sqlite(tmp_path, _head(url))
    with caplog.at_level(logging.WARNING, logger="backend.db_migrations"):
        result = db_migrations.check_internal_database_revision(engine, url, scope="app")
    assert result["status"] == "current"
    assert result["current"] == result["expected"] == _head(url)
    assert caplog.records == []


def test_behind_revision_logs_structured_warning(tmp_path, caplog):
    _, url = _sqlite(tmp_path, None)
    older = _all_revisions(url)[1]
    engine, url = _sqlite(tmp_path, older)
    with caplog.at_level(logging.WARNING, logger="backend.db_migrations"):
        result = db_migrations.check_internal_database_revision(engine, url, scope="chat")
    assert result == {"status": "behind", "current": older, "expected": _head(url)}
    record = caplog.records[-1]
    assert record.stage == "schema_migration_check"
    assert (record.scope, record.status) == ("chat", "behind")
    assert record.current_revision == older and record.expected_revision == _head(url)


def test_database_newer_than_code_is_reported_as_unknown_revision(tmp_path, caplog):
    engine, url = _sqlite(tmp_path, "29990101_9999")
    with caplog.at_level(logging.WARNING, logger="backend.db_migrations"):
        result = db_migrations.check_internal_database_revision(engine, url, scope="app")
    assert result["status"] == "unknown_revision"
    assert caplog.records[-1].status == "unknown_revision"


def test_unreadable_version_table_never_raises(tmp_path, caplog):
    engine, url = _sqlite(tmp_path, None)  # no alembic_version table
    with caplog.at_level(logging.WARNING, logger="backend.db_migrations"):
        result = db_migrations.check_internal_database_revision(engine, url, scope="app")
    assert result["status"] == "unreadable"
    assert any("status=unreadable" in record.getMessage() for record in caplog.records)


def test_check_does_not_modify_the_database(tmp_path):
    _, url = _sqlite(tmp_path, None)
    older = _all_revisions(url)[1]
    engine, url = _sqlite(tmp_path, older)
    db_migrations.check_internal_database_revision(engine, url, scope="app")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == older
        tables = {row[0] for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
    assert tables == {"alembic_version"}


def test_production_startup_never_calls_alembic_upgrade(monkeypatch):
    """Real helper, fake PostgreSQL engine whose version table is behind: alembic upgrade must not run."""
    upgrades: list = []
    monkeypatch.setattr(db_migrations.command, "upgrade", lambda *args, **kwargs: upgrades.append(args))

    class _Connection:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, statement, *args, **kwargs):
            sql = str(statement)
            assert sql.lstrip().upper().startswith("SELECT"), sql
            return SimpleNamespace(first=lambda: ("20260922_0120",))

    engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"), connect=lambda: _Connection())

    monkeypatch.setattr(app_db_module, "get_app_engine", lambda database_url=None: engine)
    monkeypatch.setattr(app_db_module, "_postgres_has_alembic_version", lambda current_engine: True)
    monkeypatch.setattr(app_db_module, "ensure_app_database_configured", lambda url=None: "postgresql://app-prod")
    monkeypatch.setattr(app_db_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(app_db_module.AppBase.metadata, "create_all", lambda *a, **k: pytest.fail("no DDL"))
    app_db_module._initialize_app_schema_uncached("postgresql://app-prod")

    monkeypatch.setattr(chat_db_module, "get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr(chat_db_module, "_uses_legacy_public_chat_schema", lambda current_engine: False)
    monkeypatch.setattr(chat_db_module, "ensure_chat_configured", lambda url=None: "postgresql://chat-prod")
    monkeypatch.setattr(chat_db_module, "_verify_production_schema", lambda current_engine: None)
    monkeypatch.setattr(chat_db_module.config.app, "environment", "production", raising=False)
    chat_db_module.initialize_chat_schema("postgresql://chat-prod")

    assert upgrades == []


def test_development_chat_postgres_still_upgrades(monkeypatch):
    """Dev/staging behaviour is unchanged: only the production branch switched to the read-only check."""
    upgrades: list = []
    engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    monkeypatch.setattr(chat_db_module, "get_chat_engine", lambda database_url=None: engine)
    monkeypatch.setattr(chat_db_module, "_uses_legacy_public_chat_schema", lambda current_engine: False)
    monkeypatch.setattr(chat_db_module, "ensure_chat_configured", lambda url=None: "postgresql://chat-dev")
    monkeypatch.setattr(chat_db_module, "upgrade_internal_database", lambda url, *a, **k: upgrades.append((url, k)))
    monkeypatch.setattr(chat_db_module.Base.metadata, "create_all", lambda *a, **k: None)
    monkeypatch.setattr(chat_db_module, "_ensure_chat_push_outbox_columns", lambda current_engine: None)
    monkeypatch.setattr(chat_db_module.config.app, "environment", "development", raising=False)
    chat_db_module.initialize_chat_schema("postgresql://chat-dev")
    assert upgrades == [("postgresql://chat-dev", {"scope": "chat"})]
