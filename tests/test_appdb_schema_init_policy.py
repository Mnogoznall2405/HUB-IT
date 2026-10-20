from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("production,allow_create", [(True, "1"), (False, "0")])
@pytest.mark.parametrize("initialized", [True, False])
def test_disabled_startup_ddl_checks_revision_without_migrating(monkeypatch, production, allow_create, initialized):
    """SQLite E2E cannot reach this PostgreSQL-only startup guard."""
    appdb = importlib.import_module("backend.appdb.db")
    db_migrations = importlib.import_module("backend.db_migrations")
    fake_engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    checked: list[tuple[str, str]] = []

    monkeypatch.setenv("APP_SCHEMA_DEV_AUTO_CREATE", allow_create)
    monkeypatch.setattr(appdb.config.app, "environment", "production" if production else "development")
    monkeypatch.setattr(appdb, "get_app_engine", lambda _url=None: fake_engine)
    monkeypatch.setattr(appdb, "_postgres_has_alembic_version", lambda _engine: initialized)

    def forbidden(*args, **kwargs):
        raise AssertionError("Startup crossed a migration/DDL boundary")

    monkeypatch.setattr(
        db_migrations,
        "upgrade_internal_database",
        forbidden,
    )
    monkeypatch.setattr(
        db_migrations, "check_internal_database_revision",
        lambda engine, database_url, *, scope: checked.append((database_url, scope)),
    )
    monkeypatch.setattr(appdb, "_create_all_app_metadata", forbidden)
    monkeypatch.setattr(appdb, "_run_postgres_app_schema_maintenance", forbidden)

    if initialized:
        appdb._initialize_app_schema_uncached("postgresql://test/live")
        assert checked == [("postgresql://test/live", "app")]
    else:
        with pytest.raises(appdb.AppDatabaseConfigurationError, match="Alembic-initialized"):
            appdb._initialize_app_schema_uncached("postgresql://test/live")
        assert checked == []


def test_startup_ddl_is_off_unless_flag_is_explicit(monkeypatch):
    appdb = importlib.import_module("backend.appdb.db")
    monkeypatch.delenv("APP_SCHEMA_DEV_AUTO_CREATE", raising=False)
    assert appdb._postgres_dev_schema_auto_create_enabled() is False

    monkeypatch.setenv("APP_SCHEMA_DEV_AUTO_CREATE", "")
    assert appdb._postgres_dev_schema_auto_create_enabled() is False

    monkeypatch.setenv("APP_SCHEMA_DEV_AUTO_CREATE", "1")
    assert appdb._postgres_dev_schema_auto_create_enabled() is True
