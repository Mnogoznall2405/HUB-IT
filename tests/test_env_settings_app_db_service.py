from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

env_settings_module = importlib.import_module("backend.services.env_settings_service")
EnvSettingsService = env_settings_module.EnvSettingsService


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'env_settings_app.db').as_posix()}"


class _FakePostgresDialect:
    name = "postgresql"


class _FakePostgresEngine:
    dialect = _FakePostgresDialect()


class _FakeInspector:
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


def _complete_audit_columns() -> dict[str, set[str]]:
    return {
        table_name: set(columns)
        for table_name, columns in env_settings_module._AUDIT_REQUIRED_COLUMNS.items()
    }


def _complete_audit_indexes() -> dict[str, set[str]]:
    return {
        table_name: set(indexes)
        for table_name, indexes in env_settings_module._AUDIT_REQUIRED_INDEXES.items()
    }


def _configure_production_env_audit_schema_guard(monkeypatch, inspector: _FakeInspector) -> list[str]:
    init_calls: list[str] = []
    fake_engine = _FakePostgresEngine()
    monkeypatch.setattr(env_settings_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(env_settings_module, "initialize_app_schema", lambda database_url: init_calls.append(database_url))
    monkeypatch.setattr(env_settings_module, "get_app_engine", lambda database_url: fake_engine)
    monkeypatch.setattr(env_settings_module, "inspect", lambda engine: inspector)
    monkeypatch.setattr(
        env_settings_module.EnvSettingsService,
        "_connect_audit",
        lambda self: pytest.fail("production PostgreSQL env audit startup must not run runtime DDL"),
    )
    return init_calls


def test_env_settings_service_production_postgres_verifies_migrated_schema(temp_dir, monkeypatch):
    inspector = _FakeInspector(
        columns_by_table=_complete_audit_columns(),
        indexes_by_table=_complete_audit_indexes(),
    )
    init_calls = _configure_production_env_audit_schema_guard(monkeypatch, inspector)

    service = EnvSettingsService(
        env_path=Path(temp_dir) / ".env",
        audit_db_path=Path(temp_dir) / "legacy_audit.sqlite3",
        database_url="postgresql://env-prod",
    )

    assert service._use_app_db is True
    assert init_calls == ["postgresql://env-prod"]


def test_env_settings_service_production_postgres_rejects_incomplete_schema(temp_dir, monkeypatch):
    columns_by_table = _complete_audit_columns()
    columns_by_table["env_settings_audit"].remove("actor_username")
    inspector = _FakeInspector(
        columns_by_table=columns_by_table,
        indexes_by_table=_complete_audit_indexes(),
    )
    _configure_production_env_audit_schema_guard(monkeypatch, inspector)

    with pytest.raises(
        env_settings_module.EnvSettingsAuditSchemaConfigurationError,
        match="env_settings_audit.actor_username",
    ):
        EnvSettingsService(
            env_path=Path(temp_dir) / ".env",
            audit_db_path=Path(temp_dir) / "legacy_audit.sqlite3",
            database_url="postgresql://env-prod",
        )


def test_env_settings_service_rejects_legacy_sqlite_audit_in_production(temp_dir, monkeypatch):
    monkeypatch.setattr(env_settings_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(env_settings_module, "is_app_database_configured", lambda: False)

    with pytest.raises(env_settings_module.EnvSettingsAuditSchemaConfigurationError, match="APP_DATABASE_URL"):
        EnvSettingsService(
            env_path=Path(temp_dir) / ".env",
            audit_db_path=Path(temp_dir) / "legacy_audit.sqlite3",
        )


def test_env_settings_service_supports_app_db_backend(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "JWT_SECRET_KEY=old-secret-value\n"
        "SESSION_IDLE_TIMEOUT_MINUTES=30\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(
        env_path=env_path,
        audit_db_path=base / "legacy_audit.sqlite3",
        database_url=_sqlite_url(temp_dir),
    )

    response = service.update_variables(
        {
            "JWT_SECRET_KEY": "new-secret-value",
            "SESSION_IDLE_TIMEOUT_MINUTES": "45",
        },
        actor_user_id=5,
        actor_username="admin",
    )

    assert response["updated"] == 2
    recent = {item["key"]: item for item in service.get_recent_changes(limit=10)}
    assert recent["SESSION_IDLE_TIMEOUT_MINUTES"]["new_value_masked"] == "45"
    assert recent["JWT_SECRET_KEY"]["new_value_masked"] != "new-secret-value"
