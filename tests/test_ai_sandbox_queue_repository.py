from __future__ import annotations

import importlib
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

from backend.ai_sandbox.app_service import AiSandboxAppService  # noqa: E402
from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.contracts import (  # noqa: E402
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
    VerifiedAttachmentInput,
)
from backend.ai_sandbox.models import (  # noqa: E402
    AppAiSandboxFile,
    AppAiSandboxJob,
    AppAiSandboxPermission,
    AppAiSandboxSession,
)
from backend.ai_sandbox.sqlalchemy_repository import (  # noqa: E402
    SandboxRepositoryConflict,
    SqlAlchemySandboxQueueRepository,
)
from backend.ai_sandbox.worker import AiSandboxWorker  # noqa: E402
from backend.appdb.models import AppAiPendingAction  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("e" * 64)


@pytest.fixture
def queue_runtime(tmp_path: Path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'sandbox_queue.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    appdb_db.initialize_app_schema(database_url)
    repository = SqlAlchemySandboxQueueRepository(
        session_provider=lambda: appdb_db.app_session(database_url)
    )
    return database_url, appdb_db, repository, tmp_path


def _create_session(
    repository: SqlAlchemySandboxQueueRepository,
    *,
    now: datetime,
    session_id: str = "session-queue-1",
    conversation_id: str = "conversation-queue-1",
    user_id: int = 111,
    expires_at: datetime | None = None,
) -> SandboxSessionRecord:
    return repository.create_session(
        SandboxSessionRecord(
            id=session_id,
            conversation_id=conversation_id,
            user_id=user_id,
            workspace_key=f"workspace-{session_id}",
            status=SandboxSessionStatus.READY,
            created_at=now,
            last_activity_at=now,
            expires_at=expires_at or now + timedelta(days=30),
            credential_ref="",
        )
    )


def _job(
    *,
    job_id: str,
    now: datetime,
    message_id: str = "message-queue-1",
    session_id: str = "session-queue-1",
    conversation_id: str = "conversation-queue-1",
    user_id: int = 111,
) -> SandboxJobRecord:
    return SandboxJobRecord(
        id=job_id,
        session_id=session_id,
        conversation_id=conversation_id,
        user_id=user_id,
        prompt_message_id=message_id,
        status=SandboxJobStatus.PREPARING,
        created_at=now,
        deadline_at=now + timedelta(minutes=15),
    )


def test_duplicate_message_reuses_queued_job(queue_runtime) -> None:
    _, _, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 9, 0, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    original = repository.reserve_job(_job(job_id="job-original", now=now))
    queued = repository.activate_prepared_job(job_id=original.id, user_id=111, now=now)

    duplicate = repository.reserve_job(_job(job_id="job-duplicate", now=now + timedelta(seconds=1)))

    assert queued is not None and queued.status is SandboxJobStatus.QUEUED
    assert duplicate.id == original.id
    assert duplicate.status is SandboxJobStatus.QUEUED


def test_duplicate_message_reuses_completed_job(queue_runtime) -> None:
    _, _, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 9, 30, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    original = repository.reserve_job(_job(job_id="job-completed", now=now))
    assert repository.activate_prepared_job(job_id=original.id, user_id=111, now=now)
    assert repository.claim_next_job(worker_id="worker-1", now=now)
    assert repository.mark_job_running(job_id=original.id, worker_id="worker-1", now=now)
    assert repository.complete_job(
        job_id=original.id,
        worker_id="worker-1",
        result={"answer": "done"},
        now=now + timedelta(seconds=1),
    )

    duplicate = repository.reserve_job(_job(job_id="job-replayed", now=now + timedelta(seconds=2)))

    assert duplicate.id == original.id
    assert duplicate.status is SandboxJobStatus.SUCCEEDED
    assert duplicate.result == {"answer": "done"}


def test_cancel_cannot_be_overwritten_by_concurrent_mark_running(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 9, 40, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    job = repository.reserve_job(_job(job_id="job-cancel-vs-running", now=now))
    assert repository.activate_prepared_job(job_id=job.id, user_id=111, now=now)
    assert repository.claim_next_job(worker_id="worker-race", now=now)
    barrier = threading.Barrier(2)

    def mark_running() -> bool:
        barrier.wait(timeout=5)
        return repository.mark_job_running(
            job_id=job.id,
            worker_id="worker-race",
            now=now + timedelta(seconds=1),
        )

    def cancel() -> bool:
        barrier.wait(timeout=5)
        return repository.cancel_job(
            job_id=job.id,
            user_id=111,
            now=now + timedelta(seconds=1),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        mark_result = pool.submit(mark_running)
        cancel_result = pool.submit(cancel)
        assert cancel_result.result(timeout=10) is True
        mark_result.result(timeout=10)

    with appdb_db.app_session(database_url) as db:
        stored = db.get(AppAiSandboxJob, job.id)
        assert stored.status == "cleanup_pending"
        assert stored.cleanup_terminal_status == "cancelled"


def test_cancel_winner_cannot_be_overwritten_by_concurrent_finish(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 9, 50, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    job = repository.reserve_job(
        _job(job_id="job-cancel-vs-finish", message_id="message-cancel-vs-finish", now=now)
    )
    assert repository.activate_prepared_job(job_id=job.id, user_id=111, now=now)
    assert repository.claim_next_job(worker_id="worker-finish-race", now=now)
    assert repository.mark_job_running(
        job_id=job.id,
        worker_id="worker-finish-race",
        now=now,
    )
    barrier = threading.Barrier(2)

    def finish() -> bool:
        barrier.wait(timeout=5)
        return repository.complete_job(
            job_id=job.id,
            worker_id="worker-finish-race",
            result={"answer": "must not overwrite cancel"},
            now=now + timedelta(seconds=1),
        )

    def cancel() -> bool:
        barrier.wait(timeout=5)
        return repository.cancel_job(
            job_id=job.id,
            user_id=111,
            now=now + timedelta(seconds=1),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        finish_result = pool.submit(finish)
        cancel_result = pool.submit(cancel)
        cancelled = cancel_result.result(timeout=10)
        finished = finish_result.result(timeout=10)

    with appdb_db.app_session(database_url) as db:
        stored = db.get(AppAiSandboxJob, job.id)
        if cancelled:
            assert stored.status == "cleanup_pending"
        else:
            assert finished is True
            assert stored.status == "succeeded"


def test_concurrent_duplicate_reservation_has_one_preparing_job(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 10, 0, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    barrier = threading.Barrier(2)

    def reserve(job_id: str) -> SandboxJobRecord:
        barrier.wait(timeout=5)
        return repository.reserve_job(_job(job_id=job_id, now=now))

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(reserve, ("job-concurrent-a", "job-concurrent-b")))

    assert results[0].id == results[1].id
    assert all(item.status is SandboxJobStatus.PREPARING for item in results)
    with appdb_db.app_session(database_url) as db:
        rows = list(
            db.execute(
                select(AppAiSandboxJob).where(
                    AppAiSandboxJob.conversation_id == "conversation-queue-1",
                    AppAiSandboxJob.prompt_message_id == "message-queue-1",
                )
            ).scalars()
        )
        assert len(rows) == 1
        assert rows[0].status == "preparing"


def test_duplicate_input_names_get_distinct_opaque_paths(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 10, 30, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    job = repository.reserve_job(_job(job_id="job-inputs", now=now))
    repository.replace_job_inputs(
        job_id=job.id,
        user_id=111,
        now=now,
        inputs=(
            VerifiedAttachmentInput(
                attachment_id="attachment-a",
                message_id="message-queue-1",
                normalized_name="report.xlsx",
                size_bytes=10,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                sha256="a" * 64,
            ),
            VerifiedAttachmentInput(
                attachment_id="attachment-b",
                message_id="message-queue-1",
                normalized_name="report.xlsx",
                size_bytes=20,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                sha256="b" * 64,
            ),
        ),
    )

    with appdb_db.app_session(database_url) as db:
        files = list(
            db.execute(
                select(AppAiSandboxFile)
                .where(AppAiSandboxFile.job_id == job.id)
                .order_by(AppAiSandboxFile.source_attachment_id)
            ).scalars()
        )
        assert [item.file_name for item in files] == ["report.xlsx", "report.xlsx"]
        assert files[0].relative_path != files[1].relative_path
        assert all(item.relative_path.endswith("/report.xlsx") for item in files)


class _RetryingPurgeExecutor:
    def __init__(self) -> None:
        self.purge_calls = 0

    def execute(self, *args, **kwargs):  # pragma: no cover - retention test never executes a job
        raise AssertionError("expired session cleanup must not execute jobs")

    def abort_job(self, job):
        return None

    def notify_job_state(self, job_id):
        return None

    def purge_session(self, session):
        self.purge_calls += 1
        if self.purge_calls == 1:
            raise RuntimeError("temporary filesystem failure")


def _worker_settings(tmp_path: Path, *, enabled: bool = True) -> SandboxSettings:
    return SandboxSettings(
        enabled=enabled,
        image=PINNED_TEST_IMAGE if enabled else "",
        workspace_root=tmp_path / "workspaces",
        runtime_secret_root=tmp_path / "runtime-secrets",
        seccomp_profile=tmp_path / "seccomp.json",
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


def test_stale_running_job_is_never_replayed_and_stopped_session_purge_retries(queue_runtime) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    now = datetime(2026, 8, 15, 11, 0, tzinfo=timezone.utc)
    created_at = now - timedelta(days=31)
    _create_session(repository, now=created_at, expires_at=now - timedelta(days=1))
    job = repository.reserve_job(_job(job_id="job-stale-running", now=created_at))
    assert repository.activate_prepared_job(job_id=job.id, user_id=111, now=created_at)
    assert repository.claim_next_job(worker_id="worker-stale", now=created_at)
    assert repository.mark_job_running(job_id=job.id, worker_id="worker-stale", now=created_at)

    recovered = repository.reap_stale_jobs(
        now=now,
        heartbeat_timeout=timedelta(minutes=5),
        max_attempts=3,
        limit=50,
    )

    assert [item.status for item in recovered] == [SandboxJobStatus.RUNNING]
    assert repository.claim_next_job(worker_id="worker-other", now=now) is None
    with appdb_db.app_session(database_url) as db:
        stored_job = db.get(AppAiSandboxJob, job.id)
        stored_session = db.get(AppAiSandboxSession, "session-queue-1")
        assert stored_job.status == "cleanup_pending"
        assert stored_job.cleanup_terminal_status == "failed"
        assert stored_job.error_code == "worker_heartbeat_stale"
        assert stored_session.status == "busy"

    executor = _RetryingPurgeExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-retention",
        settings=_worker_settings(tmp_path),
        repository=repository,
        executor=executor,
    )
    assert worker.run_once(now=now).outcome == "idle"
    with appdb_db.app_session(database_url) as db:
        stored_job = db.get(AppAiSandboxJob, job.id)
        stored_session = db.get(AppAiSandboxSession, "session-queue-1")
        assert stored_job.status == "failed"
        assert stored_job.cleanup_terminal_status is None
        assert stored_session.status == "stopped"

    assert worker.purge_expired_once(now=now) == 0
    with appdb_db.app_session(database_url) as db:
        retained = db.get(AppAiSandboxSession, "session-queue-1")
        assert retained.status == "purging"
        assert retained.purge_token

    assert worker.purge_expired_once(now=now + timedelta(minutes=6)) == 1
    with appdb_db.app_session(database_url) as db:
        stored_session = db.get(AppAiSandboxSession, "session-queue-1")
        assert stored_session.status == "purged"
        assert stored_session.opencode_session_id is None
        assert stored_session.credential_ref == ""
    assert executor.purge_calls == 2


def test_purge_db_failure_after_workspace_delete_is_recovered_and_retried(
    queue_runtime,
    monkeypatch,
) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    now = datetime(2026, 8, 15, 11, 30, tzinfo=timezone.utc)
    original = _create_session(
        repository,
        now=now - timedelta(days=31),
        expires_at=now - timedelta(days=1),
    )

    class _IdempotentPurgeExecutor(_RetryingPurgeExecutor):
        def purge_session(self, session):
            self.purge_calls += 1

    executor = _IdempotentPurgeExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-purge-db-recovery",
        settings=_worker_settings(tmp_path),
        repository=repository,
        executor=executor,
    )
    real_mark_purged = repository.mark_session_purged
    mark_calls = 0

    def fail_first_final_cas(*, session_id, purge_token, now):
        nonlocal mark_calls
        mark_calls += 1
        if mark_calls == 1:
            raise RuntimeError("database unavailable after workspace deletion")
        return real_mark_purged(session_id=session_id, purge_token=purge_token, now=now)

    monkeypatch.setattr(repository, "mark_session_purged", fail_first_final_cas)

    # The periodic worker survives the post-delete DB failure. The durable row
    # remains leased rather than becoming an unrecoverable exception/crash.
    assert worker.purge_expired_once(now=now) == 0
    assert executor.purge_calls == 1
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxSession, original.id).status == "purging"

    # After the bounded lease timeout, another cycle retries only the same
    # token-fenced tombstone, then completes the final database CAS.
    assert worker.purge_expired_once(now=now + timedelta(minutes=6)) == 1
    assert executor.purge_calls == 2
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxSession, original.id).status == "purged"


def test_purged_session_is_atomically_resurrected_for_same_conversation(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)
    original = _create_session(
        repository,
        now=now - timedelta(days=31),
        expires_at=now - timedelta(days=1),
    )
    purge = repository.mark_session_for_purge(
        session_id=original.id,
        expected_last_activity_at=original.last_activity_at,
        now=now,
    )
    assert purge is not None and purge.purge_token
    assert repository.mark_session_purged(
        session_id=original.id,
        purge_token=purge.purge_token,
        now=now,
    )

    resurrected = repository.create_session(
        SandboxSessionRecord(
            id="new-session-id-must-not-be-inserted",
            conversation_id=original.conversation_id,
            user_id=original.user_id,
            workspace_key="new-workspace-key-must-not-be-used",
            status=SandboxSessionStatus.NEW,
            created_at=now + timedelta(seconds=1),
            last_activity_at=now + timedelta(seconds=1),
            expires_at=now + timedelta(days=30),
            credential_ref="",
        )
    )

    assert resurrected.id == original.id
    assert resurrected.workspace_key == original.workspace_key
    assert resurrected.status is SandboxSessionStatus.NEW
    assert resurrected.opencode_session_id is None
    with appdb_db.app_session(database_url) as db:
        sessions = list(
            db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.conversation_id == original.conversation_id
                )
            ).scalars()
        )
        assert len(sessions) == 1


def test_purge_revokes_session_permissions_before_resurrection(queue_runtime, monkeypatch) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    now = datetime(2026, 8, 15, 12, 30, tzinfo=timezone.utc)
    original = _create_session(repository, now=now - timedelta(days=31))
    old_job = repository.reserve_job(_job(job_id="job-old-permission", now=now))
    assert repository.activate_prepared_job(job_id=old_job.id, user_id=111, now=now)
    assert repository.claim_next_job(worker_id="worker-permission-old", now=now)
    assert repository.mark_job_running(
        job_id=old_job.id,
        worker_id="worker-permission-old",
        now=now,
    )
    assert repository.complete_job(
        job_id=old_job.id,
        worker_id="worker-permission-old",
        result={},
        now=now,
    )
    with appdb_db.app_session(database_url) as db:
        current_session = db.get(AppAiSandboxSession, original.id)
        current_session.last_activity_at = now - timedelta(days=31)
        current_session.expires_at = now - timedelta(days=1)
        approved = AppAiSandboxPermission(
            id="permission-session-approved",
            session_id=original.id,
            job_id=old_job.id,
            user_id=111,
            opencode_permission_id="opencode-old-approved",
            tool="edit",
            operation="edit src/report.py",
            arguments_preview_json='{"path":"src/report.py"}',
            status="approved",
            grant_scope="session",
            responded_by_user_id=111,
            requested_at=now - timedelta(days=31),
            responded_at=now - timedelta(days=31),
            created_at=now - timedelta(days=31),
            updated_at=now - timedelta(days=31),
        )
        pending_action = AppAiPendingAction(
            id="action-pending-before-purge",
            action_type="ai.sandbox.permission",
            status="pending",
            conversation_id=original.conversation_id,
            run_id=old_job.id,
            message_id="message-old-card",
            requester_user_id=111,
            payload_json='{"permission_id":"permission-pending-before-purge"}',
            preview_json="{}",
            result_json="{}",
            expires_at=now + timedelta(minutes=15),
            created_at=now,
            updated_at=now,
        )
        pending = AppAiSandboxPermission(
            id="permission-pending-before-purge",
            session_id=original.id,
            job_id=old_job.id,
            user_id=111,
            opencode_permission_id="opencode-old-pending",
            tool="bash",
            operation="pytest -q",
            arguments_preview_json='{"command":"pytest -q"}',
            action_id=pending_action.id,
            status="pending",
            requested_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add_all((approved, pending_action, pending))
        expected_last_activity_at = current_session.last_activity_at

    purge = repository.mark_session_for_purge(
        session_id=original.id,
        expected_last_activity_at=expected_last_activity_at,
        now=now,
    )
    assert purge is not None and purge.purge_token
    assert repository.mark_session_purged(
        session_id=original.id,
        purge_token=purge.purge_token,
        now=now,
    )
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxPermission, approved.id).status == "expired"
        assert db.get(AppAiSandboxPermission, approved.id).grant_scope is None
        assert db.get(AppAiSandboxPermission, pending.id).status == "expired"
        assert db.get(AppAiPendingAction, pending_action.id).status == "cancelled"

    resurrected = repository.create_session(
        SandboxSessionRecord(
            id="unused-resurrected-id",
            conversation_id=original.conversation_id,
            user_id=111,
            workspace_key="unused-resurrected-workspace",
            status=SandboxSessionStatus.NEW,
            created_at=now + timedelta(seconds=1),
            last_activity_at=now + timedelta(seconds=1),
            expires_at=now + timedelta(days=30),
            credential_ref="",
        )
    )
    new_job = repository.reserve_job(
        _job(
            job_id="job-new-permission",
            message_id="message-new-permission",
            now=now + timedelta(seconds=1),
        )
    )
    assert repository.activate_prepared_job(
        job_id=new_job.id,
        user_id=111,
        now=now + timedelta(seconds=1),
    )
    assert repository.claim_next_job(
        worker_id="worker-permission-new",
        now=now + timedelta(seconds=1),
    )
    assert repository.mark_job_running(
        job_id=new_job.id,
        worker_id="worker-permission-new",
        now=now + timedelta(seconds=1),
    )

    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _worker_settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **_kwargs: None)
    created = service.create_permission_request(
        session_id=resurrected.id,
        job_id=new_job.id,
        opencode_permission_id="opencode-after-resurrection",
        tool="edit",
        operation="edit src/report.py",
        arguments_preview={"path": "src/report.py"},
        message_id="message-new-card",
    )

    assert created["status"] == "pending"
    assert created["scope"] is None


def test_retention_purges_expired_session_when_execution_feature_is_disabled(queue_runtime) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    now = datetime(2026, 8, 15, 13, 0, tzinfo=timezone.utc)
    original = _create_session(
        repository,
        now=now - timedelta(days=31),
        expires_at=now - timedelta(days=1),
    )

    class _SuccessfulPurgeExecutor(_RetryingPurgeExecutor):
        def purge_session(self, session):
            self.purge_calls += 1

    executor = _SuccessfulPurgeExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-retention-disabled",
        settings=_worker_settings(tmp_path, enabled=False),
        repository=repository,
        executor=executor,
    )

    assert worker.purge_expired_once(now=now) == 1
    assert executor.purge_calls == 1
    with appdb_db.app_session(database_url) as db:
        stored = db.get(AppAiSandboxSession, original.id)
        assert stored.status == "purged"


@pytest.mark.parametrize("stale_status", ("claimed", "running"))
def test_disabled_worker_cleans_stale_claim_without_requeue_or_execution(
    queue_runtime,
    stale_status: str,
) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    claimed_at = datetime(2026, 8, 15, 13, 15, tzinfo=timezone.utc)
    now = claimed_at + timedelta(minutes=10)
    _create_session(repository, now=claimed_at)
    job = repository.reserve_job(_job(job_id=f"job-disabled-{stale_status}", now=claimed_at))
    assert repository.activate_prepared_job(job_id=job.id, user_id=111, now=claimed_at)
    assert repository.claim_next_job(worker_id="worker-crashed", now=claimed_at)
    if stale_status == "running":
        assert repository.mark_job_running(
            job_id=job.id,
            worker_id="worker-crashed",
            now=claimed_at,
        )

    class _CleanupOnlyExecutor(_RetryingPurgeExecutor):
        def __init__(self) -> None:
            super().__init__()
            self.abort_calls: list[str] = []
            self.execute_calls = 0

        def execute(self, *args, **kwargs):
            self.execute_calls += 1
            raise AssertionError("disabled recovery must never replay OpenCode")

        def abort_job(self, stale_job):
            self.abort_calls.append(stale_job.id)

    executor = _CleanupOnlyExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-disabled-cleanup",
        settings=_worker_settings(tmp_path, enabled=False),
        repository=repository,
        executor=executor,
    )

    assert worker.run_once(now=now).outcome == "disabled"
    assert executor.execute_calls == 0
    assert executor.abort_calls == [job.id]
    assert repository.claim_next_job(worker_id="worker-must-not-claim", now=now) is None
    with appdb_db.app_session(database_url) as db:
        stored_job = db.get(AppAiSandboxJob, job.id)
        stored_session = db.get(AppAiSandboxSession, "session-queue-1")
        assert stored_job.status == "failed"
        assert stored_job.error_code in {
            "sandbox_disabled_recovery",
            "worker_heartbeat_stale",
        }
        assert stored_session.status == "stopped"


@pytest.mark.parametrize("unstarted_status", ("preparing", "queued"))
def test_disabled_worker_terminalizes_unstarted_job_before_reenable(
    queue_runtime,
    unstarted_status: str,
) -> None:
    database_url, appdb_db, repository, tmp_path = queue_runtime
    now = datetime(2026, 8, 15, 13, 45, tzinfo=timezone.utc)
    _create_session(repository, now=now)
    job = repository.reserve_job(_job(job_id=f"job-disabled-{unstarted_status}", now=now))
    if unstarted_status == "queued":
        assert repository.activate_prepared_job(job_id=job.id, user_id=111, now=now)

    class _NeverExecute(_RetryingPurgeExecutor):
        def __init__(self) -> None:
            super().__init__()
            self.execute_calls = 0

        def execute(self, *args, **kwargs):
            self.execute_calls += 1
            raise AssertionError("disabled worker must not execute pending work")

    executor = _NeverExecute()
    worker = AiSandboxWorker(
        worker_id="worker-disabled-unstarted",
        settings=_worker_settings(tmp_path, enabled=False),
        repository=repository,
        executor=executor,
    )

    assert worker.run_once(now=now + timedelta(seconds=1)).outcome == "disabled"
    assert executor.execute_calls == 0
    assert repository.claim_next_job(
        worker_id="worker-after-reenable",
        now=now + timedelta(seconds=2),
    ) is None
    with appdb_db.app_session(database_url) as db:
        stored_job = db.get(AppAiSandboxJob, job.id)
        stored_session = db.get(AppAiSandboxSession, "session-queue-1")
        assert stored_job.status == "failed"
        assert stored_job.error_code == "sandbox_disabled"
        assert stored_session.status == "stopped"


def test_purge_and_enqueue_interleavings_never_delete_an_active_workspace(queue_runtime) -> None:
    database_url, appdb_db, repository, _ = queue_runtime
    now = datetime(2026, 8, 15, 14, 0, tzinfo=timezone.utc)
    original = _create_session(
        repository,
        now=now - timedelta(days=31),
        expires_at=now - timedelta(days=1),
    )

    # If PREPARING wins the session-row serialization, purge cannot start.
    active = repository.reserve_job(_job(job_id="job-before-purge", now=now))
    assert active.status is SandboxJobStatus.PREPARING
    assert not repository.mark_session_for_purge(
        session_id=original.id,
        expected_last_activity_at=original.last_activity_at,
        now=now,
    )
    assert repository.fail_prepared_job(
        job_id=active.id,
        user_id=original.user_id,
        error_code="test_cleanup",
        now=now,
    )

    # If PURGING wins, every reusable/touch/reserve path fails closed until
    # the purge finishes; no new job can appear under a deleted workspace.
    purge = repository.mark_session_for_purge(
        session_id=original.id,
        expected_last_activity_at=original.last_activity_at,
        now=now + timedelta(seconds=1),
    )
    assert purge is not None and purge.purge_token
    assert repository.get_session_for_conversation(
        conversation_id=original.conversation_id,
        user_id=original.user_id,
    ) is None
    assert not repository.touch_session(
        session_id=original.id,
        user_id=original.user_id,
        now=now + timedelta(seconds=1),
        expires_at=now + timedelta(days=30),
    )
    with pytest.raises(SandboxRepositoryConflict):
        repository.reserve_job(
            _job(
                job_id="job-during-purge",
                message_id="message-during-purge",
                now=now + timedelta(seconds=1),
            )
        )
    stale = repository.recover_stale_purging_sessions(
        now=now + timedelta(minutes=7),
        stale_after=timedelta(minutes=5),
        limit=10,
    )
    assert [(item.id, item.status, item.purge_token) for item in stale] == [
        (original.id, SandboxSessionStatus.PURGING, purge.purge_token)
    ]
    with pytest.raises(SandboxRepositoryConflict):
        repository.reserve_job(
            _job(
                job_id="job-after-purge-lease-timeout",
                message_id="message-after-purge-lease-timeout",
                now=now + timedelta(minutes=7),
            )
        )
    assert repository.mark_session_purged(
        session_id=original.id,
        purge_token=purge.purge_token,
        now=now + timedelta(seconds=2),
    )
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxSession, original.id).status == "purged"
        assert db.get(AppAiSandboxJob, "job-during-purge") is None
