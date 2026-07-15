from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest


def _service(monkeypatch):
    service = importlib.import_module("backend.services.transfer_act_job_service")
    monkeypatch.setattr(service, "_app_db_available", lambda: False)
    service._memory_jobs.clear()
    return service


def test_transfer_operation_id_reuses_same_job_and_claims_once(monkeypatch):
    service = _service(monkeypatch)
    user = SimpleNamespace(id=15, username="operator")
    kwargs = {
        "operation": "transfer",
        "payload": {"inv_nos": ["1001"], "new_employee_no": 44},
        "db_id": "main",
        "user": user,
        "request_count": 1,
        "operation_id": "web-operations-0001",
    }

    created = service.create_job(**kwargs)
    repeated = service.create_job(**kwargs)

    assert created["id"] == "web-operations-0001"
    assert created["created"] is True
    assert created["payload"]["one_c_sync_state"] == "not_requested"
    assert repeated["id"] == created["id"]
    assert repeated["created"] is False
    assert service.claim_for_execution(created["id"], "processing") is True
    assert service.claim_for_execution(created["id"], "processing") is False


def test_transfer_operation_id_cannot_cross_database_scope(monkeypatch):
    service = _service(monkeypatch)
    user = SimpleNamespace(id=15, username="operator")
    service.create_job(
        operation="transfer",
        payload={"inv_nos": ["1001"]},
        db_id="main",
        user=user,
        request_count=1,
        operation_id="web-operations-0002",
    )

    with pytest.raises(service.TransferOperationConflict):
        service.create_job(
            operation="transfer",
            payload={"inv_nos": ["1001"]},
            db_id="other",
            user=user,
            request_count=1,
            operation_id="web-operations-0002",
        )


def test_transfer_operation_id_cannot_replace_payload(monkeypatch):
    service = _service(monkeypatch)
    user = SimpleNamespace(id=15, username="operator")
    service.create_job(
        operation="transfer",
        payload={"inv_nos": ["1001"], "new_employee_no": 44},
        db_id="main",
        user=user,
        request_count=1,
        operation_id="web-operations-0003",
    )

    with pytest.raises(service.TransferOperationConflict):
        service.create_job(
            operation="transfer",
            payload={"inv_nos": ["1002"], "new_employee_no": 44},
            db_id="main",
            user=user,
            request_count=1,
            operation_id="web-operations-0003",
        )


def test_stale_processing_operation_is_requeued_and_reclaimed_once(monkeypatch):
    service = _service(monkeypatch)
    monkeypatch.setattr(service, "TRANSFER_ACT_JOB_LEASE_SECONDS", 60)
    user = SimpleNamespace(id=15, username="operator")
    kwargs = {
        "operation": "transfer",
        "payload": {"inv_nos": ["1001"], "new_employee_no": 44},
        "db_id": "main",
        "user": user,
        "request_count": 1,
        "operation_id": "web-operations-recovery-0001",
    }

    created = service.create_job(**kwargs)
    assert service.claim_for_execution(created["id"], "processing") is True
    service._memory_jobs[created["id"]]["updated_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=61)
    ).isoformat()

    resumed = service.create_job(**kwargs)

    assert resumed["id"] == created["id"]
    assert resumed["created"] is False
    assert resumed["resumed"] is True
    assert resumed["status"] == "queued"
    assert service.claim_for_execution(created["id"], "processing") is True
    assert service.claim_for_execution(created["id"], "processing") is False


def test_processing_checkpoint_survives_recovery_before_mark_done(monkeypatch):
    service = _service(monkeypatch)
    user = SimpleNamespace(id=15, username="operator")
    job = service.create_job(
        operation="transfer",
        payload={"inv_nos": ["1001"], "new_employee_no": 44},
        db_id="main",
        user=user,
        request_count=1,
        operation_id="web-operations-checkpoint-0001",
    )
    assert service.claim_for_execution(job["id"], "processing") is True

    checkpoint = {
        "acts": [{"act_id": "stable-act"}],
        "_act_records": [{"act_id": "stable-act", "file_path": "C:/acts/stable.docx"}],
        "execution_stage": "acts_generated",
    }
    assert service.checkpoint_processing_result(job["id"], checkpoint) is True
    persisted = service.get_job(job["id"])

    assert persisted is not None
    assert persisted["status"] == "processing"
    assert persisted["result"] == checkpoint


def test_non_admin_cannot_read_transfer_job_from_another_database_or_user():
    equipment_api = importlib.import_module("backend.api.v1.equipment")
    job = {"user_id": 15, "db_id": "main"}

    assert equipment_api._can_read_transfer_job(
        job=job,
        current_user=SimpleNamespace(id=15, role="operator"),
        db_id="main",
    ) is True
    assert equipment_api._can_read_transfer_job(
        job=job,
        current_user=SimpleNamespace(id=15, role="operator"),
        db_id="other",
    ) is False
    assert equipment_api._can_read_transfer_job(
        job=job,
        current_user=SimpleNamespace(id=16, role="operator"),
        db_id="main",
    ) is False
