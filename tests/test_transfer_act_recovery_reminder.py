"""Recovery перемещения с актом: повторный запуск не создаёт второе напоминание о загрузке акта."""

from __future__ import annotations

import copy
from types import SimpleNamespace

import pytest


@pytest.fixture
def execution(monkeypatch, tmp_path):
    import local_store

    monkeypatch.setattr(local_store, "_STORE_SINGLETON", None)
    local_store.get_local_store(data_dir=tmp_path / "local_store")
    from backend.services import equipment_transfer_execution_service as module

    monkeypatch.setattr(module, "invalidate_equipment_cache", lambda *args: None)
    monkeypatch.setattr(
        module.queries,
        "get_owner_by_no",
        lambda *args: {"OWNER_NO": 99, "OWNER_DISPLAY_NAME": "Получатель теста", "OWNER_DEPT": "ИТ"},
    )
    monkeypatch.setattr(module.queries, "get_owner_email_by_no", lambda *args: None)
    monkeypatch.setattr(
        module.queries,
        "transfer_equipment_by_inv_with_history",
        lambda **kwargs: {
            "success": True,
            "inv_no": kwargs["inv_no"],
            "old_employee_no": 1,
            "old_employee_name": "Отправитель теста",
            "new_employee_no": kwargs["new_employee_no"],
            "new_employee_name": kwargs["new_employee_name"],
            "type_name": "Монитор",
            "model_name": "TEST-MODEL",
            "serial_no": "TEST-SN",
        },
    )
    monkeypatch.setattr(
        module,
        "generate_transfer_acts",
        lambda **kwargs: [
            {
                "act_id": "act-recovery-1",
                "old_employee": "Отправитель теста",
                "equipment_count": 1,
                "file_name": "act.pdf",
                "file_type": "pdf",
            }
        ],
    )
    reminders = []

    def create_reminder(**kwargs):
        reminders.append(kwargs)
        return {"created": True, "task_id": f"task-{len(reminders)}", "reminder_id": f"reminder-{len(reminders)}"}

    monkeypatch.setattr(module.transfer_act_reminder_service, "create_transfer_reminder", create_reminder)
    return SimpleNamespace(module=module, reminders=reminders)


def test_recovered_transfer_does_not_create_second_upload_reminder(execution):
    module = execution.module
    saved = []
    crash = {"pending": True}

    def checkpoint(result):
        if crash["pending"] and result.get("execution_stage") == "reminder_processed":
            crash["pending"] = False
            raise RuntimeError("worker lost after reminder creation")
        saved.append(copy.deepcopy(result))

    payload = {
        "operation_id": "web-recovery-reminder-0001",
        "inv_nos": ["1001"],
        "new_employee": "Получатель теста",
        "new_employee_no": 99,
    }
    user = SimpleNamespace(id=15, username="operator", role="operator")

    with pytest.raises(RuntimeError, match="worker lost"):
        module.execute_equipment_transfer(payload=payload, db_id="main", current_user=user, checkpoint=checkpoint)
    module.execute_equipment_transfer(
        payload=payload,
        db_id="main",
        current_user=user,
        checkpoint=checkpoint,
        recovered_result=saved[-1],
    )

    assert len(execution.reminders) == 1
