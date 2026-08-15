from __future__ import annotations

import hashlib
import importlib
import os
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

from backend.ai_sandbox import app_service as app_service_module  # noqa: E402
from backend.ai_sandbox import executor as executor_module  # noqa: E402
from backend.ai_sandbox.app_service import AiSandboxAppService  # noqa: E402
from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.contracts import (  # noqa: E402
    SandboxExecutionCancelled,
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
    WorkspaceLease,
)
from backend.ai_sandbox.executor import ConcreteSandboxJobExecutor  # noqa: E402
from backend.ai_sandbox.models import (  # noqa: E402
    AppAiSandboxFile,
    AppAiSandboxJob,
    AppAiSandboxPermission,
    AppAiSandboxSession,
    AppAiSandboxTransferGrant,
)
from backend.ai_sandbox.transfer import SandboxJobManifest, SandboxTransferError  # noqa: E402
from backend.appdb.models import AppAiBot, AppAiBotConversation, AppAiPendingAction  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("9" * 64)


def _settings(tmp_path: Path) -> SandboxSettings:
    workspace_root = tmp_path / "workspaces"
    workspace_root.mkdir(exist_ok=True)
    seccomp = tmp_path / "seccomp.json"
    seccomp.write_text("{}", encoding="utf-8")
    return SandboxSettings(
        enabled=True,
        image=PINNED_TEST_IMAGE,
        workspace_root=workspace_root,
        runtime_secret_root=tmp_path / "runtime-secrets",
        seccomp_profile=seccomp,
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


class _ExecutorRepository:
    def __init__(self, session: SandboxSessionRecord) -> None:
        self.session = session

    def get_session_for_user(self, session_id: str, user_id: int):
        if session_id == self.session.id and user_id == self.session.user_id:
            return self.session
        return None


class _WorkspaceProvisioner:
    def __init__(self, lease: WorkspaceLease) -> None:
        self.lease = lease

    def provision(self, session: SandboxSessionRecord) -> WorkspaceLease:
        return self.lease


class _FailingSecondUploadTransfer:
    def __init__(self) -> None:
        self.upload_calls: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def fetch_manifest(self, *, job_id: str) -> SandboxJobManifest:
        return SandboxJobManifest(
            job_id=job_id,
            conversation_id="conversation-two-phase",
            job_type="prompt",
            target_file_id=None,
            target_file=None,
            prompt="create two files",
            inputs=(),
        )

    def request_output_grant(self, *, job_id: str, file_id: str):
        return {"job_id": job_id, "file_id": file_id}

    def upload_output(self, *, grant, source: Path):
        self.upload_calls.append(source.name)
        if len(self.upload_calls) == 2:
            raise SandboxTransferError("second output upload failed")
        return {"message_id": "file-message-1", "attachment_id": "attachment-1"}


class _RecordingWorkerControl:
    def __init__(self, *, job_states: list[str] | None = None) -> None:
        self.record_calls: list[dict] = []
        self.finalize_calls: list[dict] = []
        self.job_states = list(job_states or [])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def record_result(self, **kwargs):
        self.record_calls.append(kwargs)
        return {
            "message_id": None,
            "files": [
                {**item, "id": f"stored-{index}"}
                for index, item in enumerate(kwargs["files"], start=1)
            ],
        }

    def get_job_state(self, *, job_id: str):
        status = self.job_states.pop(0) if self.job_states else "running"
        return {"job_id": job_id, "status": status}

    def finalize_result(self, **kwargs):
        self.finalize_calls.append(kwargs)
        return {"message_id": "assistant-success"}


def test_second_output_upload_failure_never_finalizes_or_publishes_assistant_success(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = _settings(tmp_path)
    # Keep the production workspace-key shape while using an isolated path.
    workspace = settings.workspace_root / ("ws-" + ("0" * 32))
    workspace.mkdir()
    now = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)
    session = SandboxSessionRecord(
        id="session-two-phase",
        conversation_id="conversation-two-phase",
        user_id=151,
        workspace_key="ws-" + ("0" * 32),
        status=SandboxSessionStatus.BUSY,
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=30),
        credential_ref="",
    )
    job = SandboxJobRecord(
        id="job-two-phase",
        session_id=session.id,
        conversation_id=session.conversation_id,
        user_id=session.user_id,
        prompt_message_id="message-two-phase",
        status=SandboxJobStatus.RUNNING,
        created_at=now,
        deadline_at=now + timedelta(minutes=15),
    )
    transfer = _FailingSecondUploadTransfer()
    worker_control = _RecordingWorkerControl()
    monkeypatch.setattr(
        executor_module,
        "SandboxContentTransferClient",
        lambda **kwargs: transfer,
    )
    monkeypatch.setattr(
        executor_module,
        "SandboxWorkerControlClient",
        lambda **kwargs: worker_control,
    )
    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=_ExecutorRepository(session),
        workspace_provisioner=_WorkspaceProvisioner(
            WorkspaceLease(
                session_id=session.id,
                path=workspace,
                quota_bytes=1024**3,
                quota_verified=True,
            )
        ),
        runtime_runner=object(),
        gateway_broker=object(),
        transfer_credentials=object(),
    )

    def complete_prompt(**kwargs):
        (workspace / "first.txt").write_text("first", encoding="utf-8")
        (workspace / "second.txt").write_text("second", encoding="utf-8")
        return "opencode-session", "assistant success", []

    monkeypatch.setattr(executor, "_execute_prompt_container", complete_prompt)

    with pytest.raises(SandboxTransferError, match="second output upload failed"):
        executor.execute(job, command_timeout_seconds=120, response_timeout_seconds=900)

    assert transfer.upload_calls == ["first.txt", "second.txt"]
    assert len(worker_control.record_calls) == 1
    assert worker_control.record_calls[0]["assistant_markdown"] == ""
    assert worker_control.finalize_calls == []


def test_executor_rechecks_durable_stop_before_each_output(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    workspace = settings.workspace_root / ("ws-" + ("f" * 32))
    workspace.mkdir()
    first = workspace / "first.txt"
    second = workspace / "second.txt"
    first.write_text("first", encoding="utf-8")
    second.write_text("second", encoding="utf-8")
    now = datetime(2026, 8, 15, 12, 30, tzinfo=timezone.utc)
    session = SandboxSessionRecord(
        id="session-output-stop",
        conversation_id="conversation-output-stop",
        user_id=151,
        workspace_key="ws-" + ("f" * 32),
        status=SandboxSessionStatus.BUSY,
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=30),
        credential_ref="",
    )
    job = SandboxJobRecord(
        id="job-output-stop",
        session_id=session.id,
        conversation_id=session.conversation_id,
        user_id=session.user_id,
        prompt_message_id="message-output-stop",
        status=SandboxJobStatus.RUNNING,
        created_at=now,
        deadline_at=now + timedelta(minutes=15),
    )
    transfer = _FailingSecondUploadTransfer()
    worker_control = _RecordingWorkerControl(
        job_states=["running", "running", "cleanup_pending"]
    )
    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=_ExecutorRepository(session),
        workspace_provisioner=_WorkspaceProvisioner(
            WorkspaceLease(session.id, workspace, 1024**3, True)
        ),
        runtime_runner=object(),
        gateway_broker=object(),
        transfer_credentials=object(),
    )
    outputs = [
        {
            "path": path.name,
            "name": path.name,
            "kind": "output",
            "content_type": "text/plain",
            "size_bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "changed": False,
            "diff": "",
        }
        for path in (first, second)
    ]

    with pytest.raises(SandboxExecutionCancelled, match="no longer accepts output"):
        executor._deliver_outputs(
            job=job,
            workspace=workspace,
            outputs=outputs,
            opencode_session_id="opencode-output-stop",
            assistant_markdown="",
            worker_control=worker_control,
            transfer=transfer,
        )

    assert transfer.upload_calls == ["first.txt"]


def _configure_app_database(tmp_path: Path, monkeypatch) -> tuple[str, object]:
    database_url = f"sqlite:///{(tmp_path / 'sandbox_two_phase.db').as_posix()}"
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


def _seed_result_job(*, database_url: str, appdb_db, now: datetime) -> None:
    with appdb_db.app_session(database_url) as db:
        db.add(
            AppAiBot(
                id="bot-two-phase",
                slug="opencode-two-phase",
                title="OpenCode",
                system_prompt="workspace only",
                model="",
                bot_user_id=9161,
                surface="sandbox",
                placement="pinned",
                required_permission="chat.ai.sandbox",
                use_personal_memory=False,
                is_enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiBotConversation(
                bot_id="bot-two-phase",
                user_id=161,
                conversation_id="conversation-manifest",
                use_personal_memory=False,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiSandboxSession(
                id="session-manifest",
                conversation_id="conversation-manifest",
                user_id=161,
                workspace_key="ws-" + ("1" * 32),
                status="busy",
                credential_ref="",
                last_activity_at=now,
                expires_at=now + timedelta(days=30),
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiSandboxJob(
                id="job-manifest",
                session_id="session-manifest",
                conversation_id="conversation-manifest",
                user_id=161,
                prompt_message_id="message-manifest",
                job_type="prompt",
                status="running",
                attempt=1,
                claimed_by="worker-manifest",
                claimed_at=now,
                heartbeat_at=now,
                deadline_at=now + timedelta(minutes=15),
                result_json="{}",
                error_code="",
                started_at=now,
                created_at=now,
                updated_at=now,
            )
        )


def _output(index: int) -> dict[str, object]:
    return {
        "path": f"output/result-{index}.txt",
        "name": f"result-{index}.txt",
        "kind": "output",
        "content_type": "text/plain",
        "size_bytes": index + 1,
        "sha256": f"{index:x}" * 64,
        "changed": False,
        "diff": "",
    }


def test_cumulative_sixth_output_is_rejected_and_cannot_receive_upload_grant(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 13, 0, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)

    first_manifest = service.record_worker_result(
        job_id="job-manifest",
        opencode_session_id="opencode-manifest",
        assistant_markdown="must not publish yet",
        files=[_output(index) for index in range(5)],
    )
    assert len(first_manifest["files"]) == 5
    valid_grant = service.issue_output_upload_grant(
        job_id="job-manifest",
        file_id=first_manifest["files"][0]["id"],
    )
    assert valid_grant["grant_id"]

    with pytest.raises(ValueError, match="at most 5 result files"):
        service.record_worker_result(
            job_id="job-manifest",
            opencode_session_id="opencode-manifest",
            assistant_markdown="must still not publish",
            files=[_output(5)],
        )

    with appdb_db.app_session(database_url) as db:
        assert db.scalar(
            select(func.count()).select_from(AppAiSandboxFile).where(
                AppAiSandboxFile.job_id == "job-manifest",
                AppAiSandboxFile.file_kind.in_(("output", "changed", "archive")),
            )
        ) == 5
        assert db.scalar(
            select(func.count()).select_from(AppAiSandboxFile).where(
                AppAiSandboxFile.job_id == "job-manifest",
                AppAiSandboxFile.relative_path == "output/result-5.txt",
            )
        ) == 0

    with pytest.raises(PermissionError, match="does not belong"):
        service.issue_output_upload_grant(
            job_id="job-manifest",
            file_id="unregistered-sixth-file",
        )
    with appdb_db.app_session(database_url) as db:
        assert db.scalar(
            select(func.count()).select_from(AppAiSandboxTransferGrant).where(
                AppAiSandboxTransferGrant.job_id == "job-manifest",
                AppAiSandboxTransferGrant.direction == "output_upload",
            )
        ) == 1


def test_stop_and_output_claim_have_one_linearizable_winner(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 13, 30, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)
    manifest = service.record_worker_result(
        job_id="job-manifest",
        opencode_session_id="opencode-manifest",
        assistant_markdown="",
        files=[_output(0)],
    )
    grant = service.issue_output_upload_grant(
        job_id="job-manifest",
        file_id=manifest["files"][0]["id"],
    )

    service.cancel_conversation(
        conversation_id="conversation-manifest",
        current_user_id=161,
    )
    with pytest.raises(PermissionError, match="unavailable"):
        service.claim_output_upload(
            grant_id=grant["grant_id"],
            raw_token=grant["token"],
        )
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxTransferGrant, grant["grant_id"]).status == "revoked"


def test_cancel_committed_after_grant_scope_read_cannot_be_hidden_by_session_identity_map(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 13, 35, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)
    manifest = service.record_worker_result(
        job_id="job-manifest",
        opencode_session_id="opencode-manifest",
        assistant_markdown="",
        files=[_output(0)],
    )
    grant = service.issue_output_upload_grant(
        job_id="job-manifest",
        file_id=manifest["files"][0]["id"],
    )

    scope_read = threading.Event()
    cancel_committed = threading.Event()
    real_app_session = app_service_module.app_session

    class _PausingClaimSession:
        """Open a deterministic race window without keeping SQLite's read lock."""

        def __init__(self, db) -> None:
            self._db = db
            self._paused = False

        def __getattr__(self, name):
            return getattr(self._db, name)

        def _pause_after_scope_read(self) -> None:
            if self._paused:
                return
            self._paused = True
            # PostgreSQL permits the cancelling writer to commit while this
            # transaction waits for the job lock. SQLite needs its read
            # transaction released to model the same interleaving.
            self._db.commit()
            scope_read.set()
            assert cancel_committed.wait(timeout=10), "cancel did not commit"

        def get(self, entity, ident, *args, **kwargs):
            value = self._db.get(entity, ident, *args, **kwargs)
            # This branch makes the regression fail against the former
            # implementation, which preloaded the grant ORM entity itself.
            if entity is AppAiSandboxTransferGrant and str(ident) == grant["grant_id"]:
                self._pause_after_scope_read()
            return value

        def execute(self, statement, *args, **kwargs):
            result = self._db.execute(statement, *args, **kwargs)
            selected = tuple(getattr(statement, "selected_columns", ()))
            selected_keys = {str(getattr(column, "key", "")) for column in selected}
            if selected_keys == {"job_id", "direction"} and len(selected) == 2:
                row = result.one_or_none()
                self._pause_after_scope_read()
                return SimpleNamespace(one_or_none=lambda: row)
            return result

    @contextmanager
    def instrumented_app_session(database_url_override: str | None = None):
        with real_app_session(database_url_override) as db:
            if threading.current_thread().name == "sandbox-grant-claim-race":
                yield _PausingClaimSession(db)
            else:
                yield db

    monkeypatch.setattr(app_service_module, "app_session", instrumented_app_session)
    claim_result: list[dict] = []
    claim_errors: list[BaseException] = []

    def claim_output() -> None:
        try:
            claim_result.append(
                service.claim_output_upload(
                    grant_id=grant["grant_id"],
                    raw_token=grant["token"],
                )
            )
        except BaseException as exc:  # captured for deterministic thread assertion
            claim_errors.append(exc)

    claim_thread = threading.Thread(
        target=claim_output,
        name="sandbox-grant-claim-race",
        daemon=True,
    )
    claim_thread.start()
    assert scope_read.wait(timeout=10), "claim did not reach the grant-scope read"
    try:
        service.cancel_conversation(
            conversation_id="conversation-manifest",
            current_user_id=161,
        )
    finally:
        cancel_committed.set()
    claim_thread.join(timeout=10)

    assert not claim_thread.is_alive()
    assert claim_result == []
    assert len(claim_errors) == 1
    assert isinstance(claim_errors[0], PermissionError)
    assert "unavailable" in str(claim_errors[0])
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxTransferGrant, grant["grant_id"]).status == "revoked"
        assert db.get(AppAiSandboxJob, "job-manifest").status == "cleanup_pending"


def test_claimed_output_can_only_reconcile_after_stop(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 13, 40, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)
    manifest = service.record_worker_result(
        job_id="job-manifest",
        opencode_session_id="opencode-manifest",
        assistant_markdown="",
        files=[_output(0)],
    )
    grant = service.issue_output_upload_grant(
        job_id="job-manifest",
        file_id=manifest["files"][0]["id"],
    )
    first_claim = service.claim_output_upload(
        grant_id=grant["grant_id"],
        raw_token=grant["token"],
    )
    service.cancel_conversation(
        conversation_id="conversation-manifest",
        current_user_id=161,
    )

    replay_claim = service.claim_output_upload(
        grant_id=grant["grant_id"],
        raw_token=grant["token"],
    )
    assert replay_claim["grant_id"] == first_claim["grant_id"]
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxTransferGrant, grant["grant_id"]).status == "claimed"


def test_chat_commit_then_app_db_failure_reconciles_one_output_with_same_grant(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 14, 0, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    output_path = tmp_path / "accepted-output.txt"
    output_path.write_bytes(b"accepted exactly once")
    service = AiSandboxAppService()
    monkeypatch.setattr(service, "settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)
    monkeypatch.setattr(
        app_service_module,
        "scan_my_file",
        lambda _path: SimpleNamespace(status="clean"),
    )
    manifest = service.record_worker_result(
        job_id="job-manifest",
        opencode_session_id="opencode-manifest",
        assistant_markdown="",
        files=[
            {
                "path": "output/accepted-output.txt",
                "name": output_path.name,
                "kind": "output",
                "content_type": "text/plain",
                "size_bytes": output_path.stat().st_size,
                "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
                "changed": False,
                "diff": "",
            }
        ],
    )
    file_id = manifest["files"][0]["id"]
    grant = service.issue_output_upload_grant(job_id="job-manifest", file_id=file_id)
    claimed = service.claim_output_upload(
        grant_id=grant["grant_id"],
        raw_token=grant["token"],
    )

    stored_messages: dict[str, dict] = {}
    send_attempts: list[str] = []

    def deterministic_send_files(*, client_message_id, **_kwargs):
        send_attempts.append(client_message_id)
        return stored_messages.setdefault(
            client_message_id,
            {
                "id": "chat-file-message-once",
                "attachments": [{"id": "chat-file-attachment-once"}],
            },
        )

    monkeypatch.setattr(app_service_module.chat_service, "send_files", deterministic_send_files)
    monkeypatch.setattr(
        app_service_module.chat_service,
        "get_message_by_client_id",
        lambda *, client_message_id, **_kwargs: stored_messages.get(client_message_id),
    )
    from backend.ai_chat.service import ai_chat_service

    monkeypatch.setattr(
        ai_chat_service,
        "_enqueue_message_side_effects_after_send",
        lambda **_kwargs: None,
    )

    real_app_session = app_service_module.app_session
    call_count = 0

    @contextmanager
    def fail_second_app_transaction():
        nonlocal call_count
        call_count += 1
        with real_app_session() as db:
            yield db
            if call_count == 2:
                # Chat DB has committed, while this app-scope transaction is
                # rolled back as if PostgreSQL failed before metadata commit.
                raise RuntimeError("transient app database commit failure")

    monkeypatch.setattr(app_service_module, "app_session", fail_second_app_transaction)
    with pytest.raises(RuntimeError, match="transient app database commit failure"):
        service.consume_claimed_output_upload(claimed=claimed, staged_path=output_path)

    monkeypatch.setattr(app_service_module, "app_session", real_app_session)
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxTransferGrant, grant["grant_id"]).status == "claimed"
        assert db.get(AppAiSandboxFile, file_id).delivery_status == "pending"
    assert len(stored_messages) == 1

    retry_claim = service.claim_output_upload(
        grant_id=grant["grant_id"],
        raw_token=grant["token"],
    )
    result = service.consume_claimed_output_upload(
        claimed=retry_claim,
        staged_path=output_path,
    )

    assert result == {
        "message_id": "chat-file-message-once",
        "attachment_id": "chat-file-attachment-once",
        "file_id": file_id,
    }
    assert len(stored_messages) == 1
    assert len(send_attempts) == 2
    assert send_attempts[0] == send_attempts[1]
    completed = service.claim_output_upload(
        grant_id=grant["grant_id"],
        raw_token=grant["token"],
    )
    assert completed["completed_result"] == result


def test_feature_off_stop_atomically_rejects_permission_and_cannot_be_reapproved(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 15, 0, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    service = AiSandboxAppService()
    enabled = {"value": True}
    monkeypatch.setattr(
        service,
        "settings",
        lambda: _settings(tmp_path) if enabled["value"] else SandboxSettings(enabled=False),
    )
    monkeypatch.setattr(service, "_publish_update", lambda **kwargs: None)
    pending = service.create_permission_request(
        session_id="session-manifest",
        job_id="job-manifest",
        opencode_permission_id="permission-before-stop",
        tool="bash",
        operation="pytest -q",
        arguments_preview={"command": "pytest -q"},
        message_id="permission-card-message",
    )
    assert pending["status"] == "pending"

    enabled["value"] = False
    with appdb_db.app_session(database_url) as db:
        db.get(AppAiBot, "bot-two-phase").is_enabled = False
    stopped = service.cancel_conversation(
        conversation_id="conversation-manifest",
        current_user_id=161,
    )
    assert stopped["status"] in {"running", "cancelled"}

    enabled["value"] = True
    with appdb_db.app_session(database_url) as db:
        db.get(AppAiBot, "bot-two-phase").is_enabled = True
    stale_approve = service.respond_permission(
        permission_id=pending["id"],
        current_user_id=161,
        decision="allow",
        scope="session",
    )
    assert stale_approve["status"] == "rejected"
    assert stale_approve["scope"] is None
    with pytest.raises(LookupError, match="not accepting"):
        service.create_permission_request(
            session_id="session-manifest",
            job_id="job-manifest",
            opencode_permission_id="permission-after-stop",
            tool="edit",
            operation="edit src/report.py",
            arguments_preview={"path": "src/report.py"},
            message_id="permission-card-after-stop",
        )
    with appdb_db.app_session(database_url) as db:
        permission = db.get(AppAiSandboxPermission, pending["id"])
        action = db.get(AppAiPendingAction, permission.action_id)
        job = db.get(AppAiSandboxJob, "job-manifest")
        assert permission.status == "rejected"
        assert permission.grant_scope is None
        assert action.status == "cancelled"
        assert job.status == "cleanup_pending"
        assert db.scalar(
            select(func.count()).select_from(AppAiSandboxPermission).where(
                AppAiSandboxPermission.opencode_permission_id == "permission-after-stop"
            )
        ) == 0


def test_retiring_conversation_terminalizes_pending_finalization(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 16, 0, tzinfo=timezone.utc)
    _seed_result_job(database_url=database_url, appdb_db=appdb_db, now=now)
    with appdb_db.app_session(database_url) as db:
        job = db.get(AppAiSandboxJob, "job-manifest")
        job.status = "finalizing"
        job.finalization_state = "pending"
        job.finalization_markdown = "This message must not survive conversation deletion"
        job.updated_at = now

    service = AiSandboxAppService()
    send_calls: list[dict] = []
    monkeypatch.setattr(
        app_service_module.chat_service,
        "send_message",
        lambda **kwargs: send_calls.append(kwargs),
    )
    service.retire_conversation(
        conversation_id="conversation-manifest",
        current_user_id=161,
    )

    with appdb_db.app_session(database_url) as db:
        job = db.get(AppAiSandboxJob, "job-manifest")
        session_row = db.get(AppAiSandboxSession, "session-manifest")
        assert job.status == "cancelled"
        assert job.finalization_state == "not_required"
        assert job.finalization_markdown == ""
        assert job.error_code == "conversation_deleted"
        assert session_row.status == "stopped"
    with pytest.raises(LookupError, match="not ready"):
        service.finalize_worker_result(job_id="job-manifest", assistant_markdown="ignored")
    assert send_calls == []
