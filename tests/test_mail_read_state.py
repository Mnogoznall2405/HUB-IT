from __future__ import annotations

import importlib
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")
mail_api_module = importlib.import_module("backend.api.v1.mail")
auth_models_module = importlib.import_module("backend.models.auth")


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


def _complete_mail_columns() -> dict[str, set[str]]:
    return {
        table_name: set(columns)
        for table_name, columns in mail_module._MAIL_REQUIRED_COLUMNS.items()
    }


def _complete_mail_indexes() -> dict[str, set[str]]:
    return {
        table_name: set(indexes)
        for table_name, indexes in mail_module._MAIL_REQUIRED_INDEXES.items()
    }


def _configure_production_mail_schema_guard(monkeypatch, inspector: _FakeInspector) -> list[str]:
    init_calls: list[str] = []
    fake_engine = _FakePostgresEngine()
    monkeypatch.setattr(mail_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(mail_module, "initialize_app_schema", lambda database_url: init_calls.append(database_url))
    monkeypatch.setattr(mail_module, "get_app_engine", lambda database_url: fake_engine)
    monkeypatch.setattr(mail_module, "inspect", lambda engine: inspector)
    monkeypatch.setattr(
        mail_module.MailService,
        "_connect",
        lambda self: pytest.fail("production PostgreSQL mail startup must not run runtime DDL"),
    )
    monkeypatch.setattr(mail_module.MailService, "_migrate_legacy_template_fields", lambda self: None)
    monkeypatch.setattr(mail_module.MailService, "_cleanup_message_log", lambda self: None)
    return init_calls


class FakeItem:
    def __init__(self, *, item_id: str, conversation_key: str, is_read: bool):
        self.id = item_id
        self.conversation_key = conversation_key
        self.is_read = is_read
        self.datetime_received = datetime(2026, 3, 30, 12, 0, tzinfo=timezone.utc)

    def save(self, update_fields=None):
        return None


def _build_mail_user():
    return auth_models_module.User(
        id=100,
        username="mail-user",
        email="mail-user@example.com",
        full_name="Mail User",
        role="viewer",
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email="mail-user@example.com",
        mailbox_login=None,
        mail_signature_html=None,
        mail_is_configured=True,
    )


def test_mail_service_production_postgres_verifies_migrated_schema(monkeypatch):
    inspector = _FakeInspector(
        columns_by_table=_complete_mail_columns(),
        indexes_by_table=_complete_mail_indexes(),
    )
    init_calls = _configure_production_mail_schema_guard(monkeypatch, inspector)

    service = mail_module.MailService(database_url="postgresql://mail-prod")

    assert service._use_app_db is True
    assert init_calls == ["postgresql://mail-prod"]


def test_mail_service_production_postgres_rejects_incomplete_schema(monkeypatch):
    columns_by_table = _complete_mail_columns()
    columns_by_table["mail_it_templates"].remove("required_fields_json")
    inspector = _FakeInspector(
        columns_by_table=columns_by_table,
        indexes_by_table=_complete_mail_indexes(),
    )
    _configure_production_mail_schema_guard(monkeypatch, inspector)

    with pytest.raises(mail_module.MailSchemaConfigurationError, match="mail_it_templates.required_fields_json"):
        mail_module.MailService(database_url="postgresql://mail-prod")


def test_mail_service_production_rejects_missing_app_db(monkeypatch):
    monkeypatch.setattr(mail_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(mail_module.config.app_db, "database_url", "", raising=False)

    with pytest.raises(mail_module.MailSchemaConfigurationError, match="requires PostgreSQL APP_DATABASE_URL"):
        mail_module.MailService()


def test_mail_service_production_rejects_sqlite_app_db(temp_dir, monkeypatch):
    monkeypatch.setattr(mail_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(
        mail_module.config.app_db,
        "database_url",
        f"sqlite:///{(Path(temp_dir) / 'mail-prod.sqlite3').as_posix()}",
        raising=False,
    )

    with pytest.raises(mail_module.MailSchemaConfigurationError, match="does not allow SQLite"):
        mail_module.MailService()


def test_mail_service_development_keeps_sqlite_fallback(temp_dir, monkeypatch):
    store = type("Store", (), {"db_path": str(Path(temp_dir) / "legacy-mail.sqlite3")})()
    monkeypatch.setattr(mail_module.config.app, "environment", "development", raising=False)
    monkeypatch.setattr(mail_module.config.app_db, "database_url", "", raising=False)
    monkeypatch.setattr(mail_module, "get_local_store", lambda: store)

    service = mail_module.MailService()

    assert service._use_app_db is False
    assert service.db_path == Path(store.db_path)


def test_mail_service_marks_conversation_read_and_unread(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=f"sqlite:///{(Path(temp_dir) / 'mail_read_state.db').as_posix()}")
    items = [
        FakeItem(item_id="msg-1", conversation_key="conv-1", is_read=False),
        FakeItem(item_id="msg-2", conversation_key="conv-1", is_read=False),
    ]

    monkeypatch.setattr(service, "_resolve_user_mail_profile", lambda user_id, require_password=True: {
        "email": "user@example.com",
        "login": "user@example.com",
        "password": "secret",
    })
    monkeypatch.setattr(service, "_create_account", lambda **kwargs: object())
    monkeypatch.setattr(service, "_search_target_folders", lambda account, folder="inbox", folder_scope="current": [(object(), "inbox")])
    monkeypatch.setattr(service, "_folder_queryset", lambda folder_obj, folder_key: items)
    monkeypatch.setattr(service, "_item_conversation_key", lambda item: item.conversation_key)

    read_result = service.mark_conversation_as_read(
        user_id=7,
        conversation_id="conv-1",
        folder="inbox",
        folder_scope="current",
    )
    assert read_result["ok"] is True
    assert read_result["changed"] == 2
    assert all(item.is_read is True for item in items)

    unread_result = service.mark_conversation_as_unread(
        user_id=7,
        conversation_id="conv-1",
        folder="inbox",
        folder_scope="current",
    )
    assert unread_result["ok"] is True
    assert unread_result["changed"] == 2
    assert all(item.is_read is False for item in items)


def test_mail_conversation_read_routes_delegate_to_service(monkeypatch):
    current_user = _build_mail_user()
    called = {}

    def _mark_read(**kwargs):
        called["read"] = kwargs
        return {"ok": True, "changed": 2}

    def _mark_unread(**kwargs):
        called["unread"] = kwargs
        return {"ok": True, "changed": 2}

    monkeypatch.setattr(mail_api_module.mail_service, "mark_conversation_as_read", _mark_read)
    monkeypatch.setattr(mail_api_module.mail_service, "mark_conversation_as_unread", _mark_unread)

    app = FastAPI()
    app.include_router(mail_api_module.router, prefix="/mail")
    app.dependency_overrides[mail_api_module.get_current_mail_user] = lambda: current_user
    client = TestClient(app)

    read_response = client.post("/mail/conversations/conv-1/read", json={"folder": "inbox", "folder_scope": "current"})
    unread_response = client.post("/mail/conversations/conv-1/unread", json={"folder": "archive", "folder_scope": "all"})

    assert read_response.status_code == 200
    assert unread_response.status_code == 200
    assert called["read"] == {
        "user_id": 100,
        "conversation_id": "conv-1",
        "folder": "inbox",
        "folder_scope": "current",
    }
    assert called["unread"] == {
        "user_id": 100,
        "conversation_id": "conv-1",
        "folder": "archive",
        "folder_scope": "all",
    }
