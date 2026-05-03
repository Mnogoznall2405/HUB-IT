from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import importlib
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str, permissions: list[str]) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'hub_app.db').as_posix()}"


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


def _complete_hub_columns() -> dict[str, set[str]]:
    return {
        table_name: set(columns)
        for table_name, columns in hub_service_module._HUB_REQUIRED_COLUMNS.items()
    }


def _complete_hub_indexes() -> dict[str, set[str]]:
    return {
        table_name: set(indexes)
        for table_name, indexes in hub_service_module._HUB_REQUIRED_INDEXES.items()
    }


def _configure_production_hub_schema_guard(monkeypatch, inspector: _FakeInspector) -> list[str]:
    init_calls: list[str] = []
    fake_engine = _FakePostgresEngine()
    monkeypatch.setattr(hub_service_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(hub_service_module, "initialize_app_schema", lambda database_url: init_calls.append(database_url))
    monkeypatch.setattr(hub_service_module, "get_app_engine", lambda database_url: fake_engine)
    monkeypatch.setattr(hub_service_module, "inspect", lambda engine: inspector)
    monkeypatch.setattr(
        hub_service_module.HubService,
        "_connect",
        lambda self: pytest.fail("production PostgreSQL hub startup must not run runtime DDL"),
    )
    return init_calls


def test_hub_service_production_postgres_verifies_migrated_schema(monkeypatch):
    inspector = _FakeInspector(
        columns_by_table=_complete_hub_columns(),
        indexes_by_table=_complete_hub_indexes(),
    )
    init_calls = _configure_production_hub_schema_guard(monkeypatch, inspector)

    service = hub_service_module.HubService(database_url="postgresql://hub-prod")

    assert service._use_app_db is True
    assert init_calls == ["postgresql://hub-prod"]


def test_hub_service_production_postgres_rejects_incomplete_schema(monkeypatch):
    columns_by_table = _complete_hub_columns()
    columns_by_table["hub_tasks"].remove("visibility_scope")
    inspector = _FakeInspector(
        columns_by_table=columns_by_table,
        indexes_by_table=_complete_hub_indexes(),
    )
    _configure_production_hub_schema_guard(monkeypatch, inspector)

    with pytest.raises(hub_service_module.HubSchemaConfigurationError, match="hub_tasks.visibility_scope"):
        hub_service_module.HubService(database_url="postgresql://hub-prod")


def test_hub_service_supports_app_db_backend(temp_dir, monkeypatch):
    users = {
        1: _raw_user(1, "author", "Hub Author", "operator", ["dashboard.read", "tasks.write", "announcements.write"]),
        2: _raw_user(2, "assignee", "Hub Assignee", "viewer", ["dashboard.read", "tasks.read"]),
        3: _raw_user(3, "controller", "Hub Controller", "admin", ["dashboard.read", "tasks.review"]),
    }
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "legacy_hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users.get(int(user_id)))

    service = hub_service_module.HubService(database_url=_sqlite_url(temp_dir))

    actor = users[1]
    project = service.create_task_project(name="App DB Project", code="APP_DB")
    task = service.create_task(
        title="App DB Task",
        description="Body",
        assignee_user_id=2,
        controller_user_id=3,
        due_at="2026-03-30T10:00:00+00:00",
        project_id=project["id"],
        priority="high",
        actor=actor,
    )
    assert task["title"] == "App DB Task"

    tasks = service.list_tasks(user_id=2, scope="my", role_scope="assignee", limit=20, offset=0)
    assert tasks["total"] == 1
    assert tasks["items"][0]["id"] == task["id"]

    announcement = service.create_announcement(
        payload={
            "title": "App DB Announcement",
            "preview": "Preview",
            "body": "Body",
            "priority": "normal",
            "audience_scope": "users",
            "audience_user_ids": [2],
            "requires_ack": True,
        },
        actor=actor,
    )
    assert announcement["title"] == "App DB Announcement"

    announcements = service.list_announcements(user_id=2, limit=20, offset=0)
    assert announcements["total"] == 1
    assert announcements["items"][0]["id"] == announcement["id"]

    polled = service.poll_notifications(user_id=2, limit=20)
    assert polled["items"]
    assert any(item["entity_id"] in {task["id"], announcement["id"]} for item in polled["items"])
