from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_module = importlib.import_module("backend.services.hub_service")
reminder_module = importlib.import_module("backend.services.transfer_act_reminder_service")


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'reminder_app.db').as_posix()}"


def _make_store(base_dir: Path) -> SimpleNamespace:
    data_dir = base_dir / "local_store"
    data_dir.mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(
        db_path=str(base_dir / "local_store.sqlite3"),
        data_dir=str(data_dir),
    )


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


def _complete_reminder_columns() -> dict[str, set[str]]:
    return {
        table_name: set(columns)
        for table_name, columns in reminder_module._REMINDER_REQUIRED_COLUMNS.items()
    }


def _complete_reminder_indexes() -> dict[str, set[str]]:
    return {
        table_name: set(indexes)
        for table_name, indexes in reminder_module._REMINDER_REQUIRED_INDEXES.items()
    }


def _configure_production_reminder_schema_guard(monkeypatch, inspector: _FakeInspector) -> list[str]:
    init_calls: list[str] = []
    fake_engine = _FakePostgresEngine()
    monkeypatch.setattr(reminder_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(reminder_module, "initialize_app_schema", lambda database_url: init_calls.append(database_url))
    monkeypatch.setattr(reminder_module, "get_app_engine", lambda database_url: fake_engine)
    monkeypatch.setattr(reminder_module, "inspect", lambda engine: inspector)
    monkeypatch.setattr(
        reminder_module.TransferActReminderService,
        "_connect",
        lambda self: pytest.fail("production PostgreSQL reminder startup must not run runtime DDL"),
    )
    return init_calls


def test_transfer_act_reminder_service_production_postgres_verifies_migrated_schema(monkeypatch):
    inspector = _FakeInspector(
        columns_by_table=_complete_reminder_columns(),
        indexes_by_table=_complete_reminder_indexes(),
    )
    init_calls = _configure_production_reminder_schema_guard(monkeypatch, inspector)

    service = reminder_module.TransferActReminderService(database_url="postgresql://reminder-prod")

    assert service._use_app_db is True
    assert init_calls == ["postgresql://reminder-prod"]


def test_transfer_act_reminder_service_production_postgres_rejects_incomplete_schema(monkeypatch):
    columns_by_table = _complete_reminder_columns()
    columns_by_table["equipment_transfer_act_reminder_groups"].remove("completed_at")
    inspector = _FakeInspector(
        columns_by_table=columns_by_table,
        indexes_by_table=_complete_reminder_indexes(),
    )
    _configure_production_reminder_schema_guard(monkeypatch, inspector)

    with pytest.raises(
        reminder_module.TransferActReminderSchemaConfigurationError,
        match="equipment_transfer_act_reminder_groups.completed_at",
    ):
        reminder_module.TransferActReminderService(database_url="postgresql://reminder-prod")


def test_transfer_act_reminder_service_production_postgres_rejects_missing_index(monkeypatch):
    indexes_by_table = _complete_reminder_indexes()
    indexes_by_table["equipment_transfer_act_reminders"].remove("idx_equipment_transfer_act_reminders_db_status")
    inspector = _FakeInspector(
        columns_by_table=_complete_reminder_columns(),
        indexes_by_table=indexes_by_table,
    )
    _configure_production_reminder_schema_guard(monkeypatch, inspector)

    with pytest.raises(
        reminder_module.TransferActReminderSchemaConfigurationError,
        match="equipment_transfer_act_reminders.idx_equipment_transfer_act_reminders_db_status",
    ):
        reminder_module.TransferActReminderService(database_url="postgresql://reminder-prod")


def test_transfer_act_reminder_service_supports_app_db_backend(temp_dir, monkeypatch):
    store = _make_store(Path(temp_dir))
    database_url = _sqlite_url(temp_dir)

    monkeypatch.setattr(hub_module, "get_local_store", lambda: store)
    monkeypatch.setattr(reminder_module, "get_local_store", lambda: store)

    users = {
        10: {
            "id": 10,
            "username": "operator.user",
            "full_name": "Operator User",
            "role": "operator",
            "is_active": True,
            "use_custom_permissions": False,
            "custom_permissions": [],
        },
        20: {
            "id": 20,
            "username": "kozlovskii.me",
            "full_name": "Kozlovskii Me",
            "role": "admin",
            "is_active": True,
            "use_custom_permissions": False,
            "custom_permissions": [],
        },
    }
    monkeypatch.setattr(hub_module.user_service, "get_by_id", lambda user_id: users.get(int(user_id)))
    monkeypatch.setattr(
        reminder_module.app_settings_service,
        "resolve_transfer_act_reminder_controller",
        lambda: {
            "transfer_act_reminder_controller_username": "kozlovskii.me",
            "resolved_controller": {"id": 20, "username": "kozlovskii.me", "full_name": "Kozlovskii Me"},
            "resolved_controller_source": "configured",
            "fallback_used": False,
            "warning": None,
        },
    )

    hub = hub_module.HubService(database_url=database_url)
    reminder = reminder_module.TransferActReminderService(database_url=database_url)
    monkeypatch.setattr(reminder_module, "hub_service", hub)

    actor = SimpleNamespace(
        id=10,
        username="operator.user",
        full_name="Operator User",
        role="operator",
    )

    transferred_items = [
        {"inv_no": "1001", "old_employee_name": "Ivan Ivanov"},
        {"inv_no": "1002", "old_employee_name": "Ivan Ivanov"},
        {"inv_no": "2001", "old_employee_name": "Petr Petrov"},
    ]
    acts = [
        {"act_id": "act-1", "old_employee": "Ivan Ivanov", "equipment_count": 2},
        {"act_id": "act-2", "old_employee": "Petr Petrov", "equipment_count": 1},
    ]

    created = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    assert created["created"] is True
    payload = reminder.get_reminder(reminder_id=created["reminder_id"])
    assert payload is not None
    assert payload["pending_groups_total"] == 2
    task = hub.get_task(created["task_id"], user_id=10, is_admin=True)
    assert task is not None
    assert task["project_id"] == hub._TRANSFER_ACT_REMINDER_PROJECT_ID
    assert task["project_name"] == hub._TRANSFER_ACT_REMINDER_PROJECT_NAME

    completed = reminder.complete_for_uploaded_act(
        reminder_id=None,
        source_task_id=None,
        db_id="main",
        current_user=actor,
        from_employee="Ivan Ivanov",
        to_employee="New Employee",
        linked_inv_nos=["1001", "1002"],
        doc_no=101,
        doc_number="101",
    )
    assert completed["reminder_status"] == "matched_partial"
