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


@pytest.mark.parametrize("backend", ["memory", "sqlite"])
def test_worker_that_lost_lease_cannot_overwrite_reclaimed_or_done_job(monkeypatch, tmp_path, backend):
    from concurrent.futures import ThreadPoolExecutor

    if backend == "memory":
        service = _service(monkeypatch)
    else:
        import conftest

        service = importlib.import_module("backend.services.transfer_act_job_service")
        appdb = importlib.import_module("backend.appdb.db")
        cfg = importlib.import_module("backend.config")
        url = f"sqlite:///{(tmp_path / 'transfer_jobs.db').as_posix()}"
        monkeypatch.setattr(cfg.config.app_db, "database_url", url, raising=False)
        monkeypatch.setattr(appdb.config.app_db, "database_url", url, raising=False)
        appdb._engines.clear()
        appdb._session_factories.clear()
        appdb._initialized_schema_urls.clear()
        conftest.copy_app_schema_for_url(url)
    monkeypatch.setattr(service, "TRANSFER_ACT_JOB_LEASE_SECONDS", 60)

    kwargs = {
        "operation": "transfer",
        "payload": {"inv_nos": ["1001"], "new_employee_no": 44},
        "db_id": "main",
        "user": SimpleNamespace(id=15, username="operator"),
        "request_count": 1,
        "operation_id": f"web-lease-lost-{backend}-0001",
    }
    job_id = service.create_job(**kwargs)["id"]

    def expire_lease():
        if backend == "memory":
            service._memory_jobs[job_id]["updated_at"] = (
                datetime.now(timezone.utc) - timedelta(seconds=61)
            ).isoformat()
        else:
            from backend.appdb.db import app_session
            from backend.appdb.models import AppTransferActJob

            with app_session() as session:
                session.get(AppTransferActJob, job_id).updated_at = datetime.now(timezone.utc) - timedelta(seconds=61)

    # Each worker claims and finalizes on its own thread, like the API job runners.
    with ThreadPoolExecutor(max_workers=1) as old_worker, ThreadPoolExecutor(max_workers=1) as new_worker:
        assert old_worker.submit(service.claim_for_execution, job_id, "old worker").result() is True
        old_token = old_worker.submit(service.execution_claim_token, job_id).result()
        assert old_token is not None
        # Heartbeat runs on a separate thread and must carry its owner's token.
        assert service.touch_execution_lease(job_id, claim_token=old_token) is True
        expire_lease()
        assert service.create_job(**kwargs)["resumed"] is True  # lease expired -> queued
        # Lost lease while the job is queued again: the old worker must not fail it.
        assert old_worker.submit(service.mark_failed, job_id, "old boom").result() is False
        assert service.get_job(job_id)["status"] == "queued"

        assert new_worker.submit(service.claim_for_execution, job_id, "new worker").result() is True
        current = service.get_job(job_id)
        assert service.touch_execution_lease(job_id, claim_token=old_token) is False
        assert old_worker.submit(service.checkpoint_processing_result, job_id, {"who": "old"}).result() is False
        assert service.get_job(job_id) == current
        assert new_worker.submit(service.checkpoint_processing_result, job_id, {"who": "new"}).result() is True
        assert service.get_job(job_id)["result"] == {"who": "new"}
        assert new_worker.submit(service.touch_execution_lease, job_id).result() is True
        # Re-claimed by the second worker (processing again): old worker is still fenced off.
        assert old_worker.submit(service.mark_failed, job_id, "old boom").result() is False
        assert old_worker.submit(service.mark_done, job_id, {"who": "old"}).result() is False
        current = service.get_job(job_id)
        assert current["status"] == "processing"
        assert current["result"] == {"who": "new"}

        assert new_worker.submit(service.mark_done, job_id, {"who": "new"}, "done by new").result() is True
        # Already done: neither a stale failure nor a stale success may change it.
        assert old_worker.submit(service.mark_failed, job_id, "late boom").result() is False
        assert old_worker.submit(service.mark_done, job_id, {"who": "old"}).result() is False
        assert new_worker.submit(service.mark_failed, job_id, "double finalize").result() is False

    final = service.get_job(job_id)
    assert final["status"] == "done"
    assert final["status_text"] == "done by new"
    assert final["result"] == {"who": "new"}
    assert final["error_text"] is None

    # The owner's normal failure path still works on a fresh claim.
    failed_id = service.create_job(**{**kwargs, "operation_id": f"web-lease-owner-{backend}-0002"})["id"]
    assert service.claim_for_execution(failed_id, "owner") is True
    assert service.mark_failed(failed_id, "real failure") is True
    assert service.get_job(failed_id)["status"] == "failed"
    assert service.get_job(failed_id)["error_text"] == "real failure"
