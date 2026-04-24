from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


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
