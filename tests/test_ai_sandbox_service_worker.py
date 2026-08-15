from __future__ import annotations

import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.contracts import (  # noqa: E402
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
)
from backend.ai_sandbox.service import (  # noqa: E402
    AiSandboxService,
    EnqueueSandboxRun,
    SandboxDisabledError,
)
from backend.ai_sandbox.worker import AiSandboxWorker  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("c" * 64)


class FakeRepository:
    def __init__(self) -> None:
        self.session = None
        self.job = None
        self.failed = []
        self.completed = []
        self.inputs = []

    def create_session(self, session):
        self.session = session
        return session

    def get_session_for_conversation(self, *, conversation_id, user_id):
        if self.session and self.session.conversation_id == conversation_id and self.session.user_id == user_id:
            return self.session
        return None

    def reserve_job(self, job):
        self.job = job
        return job

    def activate_prepared_job(self, *, job_id, user_id, now):
        if self.job and self.job.id == job_id and self.job.user_id == user_id:
            self.job = replace(self.job, status=SandboxJobStatus.QUEUED)
            return self.job
        return None

    def fail_prepared_job(self, *, job_id, user_id, error_code, now):
        if self.job and self.job.id == job_id and self.job.user_id == user_id:
            self.job = replace(self.job, status=SandboxJobStatus.FAILED)
            self.failed.append({"job_id": job_id, "error_code": error_code})
            return True
        return False

    def replace_job_inputs(self, *, job_id, user_id, inputs, now):
        self.inputs = list(inputs)

    def touch_session(self, *, session_id, user_id, now, expires_at):
        if self.session and self.session.id == session_id and self.session.user_id == user_id:
            self.session = replace(self.session, last_activity_at=now, expires_at=expires_at)
            return True
        return False

    def get_job_for_user(self, *, job_id, user_id):
        if self.job and self.job.id == job_id and self.job.user_id == user_id:
            return self.job
        return None

    def cancel_job(self, *, job_id, user_id, now):
        if self.job and self.job.id == job_id and self.job.user_id == user_id:
            self.job = replace(self.job, status=SandboxJobStatus.CANCELLED)
            return True
        return False

    def reap_stale_jobs(self, **kwargs):
        return []

    def claim_next_job(self, *, worker_id, now):
        return self.job

    def mark_job_running(self, *, job_id, worker_id, now):
        if self.job and self.job.id == job_id:
            self.job = replace(
                self.job,
                status=SandboxJobStatus.RUNNING,
                claimed_by=worker_id,
                claimed_at=now,
            )
            return True
        return False

    def heartbeat_job(self, *, job_id, worker_id, now):
        return bool(self.job and self.job.id == job_id)

    def fail_job(self, **kwargs):
        self.failed.append(kwargs)
        return True

    def begin_job_finalization(self, *, job_id, worker_id, result, now):
        if not self.job or self.job.id != job_id or self.job.claimed_by != worker_id:
            return False
        pending = dict(result.get("_pending_finalize") or {})
        durable_result = {key: value for key, value in result.items() if key != "_pending_finalize"}
        self.job = replace(
            self.job,
            status=SandboxJobStatus.FINALIZING,
            result=durable_result,
            finalization_state="pending",
            finalization_markdown=str(pending.get("assistant_markdown") or ""),
        )
        return True

    def complete_job(self, **kwargs):
        self.completed.append(kwargs)
        if self.job and self.job.id == kwargs["job_id"]:
            self.job = replace(
                self.job,
                status=SandboxJobStatus.SUCCEEDED,
                result=kwargs.get("result", self.job.result),
                finalization_state="published",
            )
        return True

    def list_expired_sessions(self, *, now, limit):
        return []

    def release_session_purge(self, *, session_id, now):
        return True


class FakeExecutor:
    def __init__(self, repository: FakeRepository | None = None) -> None:
        self.repository = repository
        self.calls = []

    def execute(self, job, *, command_timeout_seconds, response_timeout_seconds):
        self.calls.append((job.id, command_timeout_seconds, response_timeout_seconds))
        return {"files": []}

    def purge_session(self, session):
        return None

    def abort_job(self, job):
        return None

    def finalize_job(self, job):
        if self.repository is None:
            raise AssertionError("finalization repository is unavailable")
        self.repository.complete_job(
            job_id=job.id,
            worker_id=job.claimed_by,
            result=job.result,
        )

    def notify_job_state(self, job_id):
        return None


def _settings(tmp_path: Path, *, enabled: bool = True) -> SandboxSettings:
    return SandboxSettings(
        enabled=enabled,
        image=PINNED_TEST_IMAGE if enabled else "",
        workspace_root=tmp_path / "workspaces",
        runtime_secret_root=tmp_path / "secrets",
        seccomp_profile=tmp_path / "seccomp.json",
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


def test_service_lazily_creates_session_without_personal_memory(tmp_path: Path) -> None:
    repository = FakeRepository()
    service = AiSandboxService(
        settings=_settings(tmp_path),
        repository=repository,
    )
    now = datetime(2026, 8, 15, tzinfo=timezone.utc)
    status = service.enqueue(
        EnqueueSandboxRun(conversation_id="conversation-1", user_id=10, prompt_message_id="message-1"),
        now=now,
    )

    assert status.status is SandboxJobStatus.QUEUED
    assert repository.session.inherits_personal_memory is False
    assert repository.session.expires_at == now + timedelta(days=30)
    assert repository.job.deadline_at == now + timedelta(minutes=15)

    service.enqueue(
        EnqueueSandboxRun(conversation_id="conversation-1", user_id=10, prompt_message_id="message-2"),
        now=now,
    )


def test_service_is_fail_closed_when_feature_is_disabled(tmp_path: Path) -> None:
    service = AiSandboxService(
        settings=_settings(tmp_path, enabled=False),
        repository=FakeRepository(),
    )
    with pytest.raises(SandboxDisabledError):
        service.enqueue(EnqueueSandboxRun("conversation", 1, "message"))


def test_worker_passes_exact_timeouts_and_completes_claim(tmp_path: Path) -> None:
    repository = FakeRepository()
    now = datetime(2026, 8, 15, tzinfo=timezone.utc)
    repository.job = SandboxJobRecord(
        id="job-1",
        session_id="session-1",
        conversation_id="conversation-1",
        user_id=10,
        prompt_message_id="message-1",
        status=SandboxJobStatus.QUEUED,
        created_at=now,
        deadline_at=now + timedelta(minutes=15),
    )
    executor = FakeExecutor(repository)
    worker = AiSandboxWorker(
        worker_id="worker-1",
        settings=_settings(tmp_path),
        repository=repository,
        executor=executor,
    )
    result = worker.run_once(now=now)

    assert result.outcome == "succeeded"
    assert executor.calls == [("job-1", 120, 900)]
    assert repository.completed[0]["job_id"] == "job-1"


def test_worker_expires_job_before_execution(tmp_path: Path) -> None:
    repository = FakeRepository()
    now = datetime(2026, 8, 15, tzinfo=timezone.utc)
    repository.job = SandboxJobRecord(
        id="job-expired",
        session_id="session-1",
        conversation_id="conversation-1",
        user_id=10,
        prompt_message_id="message-1",
        status=SandboxJobStatus.QUEUED,
        created_at=now - timedelta(minutes=16),
        deadline_at=now - timedelta(seconds=1),
    )
    executor = FakeExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-1",
        settings=_settings(tmp_path),
        repository=repository,
        executor=executor,
    )

    assert worker.run_once(now=now).outcome == "expired"
    assert executor.calls == []
    assert repository.failed[0]["error_code"] == "deadline_expired"
