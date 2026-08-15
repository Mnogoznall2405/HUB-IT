from __future__ import annotations

import sys
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
from backend.ai_sandbox.executor import ConcreteSandboxJobExecutor, SandboxExecutorError  # noqa: E402


class _Repository:
    def get_job_for_user(self, *, job_id, user_id):
        return SandboxJobRecord(
            id=job_id,
            session_id="session-1",
            conversation_id="conversation-1",
            user_id=user_id,
            prompt_message_id="message-1",
            status=SandboxJobStatus.RUNNING,
            created_at=datetime.now(timezone.utc),
            deadline_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )


class _WorkerControl:
    def __init__(self):
        self.created = []

    def create_permission(self, **kwargs):
        self.created.append(kwargs)
        return {"id": "permission-row", "status": "approved", "scope": "once"}


class _OpenCodeControl:
    def __init__(self):
        self.answers = []
        self.aborts = []

    def answer_permission(self, **kwargs):
        self.answers.append(kwargs)

    def abort(self, *, session_id):
        self.aborts.append(session_id)


def _executor() -> ConcreteSandboxJobExecutor:
    return ConcreteSandboxJobExecutor(
        settings=SandboxSettings(enabled=False),
        repository=_Repository(),
        workspace_provisioner=object(),
        runtime_runner=object(),
        gateway_broker=object(),
        transfer_credentials=object(),
    )


def _job() -> SandboxJobRecord:
    now = datetime.now(timezone.utc)
    return SandboxJobRecord(
        id="job-1",
        session_id="session-1",
        conversation_id="conversation-1",
        user_id=7,
        prompt_message_id="message-1",
        status=SandboxJobStatus.RUNNING,
        created_at=now,
        deadline_at=now + timedelta(minutes=10),
    )


def _session() -> SandboxSessionRecord:
    now = datetime.now(timezone.utc)
    return SandboxSessionRecord(
        id="session-1",
        conversation_id="conversation-1",
        user_id=7,
        workspace_key="ws-" + "a" * 32,
        status=SandboxSessionStatus.BUSY,
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=30),
        credential_ref="",
    )


def test_official_permission_asked_shape_reaches_bash_confirmation_policy() -> None:
    worker_control = _WorkerControl()
    opencode = _OpenCodeControl()

    _executor()._handle_permission(
        job=_job(),
        session=_session(),
        opencode_session_id="opencode-session",
        properties={
            "id": "opencode-permission",
            "sessionID": "opencode-session",
            "permission": "bash",
            "patterns": ["pytest -q"],
            "always": [],
            "tool": {"messageID": "m1", "callID": "c1"},
        },
        control=opencode,
        worker_control=worker_control,
        deadline=10**12,
    )

    assert worker_control.created[0]["tool"] == "bash"
    assert worker_control.created[0]["arguments"]["command"] == "pytest -q"
    assert opencode.answers[0]["payload"] == {"response": "once", "remember": False}


def test_command_timeout_aborts_opencode_session(monkeypatch) -> None:
    opencode = _OpenCodeControl()
    monkeypatch.setattr("backend.ai_sandbox.executor.time.monotonic", lambda: 121.0)

    with pytest.raises(SandboxExecutorError, match="120-second"):
        _executor()._raise_if_tool_timed_out(
            {"tool-call": 0.0},
            timeout_seconds=120,
            control=opencode,
            opencode_session_id="opencode-session",
        )

    assert opencode.aborts == ["opencode-session"]


def test_cancel_winning_last_permission_poll_never_answers_allow() -> None:
    class _CancelledRepository:
        def get_job_for_user(self, *, job_id, user_id):
            return SandboxJobRecord(
                id=job_id,
                session_id="session-1",
                conversation_id="conversation-1",
                user_id=user_id,
                prompt_message_id="message-1",
                status=SandboxJobStatus.CLEANUP_PENDING,
                created_at=datetime.now(timezone.utc),
                deadline_at=datetime.now(timezone.utc) + timedelta(minutes=10),
                cleanup_terminal_status="cancelled",
            )

    executor = _executor()
    executor.repository = _CancelledRepository()
    worker_control = _WorkerControl()
    opencode = _OpenCodeControl()

    with pytest.raises(SandboxExecutionCancelled, match="cancelled"):
        executor._handle_permission(
            job=_job(),
            session=_session(),
            opencode_session_id="opencode-session",
            properties={
                "id": "opencode-permission-race",
                "permission": "bash",
                "patterns": ["pytest -q"],
                "tool": {"messageID": "m1", "callID": "c1"},
            },
            control=opencode,
            worker_control=worker_control,
            deadline=10**12,
        )

    assert opencode.answers == []
    assert opencode.aborts == ["opencode-session"]
