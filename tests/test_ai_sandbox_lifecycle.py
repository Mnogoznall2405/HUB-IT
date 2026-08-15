from __future__ import annotations

import importlib
import json
import os
import signal
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

from backend.ai_sandbox import app_service as sandbox_app_service  # noqa: E402
from backend.ai_sandbox import executor as executor_module  # noqa: E402
from backend.ai_sandbox.app_service import AiSandboxAppService  # noqa: E402
from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.contracts import (  # noqa: E402
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
    WorkspaceLease,
)
from backend.ai_sandbox.executor import ConcreteSandboxJobExecutor  # noqa: E402
from backend.ai_sandbox.models import AppAiSandboxJob, AppAiSandboxSession  # noqa: E402
from backend.ai_sandbox.sqlalchemy_repository import SqlAlchemySandboxQueueRepository  # noqa: E402
from backend.ai_sandbox.transfer import SandboxJobManifest  # noqa: E402
from backend.ai_sandbox.worker import AiSandboxWorker  # noqa: E402
from backend.appdb.models import AppAiBot, AppAiBotConversation  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("8" * 64)


def _settings(tmp_path: Path, *, enabled: bool = True) -> SandboxSettings:
    workspace_root = tmp_path / "workspaces"
    workspace_root.mkdir(exist_ok=True)
    seccomp = tmp_path / "seccomp.json"
    seccomp.write_text("{}", encoding="utf-8")
    return SandboxSettings(
        enabled=enabled,
        image=PINNED_TEST_IMAGE if enabled else "",
        workspace_root=workspace_root,
        runtime_secret_root=tmp_path / "runtime-secrets",
        seccomp_profile=seccomp,
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


def _configure_app_database(tmp_path: Path, monkeypatch) -> tuple[str, object]:
    database_url = f"sqlite:///{(tmp_path / 'sandbox_lifecycle.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    appdb_db.initialize_app_schema(database_url)
    return database_url, appdb_db


def _repository(*, database_url: str, appdb_db) -> SqlAlchemySandboxQueueRepository:
    return SqlAlchemySandboxQueueRepository(
        session_provider=lambda: appdb_db.app_session(database_url)
    )


def _seed_bot_mapping(*, database_url: str, appdb_db, now: datetime) -> None:
    with appdb_db.app_session(database_url) as db:
        db.add(
            AppAiBot(
                id="bot-lifecycle",
                slug="opencode-lifecycle",
                title="OpenCode",
                system_prompt="workspace only",
                model="",
                surface="sandbox",
                placement="pinned",
                required_permission="chat.ai.sandbox",
                use_personal_memory=False,
                is_enabled=True,
                bot_user_id=999,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiBotConversation(
                bot_id="bot-lifecycle",
                user_id=171,
                conversation_id="conversation-lifecycle",
                use_personal_memory=False,
                created_at=now,
                updated_at=now,
            )
        )


def _seed_queued_job(
    repository: SqlAlchemySandboxQueueRepository,
    *,
    now: datetime,
) -> SandboxJobRecord:
    repository.create_session(
        SandboxSessionRecord(
            id="session-lifecycle",
            conversation_id="conversation-lifecycle",
            user_id=171,
            workspace_key="ws-" + ("2" * 32),
            status=SandboxSessionStatus.READY,
            created_at=now,
            last_activity_at=now,
            expires_at=now + timedelta(days=30),
            credential_ref="",
        )
    )
    reserved = repository.reserve_job(
        SandboxJobRecord(
            id="job-lifecycle",
            session_id="session-lifecycle",
            conversation_id="conversation-lifecycle",
            user_id=171,
            prompt_message_id="message-lifecycle",
            status=SandboxJobStatus.PREPARING,
            created_at=now,
            deadline_at=now + timedelta(minutes=15),
        )
    )
    queued = repository.activate_prepared_job(job_id=reserved.id, user_id=171, now=now)
    assert queued is not None
    return queued


class _LifecycleExecutor:
    def __init__(self, *, service: AiSandboxAppService | None = None) -> None:
        self.service = service
        self.execute_calls: list[str] = []
        self.finalize_jobs: list[SandboxJobRecord] = []
        self.abort_calls: list[str] = []
        self.notifications: list[str] = []
        self.abort_should_fail = False

    def execute(self, job, **kwargs):
        self.execute_calls.append(job.id)
        return {
            "worker_result": "durable",
            "_pending_finalize": {"assistant_markdown": "Deterministic success"},
        }

    def finalize_job(self, job: SandboxJobRecord) -> None:
        self.finalize_jobs.append(job)
        if self.service is None:
            raise AssertionError("finalization service is unavailable")
        self.service.finalize_worker_result(
            job_id=job.id,
            assistant_markdown="worker retry must not replace durable markdown",
        )

    def abort_job(self, job: SandboxJobRecord) -> None:
        self.abort_calls.append(job.id)
        if self.abort_should_fail:
            raise RuntimeError("container stop failed")

    def notify_job_state(self, job_id: str) -> None:
        self.notifications.append(job_id)

    def purge_session(self, session) -> None:
        return None


def _finalization_service(tmp_path: Path, monkeypatch) -> tuple[AiSandboxAppService, list[dict]]:
    service = AiSandboxAppService()
    settings = _settings(tmp_path)
    send_calls: list[dict] = []
    monkeypatch.setattr(service, "settings", lambda: settings)
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)

    def send_message(**kwargs):
        send_calls.append(kwargs)
        return {"id": "assistant-message-stable"}

    monkeypatch.setattr(sandbox_app_service.chat_service, "send_message", send_message)
    action_cards = importlib.import_module("backend.ai_chat.action_cards")
    ai_chat = importlib.import_module("backend.ai_chat.service")
    monkeypatch.setattr(action_cards, "attach_run_actions_to_message", lambda **kwargs: None)
    monkeypatch.setattr(
        ai_chat.ai_chat_service,
        "_enqueue_message_side_effects_after_send",
        lambda **kwargs: None,
    )
    return service, send_calls


def test_durable_finalizing_marker_is_deterministically_published_then_succeeded(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 14, 0, tzinfo=timezone.utc)
    _seed_bot_mapping(database_url=database_url, appdb_db=appdb_db, now=now)
    repository = _repository(database_url=database_url, appdb_db=appdb_db)
    _seed_queued_job(repository, now=now)
    service, send_calls = _finalization_service(tmp_path, monkeypatch)
    executor = _LifecycleExecutor(service=service)
    worker = AiSandboxWorker(
        worker_id="worker-lifecycle",
        settings=_settings(tmp_path),
        repository=repository,
        executor=executor,
    )

    result = worker.run_once(now=now)

    assert result.outcome == "succeeded"
    assert executor.execute_calls == ["job-lifecycle"]
    assert len(executor.finalize_jobs) == 1
    durable = executor.finalize_jobs[0]
    assert durable.status is SandboxJobStatus.FINALIZING
    assert durable.finalization_state == "pending"
    assert durable.finalization_markdown == "Deterministic success"
    assert durable.result == {"worker_result": "durable"}
    with appdb_db.app_session(database_url) as db:
        stored = db.get(AppAiSandboxJob, "job-lifecycle")
        assert stored.status == "succeeded"
        assert stored.finalization_state == "published"
        assert stored.finalization_markdown == ""
        assert stored.assistant_message_id == "assistant-message-stable"
        assert json.loads(stored.result_json)["delivery_state"] == "published"
        assert db.get(AppAiSandboxSession, "session-lifecycle").status == "stopped"

    replay = service.finalize_worker_result(
        job_id="job-lifecycle",
        assistant_markdown="different replay text",
    )
    assert replay["message_id"] == "assistant-message-stable"
    assert len(send_calls) == 1
    assert send_calls[0]["body"] == "Deterministic success"


def test_stale_finalizing_job_replays_only_finalizer_never_execute(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 14, 30, tzinfo=timezone.utc)
    _seed_bot_mapping(database_url=database_url, appdb_db=appdb_db, now=now)
    repository = _repository(database_url=database_url, appdb_db=appdb_db)
    queued = _seed_queued_job(repository, now=now)
    assert repository.claim_next_job(worker_id="dead-worker", now=now)
    assert repository.mark_job_running(job_id=queued.id, worker_id="dead-worker", now=now)
    assert repository.begin_job_finalization(
        job_id=queued.id,
        worker_id="dead-worker",
        result={
            "worker_result": "already executed",
            "_pending_finalize": {"assistant_markdown": "Recovered success"},
        },
        now=now,
    )
    service, send_calls = _finalization_service(tmp_path, monkeypatch)
    executor = _LifecycleExecutor(service=service)
    worker = AiSandboxWorker(
        worker_id="recovery-worker",
        settings=_settings(tmp_path),
        repository=repository,
        executor=executor,
    )

    result = worker.run_once(now=now + timedelta(minutes=1))

    assert result.outcome == "idle"
    assert executor.execute_calls == []
    assert [item.id for item in executor.finalize_jobs] == ["job-lifecycle"]
    assert len(send_calls) == 1
    with appdb_db.app_session(database_url) as db:
        stored = db.get(AppAiSandboxJob, "job-lifecycle")
        assert stored.status == "succeeded"
        assert stored.finalization_state == "published"


def test_cleanup_pending_remains_retryable_until_container_stop_succeeds(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 15, 0, tzinfo=timezone.utc)
    repository = _repository(database_url=database_url, appdb_db=appdb_db)
    queued = _seed_queued_job(repository, now=now)
    assert repository.claim_next_job(worker_id="worker-cleanup", now=now)
    assert repository.mark_job_running(job_id=queued.id, worker_id="worker-cleanup", now=now)
    assert repository.mark_cleanup_pending(
        job_id=queued.id,
        worker_id="worker-cleanup",
        terminal_status="failed",
        error_code="sandbox_execution_failed",
        now=now,
    )
    executor = _LifecycleExecutor()
    executor.abort_should_fail = True
    worker = AiSandboxWorker(
        worker_id="worker-cleanup-retry",
        settings=_settings(tmp_path),
        repository=repository,
        executor=executor,
    )

    assert worker.run_once(now=now + timedelta(seconds=1)).outcome == "idle"
    with appdb_db.app_session(database_url) as db:
        pending = db.get(AppAiSandboxJob, "job-lifecycle")
        assert pending.status == "cleanup_pending"
        assert pending.cleanup_terminal_status == "failed"
        assert pending.completed_at is None
        assert db.get(AppAiSandboxSession, "session-lifecycle").status == "busy"

    executor.abort_should_fail = False
    assert worker.run_once(now=now + timedelta(seconds=2)).outcome == "idle"
    with appdb_db.app_session(database_url) as db:
        terminal = db.get(AppAiSandboxJob, "job-lifecycle")
        assert terminal.status == "failed"
        assert terminal.cleanup_terminal_status is None
        assert terminal.completed_at is not None
        assert db.get(AppAiSandboxSession, "session-lifecycle").status == "stopped"
    assert len(executor.abort_calls) >= 3
    assert executor.execute_calls == []


def test_cleanup_recovery_stops_batch_immediately_after_shutdown(tmp_path: Path) -> None:
    now = datetime(2026, 8, 15, 15, 15, tzinfo=timezone.utc)
    jobs = [
        SandboxJobRecord(
            id=f"cleanup-job-{index}",
            session_id=f"cleanup-session-{index}",
            conversation_id=f"cleanup-conversation-{index}",
            user_id=200 + index,
            prompt_message_id=f"cleanup-message-{index}",
            status=SandboxJobStatus.CLEANUP_PENDING,
            created_at=now,
            deadline_at=now + timedelta(minutes=15),
            cleanup_terminal_status="failed",
        )
        for index in (1, 2)
    ]
    completed: list[str] = []

    class _CleanupRepository:
        def list_cleanup_pending(self, *, limit):
            return jobs

        def complete_cleanup(self, *, job_id, now):
            completed.append(job_id)
            return True

    shutdown_event = threading.Event()

    class _StoppingExecutor:
        def __init__(self) -> None:
            self.abort_calls: list[str] = []

        def abort_job(self, job):
            self.abort_calls.append(job.id)
            shutdown_event.set()

        def notify_job_state(self, job_id):
            return None

    executor = _StoppingExecutor()
    worker = AiSandboxWorker(
        worker_id="worker-cleanup-shutdown",
        settings=_settings(tmp_path),
        repository=_CleanupRepository(),
        executor=executor,
        shutdown_event=shutdown_event,
    )

    assert worker._recover_cleanup_pending(limit=50) == 1
    assert executor.abort_calls == ["cleanup-job-1"]
    assert completed == ["cleanup-job-1"]


class _WorkspaceProvisioner:
    def __init__(self, lease: WorkspaceLease) -> None:
        self.lease = lease

    def provision(self, session: SandboxSessionRecord) -> WorkspaceLease:
        return self.lease


class _QuietTransfer:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def fetch_manifest(self, *, job_id: str) -> SandboxJobManifest:
        return SandboxJobManifest(
            job_id=job_id,
            conversation_id="conversation-lifecycle",
            job_type="prompt",
            target_file_id=None,
            target_file=None,
            prompt="wait quietly",
            inputs=(),
        )


class _QuietWorkerControl:
    def __init__(self) -> None:
        self.status_calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def publish_status(self, *, job_id: str):
        self.status_calls.append(job_id)
        return {"job_id": job_id}


class _QuietOpenCodeControl:
    def __init__(self) -> None:
        self.events_started = threading.Event()
        self.interrupted = threading.Event()
        self.abort_calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.interrupt_events()
        return None

    def create_session(self, **kwargs):
        return {"id": "opencode-quiet-session"}

    def prompt_async(self, **kwargs):
        return None

    def events(self):
        self.events_started.set()
        while not self.interrupted.wait(timeout=10.0):
            if False:  # pragma: no cover - keeps this a quiet generator
                yield {}

    def interrupt_events(self) -> None:
        self.interrupted.set()

    def abort(self, *, session_id: str) -> None:
        self.abort_calls.append(session_id)

    def get_diff(self, **kwargs):  # pragma: no cover - shutdown occurs first
        raise AssertionError("diff must not be requested during shutdown")


class _RuntimeRunner:
    def __init__(self) -> None:
        self.stop_calls: list[str] = []

    def start(self, spec):
        return "container-id"

    def control_target(self, container_name: str):
        return SimpleNamespace(host="127.0.0.1", port=49152)

    def stop(self, container_name: str) -> None:
        self.stop_calls.append(container_name)


class _GatewayBroker:
    def __init__(self) -> None:
        self.revoked: list[tuple[str, str]] = []
        self.revoked_jobs: list[str] = []

    def issue(self, **kwargs):
        token = SimpleNamespace(reveal=lambda: "g" * 48)
        return SimpleNamespace(id="gateway-grant", token=token)

    def revoke(self, *, grant_id: str, job_id: str):
        self.revoked.append((grant_id, job_id))
        return True

    def revoke_job(self, *, job_id: str):
        self.revoked_jobs.append(job_id)
        return 1


def test_shared_shutdown_event_interrupts_quiet_sse_and_leaves_durable_cleanup_for_next_worker(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 15, 30, tzinfo=timezone.utc)
    repository = _repository(database_url=database_url, appdb_db=appdb_db)
    _seed_queued_job(repository, now=now)
    settings = _settings(tmp_path)
    workspace = settings.workspace_root / ("ws-" + ("2" * 32))
    workspace.mkdir()
    shutdown_event = threading.Event()
    quiet_transfer = _QuietTransfer()
    worker_control = _QuietWorkerControl()
    opencode_control = _QuietOpenCodeControl()
    runtime = _RuntimeRunner()
    gateway = _GatewayBroker()
    monkeypatch.setattr(executor_module, "SandboxContentTransferClient", lambda **kwargs: quiet_transfer)
    monkeypatch.setattr(executor_module, "SandboxWorkerControlClient", lambda **kwargs: worker_control)
    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=repository,
        workspace_provisioner=_WorkspaceProvisioner(
            WorkspaceLease(
                session_id="session-lifecycle",
                path=workspace,
                quota_bytes=1024**3,
                quota_verified=True,
            )
        ),
        runtime_runner=runtime,
        gateway_broker=gateway,
        transfer_credentials=object(),
        control_client_factory=lambda **kwargs: opencode_control,
        shutdown_event=shutdown_event,
    )
    worker = AiSandboxWorker(
        worker_id="worker-shutdown",
        settings=settings,
        repository=repository,
        executor=executor,
        shutdown_event=shutdown_event,
    )

    def simulate_sigterm() -> None:
        assert opencode_control.events_started.wait(timeout=5)
        shutdown_event.set()

    trigger = threading.Thread(target=simulate_sigterm, daemon=True)
    trigger.start()
    started = time.monotonic()
    result = worker.run_once(now=now)
    elapsed = time.monotonic() - started
    trigger.join(timeout=1)

    assert result.outcome == "stopping"
    assert elapsed < 5
    assert opencode_control.interrupted.is_set()
    assert opencode_control.abort_calls
    assert len(runtime.stop_calls) == 1
    assert gateway.revoked == [("gateway-grant", "job-lifecycle")]
    assert gateway.revoked_jobs == []
    assert not list(settings.runtime_secret_root.glob("*.env"))
    with appdb_db.app_session(database_url) as db:
        job = db.get(AppAiSandboxJob, "job-lifecycle")
        assert job.status == "cleanup_pending"
        assert job.cleanup_terminal_status == "failed"
        assert job.error_code == "worker_shutdown"
        assert job.completed_at is None
        assert db.get(AppAiSandboxSession, "session-lifecycle").status == "busy"

    # The executor performed its own best-effort stop. Once SIGTERM is set the
    # terminating worker must not start a second cleanup batch and delay the
    # supervisor; a fresh worker consumes the durable cleanup record.
    recovery_worker = AiSandboxWorker(
        worker_id="worker-after-shutdown",
        settings=settings,
        repository=repository,
        executor=executor,
        shutdown_event=threading.Event(),
    )
    assert recovery_worker.run_once(now=now + timedelta(seconds=1)).outcome == "idle"
    assert len(runtime.stop_calls) == 2
    assert gateway.revoked_jobs == ["job-lifecycle"]
    with appdb_db.app_session(database_url) as db:
        job = db.get(AppAiSandboxJob, "job-lifecycle")
        assert job.status == "failed"
        assert job.cleanup_terminal_status is None
        assert job.completed_at is not None
        assert db.get(AppAiSandboxSession, "session-lifecycle").status == "stopped"


def test_sigterm_handler_sets_the_same_event_used_by_worker(monkeypatch) -> None:
    worker_main = importlib.import_module("backend.ai_sandbox_worker_main")
    handlers: dict[signal.Signals, object] = {}
    captured: dict[str, object] = {}

    class _MainWorker:
        def __init__(self, shutdown_event: threading.Event) -> None:
            self.shutdown_event = shutdown_event
            self.shutdown_calls = 0
            self.purge_calls = 0

        def request_shutdown(self) -> None:
            self.shutdown_calls += 1
            self.shutdown_event.set()

        def run_once(self):
            handlers[signal.SIGTERM](signal.SIGTERM, None)
            return SimpleNamespace(outcome="stopping")

        def purge_expired_once(self, **kwargs):
            self.purge_calls += 1
            return 0

    def build_worker(**kwargs):
        captured.update(kwargs)
        worker = _MainWorker(kwargs["shutdown_event"])
        captured["worker"] = worker
        return worker

    monkeypatch.setattr(worker_main, "build_worker", build_worker)
    monkeypatch.setattr(worker_main.signal, "signal", lambda kind, callback: handlers.__setitem__(kind, callback))

    assert worker_main.main(["--once", "--worker-id", "sigterm-test"]) == 0
    worker = captured["worker"]
    assert captured["shutdown_event"] is worker.shutdown_event
    assert worker.shutdown_calls == 1
    assert worker.shutdown_event.is_set()
    assert worker.purge_calls == 0
