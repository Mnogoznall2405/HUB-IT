from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

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
    WorkspaceLease,
)
from backend.ai_sandbox.executor import ConcreteSandboxJobExecutor  # noqa: E402
from backend.ai_sandbox.gateway import GatewayAccessGrant, GatewayBearerToken  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("8" * 64)


def _settings(tmp_path: Path) -> SandboxSettings:
    workspace_root = tmp_path / "workspaces"
    workspace_root.mkdir()
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


def _job_and_session() -> tuple[SandboxJobRecord, SandboxSessionRecord]:
    now = datetime.now(timezone.utc)
    session = SandboxSessionRecord(
        id="session-control",
        conversation_id="conversation-control",
        user_id=44,
        workspace_key="ws-" + ("4" * 32),
        status=SandboxSessionStatus.BUSY,
        created_at=now,
        last_activity_at=now,
        expires_at=now + timedelta(days=30),
        credential_ref="",
        opencode_session_id="persisted-opencode-session",
    )
    job = SandboxJobRecord(
        id="job-control",
        session_id=session.id,
        conversation_id=session.conversation_id,
        user_id=session.user_id,
        prompt_message_id="message-control",
        status=SandboxJobStatus.RUNNING,
        created_at=now,
        deadline_at=now + timedelta(minutes=15),
    )
    return job, session


class _Gateway:
    def __init__(self) -> None:
        self.revoked: list[tuple[str, str]] = []

    def issue(self, *, job_id: str, session_id: str, user_id: int):
        return GatewayAccessGrant(
            id="grant-control",
            job_id=job_id,
            session_id=session_id,
            user_id=user_id,
            token=GatewayBearerToken("g" * 48),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )

    def revoke(self, *, grant_id: str, job_id: str) -> None:
        self.revoked.append((grant_id, job_id))


class _Runtime:
    def __init__(self) -> None:
        self.started = 0
        self.stopped = 0

    def start(self, spec) -> str:
        self.started += 1
        return "container-id"

    def control_target(self, container_name: str):
        return SimpleNamespace(host="127.0.0.1", port=49152)

    def stop(self, container_name: str) -> None:
        self.stopped += 1


class _AmbiguousPromptControl:
    def __init__(self, **kwargs) -> None:
        self.prompts: list[dict] = []
        self.create_calls = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def prompt_async(self, *, session_id: str, prompt: dict) -> None:
        self.prompts.append(prompt)
        raise TimeoutError("accepted response was lost")

    def create_session(self, **kwargs):
        self.create_calls += 1
        return {"id": "must-not-be-created"}


def test_ambiguous_persisted_session_prompt_error_is_never_resent(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    workspace = settings.workspace_root / ("ws-" + ("4" * 32))
    workspace.mkdir()
    job, session = _job_and_session()
    gateway = _Gateway()
    runtime = _Runtime()
    controls: list[_AmbiguousPromptControl] = []

    def control_factory(**kwargs):
        control = _AmbiguousPromptControl(**kwargs)
        controls.append(control)
        return control

    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=object(),
        workspace_provisioner=object(),
        runtime_runner=runtime,
        gateway_broker=gateway,
        transfer_credentials=object(),
        control_client_factory=control_factory,
    )

    with pytest.raises(TimeoutError, match="accepted response was lost"):
        executor._execute_prompt_container(
            job=job,
            session=session,
            lease=WorkspaceLease(session.id, workspace, 1024**3, True),
            prompt="change a file",
            worker_control=object(),
            command_timeout_seconds=120,
            response_timeout_seconds=900,
        )

    assert len(controls) == 1
    assert controls[0].create_calls == 0
    assert len(controls[0].prompts) == 1
    assert controls[0].prompts[0]["messageID"]
    assert runtime.started == 1
    assert runtime.stopped == 1
    assert gateway.revoked == [("grant-control", "job-control")]
    assert list(settings.runtime_secret_root.glob("*.env")) == []


def test_prestart_spec_failure_revokes_gateway_and_removes_env_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = _settings(tmp_path)
    workspace = settings.workspace_root / ("ws-" + ("4" * 32))
    workspace.mkdir()
    job, session = _job_and_session()
    gateway = _Gateway()
    runtime = _Runtime()
    monkeypatch.setattr(
        "backend.ai_sandbox.executor.PodmanArgvBuilder.build",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("spec rejected")),
    )
    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=object(),
        workspace_provisioner=object(),
        runtime_runner=runtime,
        gateway_broker=gateway,
        transfer_credentials=object(),
    )

    with pytest.raises(RuntimeError, match="spec rejected"):
        executor._execute_prompt_container(
            job=job,
            session=session,
            lease=WorkspaceLease(session.id, workspace, 1024**3, True),
            prompt="hello",
            worker_control=object(),
            command_timeout_seconds=120,
            response_timeout_seconds=900,
        )

    assert runtime.started == 0
    assert runtime.stopped == 0
    assert gateway.revoked == [("grant-control", "job-control")]
    assert list(settings.runtime_secret_root.glob("*.env")) == []

