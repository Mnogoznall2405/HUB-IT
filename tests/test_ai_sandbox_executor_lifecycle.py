from __future__ import annotations

import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.contracts import (  # noqa: E402
    SandboxExecutionCancelled,
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
)
from backend.ai_sandbox.executor import (  # noqa: E402
    ConcreteSandboxJobExecutor,
    FilesystemWorkspaceProvisioner,
)


def _job(*, status: SandboxJobStatus = SandboxJobStatus.RUNNING) -> SandboxJobRecord:
    now = datetime.now(timezone.utc)
    return SandboxJobRecord(
        id="job-quiet-stream",
        session_id="session-quiet-stream",
        conversation_id="conversation-quiet-stream",
        user_id=17,
        prompt_message_id="message-quiet-stream",
        status=status,
        created_at=now,
        deadline_at=now + timedelta(minutes=10),
    )


def _session() -> SandboxSessionRecord:
    now = datetime.now(timezone.utc)
    return SandboxSessionRecord(
        id="session-quiet-stream",
        conversation_id="conversation-quiet-stream",
        user_id=17,
        workspace_key="ws-" + "a" * 32,
        status=SandboxSessionStatus.BUSY,
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=30),
        credential_ref="",
    )


class _CancellationRepository:
    def __init__(self) -> None:
        self.polls = 0

    def get_job_for_user(self, *, job_id, user_id):
        self.polls += 1
        return _job(
            status=(
                SandboxJobStatus.CANCELLED
                if self.polls >= 2
                else SandboxJobStatus.RUNNING
            )
        )


class _QuietControl:
    def __init__(self) -> None:
        self._release = threading.Event()
        self.aborts: list[str] = []
        self.interrupted = False

    def events(self):
        self._release.wait(timeout=10)
        if False:
            yield {}

    def interrupt_events(self) -> None:
        self.interrupted = True
        self._release.set()

    def abort(self, *, session_id: str) -> None:
        self.aborts.append(session_id)


def test_quiet_sse_stream_does_not_block_cancellation_watchdog() -> None:
    repository = _CancellationRepository()
    executor = ConcreteSandboxJobExecutor(
        settings=SandboxSettings(enabled=False),
        repository=repository,
        workspace_provisioner=object(),
        runtime_runner=object(),
        gateway_broker=object(),
        transfer_credentials=object(),
    )
    control = _QuietControl()
    started = time.monotonic()

    with pytest.raises(SandboxExecutionCancelled):
        executor._wait_for_completion(
            job=_job(),
            session=_session(),
            opencode_session_id="opencode-quiet",
            control=control,
            worker_control=object(),
            command_timeout_seconds=120,
            response_timeout_seconds=30,
        )

    assert time.monotonic() - started < 2.0
    assert control.aborts == ["opencode-quiet"]
    assert control.interrupted is True


def test_slow_purge_detaches_workspace_before_resurrection(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = SandboxSettings(
        enabled=False,
        workspace_root=tmp_path / "workspaces",
    )
    session = SandboxSessionRecord(
        id="session-retention-fence",
        conversation_id="conversation-retention-fence",
        user_id=17,
        workspace_key="ws-" + "b" * 32,
        status=SandboxSessionStatus.PURGING,
        created_at=datetime.now(timezone.utc),
        last_activity_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc),
        credential_ref="",
        purge_token="c" * 32,
    )
    workspace = settings.workspace_root / session.workspace_key
    workspace.mkdir(parents=True)
    (workspace / "old.txt").write_text("old generation", encoding="utf-8")
    provisioner = FilesystemWorkspaceProvisioner(
        settings=settings,
        quota_verifier=lambda _path, _bytes: True,
    )
    detached = threading.Event()
    finish_delete = threading.Event()
    failures: list[BaseException] = []
    original_delete = provisioner._delete_tombstone

    def windows_safe_detach(source: Path, tombstone: Path) -> None:
        # Production runs on Linux where os.rename is the same-filesystem
        # atomic fence. The Windows CI filesystem filter can block directory
        # rename, so emulate its already-detached postcondition here.
        tombstone.mkdir()
        for child in source.iterdir():
            if child.is_file():
                child.unlink()
        source.rmdir()

    def slow_delete(path: Path) -> None:
        assert Path(path) != workspace
        assert not workspace.exists()
        detached.set()
        assert finish_delete.wait(timeout=5)
        original_delete(path)

    monkeypatch.setattr(provisioner, "_delete_tombstone", slow_delete)
    monkeypatch.setattr(provisioner, "_atomic_detach", windows_safe_detach)

    def run_purge() -> None:
        try:
            provisioner.purge(session)
        except BaseException as exc:  # pragma: no cover - asserted below
            failures.append(exc)

    thread = threading.Thread(target=run_purge)
    thread.start()
    if not detached.wait(timeout=5):
        finish_delete.set()
        thread.join(timeout=5)
        assert failures == []
        raise AssertionError("purge did not detach the workspace")

    # A stale-purge recovery may finish the DB CAS while the old tombstone is
    # still being removed. A resurrected generation reuses the fixed key, but
    # the old deleter must remain fenced to its token-scoped tombstone.
    workspace.mkdir()
    new_file = workspace / "new.txt"
    new_file.write_text("new generation", encoding="utf-8")
    finish_delete.set()
    thread.join(timeout=5)

    assert not thread.is_alive()
    assert failures == []
    assert new_file.read_text(encoding="utf-8") == "new generation"
