from __future__ import annotations

import importlib
from types import SimpleNamespace


def test_disabled_dev_auto_create_uses_alembic_without_create_all(monkeypatch):
    appdb = importlib.import_module("backend.appdb.db")
    db_migrations = importlib.import_module("backend.db_migrations")
    fake_engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    upgraded: list[tuple[str, str]] = []

    monkeypatch.setenv("APP_SCHEMA_DEV_AUTO_CREATE", "0")
    monkeypatch.setattr(appdb.config.app, "environment", "development")
    monkeypatch.setattr(appdb, "get_app_engine", lambda _url=None: fake_engine)
    monkeypatch.setattr(appdb, "_postgres_has_alembic_version", lambda _engine: True)
    monkeypatch.setattr(
        db_migrations,
        "upgrade_internal_database",
        lambda database_url, *, scope: upgraded.append((database_url, scope)),
    )
    monkeypatch.setattr(
        appdb,
        "_create_all_app_metadata",
        lambda _bind: (_ for _ in ()).throw(AssertionError("create_all must stay disabled")),
    )

    appdb._initialize_app_schema_uncached("postgresql://test/live")

    assert upgraded == [("postgresql://test/live", "app")]


def test_dev_auto_create_remains_enabled_by_default(monkeypatch):
    appdb = importlib.import_module("backend.appdb.db")
    monkeypatch.delenv("APP_SCHEMA_DEV_AUTO_CREATE", raising=False)

    assert appdb._postgres_dev_schema_auto_create_enabled() is True
