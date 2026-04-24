from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.hub_service import HubService
from backend.services.transfer_act_reminder_service import TransferActReminderService


def _make_store(base_dir: Path) -> SimpleNamespace:
    data_dir = base_dir / "local_store"
    data_dir.mkdir(parents=True, exist_ok=True)
    return SimpleNamespace(
        db_path=str(base_dir / "local_store.sqlite3"),
        data_dir=str(data_dir),
    )


def _build_services(temp_dir: str, monkeypatch):
    hub_module = importlib.import_module("backend.services.hub_service")
    reminder_module = importlib.import_module("backend.services.transfer_act_reminder_service")
    store = _make_store(Path(temp_dir))

    monkeypatch.setattr(hub_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(reminder_module, "get_local_store", lambda: store)
    monkeypatch.setattr(reminder_module, "is_app_database_configured", lambda: False)

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

    hub = HubService()
    reminder = TransferActReminderService()
    monkeypatch.setattr(reminder_module, "hub_service", hub)

    actor = SimpleNamespace(
        id=10,
        username="operator.user",
        full_name="Operator User",
        role="operator",
    )
    return hub_module, reminder_module, hub, reminder, actor


def _sample_transfer_payload():
    transferred_items = [
        {"inv_no": "1001", "old_employee_name": "Ivan Ivanov"},
        {"inv_no": "1002", "old_employee_name": "Ivan Ivanov"},
        {"inv_no": "2001", "old_employee_name": "Petr Petrov"},
    ]
    acts = [
        {"act_id": "act-1", "old_employee": "Ivan Ivanov", "equipment_count": 2},
        {"act_id": "act-2", "old_employee": "Petr Petrov", "equipment_count": 1},
    ]
    return transferred_items, acts


def test_hub_service_create_task_supports_internal_initial_status(temp_dir, monkeypatch):
    _, _, hub, _, actor = _build_services(temp_dir, monkeypatch)
    project = hub.create_task_project(name="Reminder Test Project", code="REMINDER_TEST")

    default_task = hub.create_task(
        title="Default Status",
        description="Task body",
        assignee_user_id=10,
        controller_user_id=20,
        due_at=None,
        project_id=project["id"],
        priority="normal",
        actor={"id": 20, "username": "kozlovskii.me", "full_name": "Kozlovskii Me"},
    )
    assert str(default_task["status"]).lower() == "new"

    in_progress_task = hub.create_task(
        title="Reminder Status",
        description="Task body",
        assignee_user_id=10,
        controller_user_id=20,
        due_at=None,
        project_id=project["id"],
        priority="normal",
        actor={"id": 20, "username": "kozlovskii.me", "full_name": "Kozlovskii Me"},
        initial_status="in_progress",
    )
    assert str(in_progress_task["status"]).lower() == "in_progress"

    history = hub.list_task_status_log(in_progress_task["id"], user_id=10, is_admin=True)
    assert [item["new_status"] for item in history] == ["in_progress"]


def test_create_transfer_reminder_creates_one_hub_task_and_pending_groups(temp_dir, monkeypatch):
    _, reminder_module, hub, reminder, actor = _build_services(temp_dir, monkeypatch)
    transferred_items, acts = _sample_transfer_payload()

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

    result = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    assert result["created"] is True
    assert result["task_id"]
    assert result["reminder_id"]
    assert result["controller_username"] == "kozlovskii.me"

    reminder_payload = reminder.get_reminder(reminder_id=result["reminder_id"])
    assert reminder_payload["pending_groups_total"] == 2
    assert sorted(group["old_employee_name"] for group in reminder_payload["pending_groups"]) == ["Ivan Ivanov", "Petr Petrov"]

    task = hub.get_task(result["task_id"], user_id=10, is_admin=True)
    assert str(task["status"]).lower() == "in_progress"
    assert task["project_id"] == hub._TRANSFER_ACT_REMINDER_PROJECT_ID
    assert task["project_name"] == hub._TRANSFER_ACT_REMINDER_PROJECT_NAME
    enriched = reminder.enrich_task(task)
    assert enriched["integration_kind"] == "transfer_act_upload"
    assert enriched["integration_payload"]["reminder_id"] == result["reminder_id"]
    assert enriched["integration_payload"]["pending_groups_total"] == 2

    history = hub.list_task_status_log(result["task_id"], user_id=10, is_admin=True)
    assert [item["new_status"] for item in history] == ["in_progress"]
    controller_counts = hub.get_unread_counts(user_id=20)
    assert controller_counts["tasks_controller_open"] == 1
    assert controller_counts["tasks_review_required"] == 0


def test_create_transfer_reminder_accepts_admin_controller_without_explicit_tasks_review(temp_dir, monkeypatch):
    hub_module, reminder_module, _, reminder, actor = _build_services(temp_dir, monkeypatch)
    transferred_items, acts = _sample_transfer_payload()

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
            "use_custom_permissions": True,
            "custom_permissions": [],
        },
    }
    monkeypatch.setattr(hub_module.user_service, "get_by_id", lambda user_id: users.get(int(user_id)))
    monkeypatch.setattr(
        reminder_module.app_settings_service,
        "resolve_transfer_act_reminder_controller",
        lambda: {
            "transfer_act_reminder_controller_username": "kozlovskii.me",
            "resolved_controller": {"id": 20, "username": "kozlovskii.me", "full_name": "Kozlovskii Me", "role": "admin"},
            "resolved_controller_source": "configured",
            "fallback_used": False,
            "warning": None,
        },
    )

    result = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    assert result["created"] is True
    assert result["controller_username"] == "kozlovskii.me"


def test_complete_uploaded_act_closes_groups_and_finishes_hub_task(temp_dir, monkeypatch):
    _, reminder_module, hub, reminder, actor = _build_services(temp_dir, monkeypatch)
    transferred_items, acts = _sample_transfer_payload()

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

    created = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    partial = reminder.complete_for_uploaded_act(
        reminder_id=created["reminder_id"],
        source_task_id=None,
        db_id="main",
        current_user=actor,
        from_employee="Ivan Ivanov",
        to_employee="New Employee",
        linked_inv_nos=["1002", "1001"],
        doc_no=123,
        doc_number="123",
    )
    assert partial["reminder_status"] == "matched_partial"
    assert partial["reminder_pending_groups"] == 1

    task_before_final = hub.get_task(created["task_id"], user_id=10, is_admin=True)
    assert str(task_before_final["status"]).lower() == "in_progress"

    completed = reminder.complete_for_uploaded_act(
        reminder_id=created["reminder_id"],
        source_task_id=None,
        db_id="main",
        current_user=actor,
        from_employee="Petr Petrov",
        to_employee="New Employee",
        linked_inv_nos=["2001"],
        doc_no=124,
        doc_number="124",
    )
    assert completed["reminder_status"] == "completed"
    assert completed["reminder_pending_groups"] == 0

    reminder_payload = reminder.get_reminder(reminder_id=created["reminder_id"])
    assert reminder_payload["status"] == "done"
    assert reminder_payload["pending_groups_total"] == 0

    task_after_final = hub.get_task(created["task_id"], user_id=10, is_admin=True)
    assert str(task_after_final["status"]).lower() == "done"
    assert "автоматически" in str(task_after_final.get("review_comment") or "").lower()


def test_complete_uploaded_act_can_auto_match_open_reminder_without_explicit_ids(temp_dir, monkeypatch):
    _, reminder_module, _, reminder, actor = _build_services(temp_dir, monkeypatch)
    transferred_items, acts = _sample_transfer_payload()

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

    created = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    matched = reminder.complete_for_uploaded_act(
        reminder_id=None,
        source_task_id=None,
        db_id="main",
        current_user=actor,
        from_employee="Ivan Ivanov",
        to_employee="New Employee",
        linked_inv_nos=["1001", "1002"],
        doc_no=555,
        doc_number="555",
    )

    assert matched["reminder_status"] == "matched_partial"
    assert matched["reminder_id"] == created["reminder_id"]
    assert matched["reminder_task_id"] == created["task_id"]


def test_create_transfer_reminder_returns_warning_when_controller_is_missing(temp_dir, monkeypatch):
    _, reminder_module, _, reminder, actor = _build_services(temp_dir, monkeypatch)
    transferred_items, acts = _sample_transfer_payload()

    monkeypatch.setattr(
        reminder_module.app_settings_service,
        "resolve_transfer_act_reminder_controller",
        lambda: {
            "transfer_act_reminder_controller_username": "kozlovskii.me",
            "resolved_controller": None,
            "resolved_controller_source": "none",
            "fallback_used": False,
            "warning": "No active review user found",
        },
    )

    result = reminder.create_transfer_reminder(
        db_id="main",
        transferred_items=transferred_items,
        acts=acts,
        new_employee_no="501",
        new_employee_name="New Employee",
        actor_user=actor,
    )

    assert result["created"] is False
    assert result["task_id"] is None
    assert "review" in str(result["warning"]).lower()
