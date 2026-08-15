from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.config import (  # noqa: E402
    SandboxConfigurationError,
    SandboxSettings,
)
from backend.ai_sandbox.contracts import WorkspaceLease  # noqa: E402
from backend.ai_sandbox.repository import (  # noqa: E402
    POSTGRES_ACTIVE_JOB_UNIQUE_INDEX_SQL,
    POSTGRES_CLAIM_JOB_SQL,
)
from backend.ai_sandbox.runtime import (  # noqa: E402
    PodmanArgvBuilder,
    PodmanProcessRunner,
    SandboxRuntimeError,
    assert_no_secret_in_argv,
    generate_basic_auth_credentials,
    remove_secret_env_file,
    write_secret_env_file,
)


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("b" * 64)


def _settings(tmp_path: Path) -> SandboxSettings:
    workspace_root = tmp_path / "workspaces"
    secret_root = tmp_path / "runtime-secrets"
    workspace_root.mkdir()
    profile = tmp_path / "seccomp.json"
    profile.write_text("{}", encoding="utf-8")
    return SandboxSettings(
        enabled=True,
        image=PINNED_TEST_IMAGE,
        workspace_root=workspace_root,
        runtime_secret_root=secret_root,
        seccomp_profile=profile,
        forbidden_roots=(tmp_path / "hub-repository",),
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


def test_secret_file_is_mode_0600_and_never_appears_in_argv(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="g" * 48)
    workspace = settings.workspace_root / "session-1"
    workspace.mkdir()
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session-1",
        job_id="job-1",
        user_id=7,
        credentials=credentials,
    )
    if os.name == "posix":
        assert stat.S_IMODE(secret_file.stat().st_mode) & 0o077 == 0
    payload = secret_file.read_text(encoding="utf-8")
    assert credentials.reveal_password() in payload
    assert credentials.reveal_gateway_bearer_token() in payload
    assert credentials.reveal_password() not in repr(credentials)
    assert credentials.reveal_gateway_bearer_token() not in repr(credentials)

    spec = PodmanArgvBuilder(settings).build(
        session_id="session-1",
        job_id="job-1",
        workspace=WorkspaceLease("session-1", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )
    assert_no_secret_in_argv(spec.argv, credentials)
    rendered = " ".join(spec.argv)
    assert credentials.reveal_password() not in rendered
    assert credentials.reveal_gateway_bearer_token() not in rendered
    remove_secret_env_file(secret_file)
    assert not secret_file.exists()


def test_podman_argv_enforces_isolation_and_exact_limits(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="g" * 48)
    workspace = settings.workspace_root / "session-2"
    workspace.mkdir()
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session-2",
        job_id="job-2",
        user_id=7,
        credentials=credentials,
    )
    spec = PodmanArgvBuilder(settings).build(
        session_id="session-2",
        job_id="job-2",
        workspace=WorkspaceLease("session-2", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )

    argv = spec.argv
    assert argv[:2] == ("podman", "run")
    assert "--read-only" in argv
    assert "--cap-drop=ALL" in argv
    assert "--security-opt=no-new-privileges" in argv
    assert any(value.startswith("--security-opt=seccomp=") for value in argv)
    assert "--pid=private" in argv
    assert "--ipc=private" in argv
    assert "--cpus=2" in argv
    assert f"--memory={2 * 1024**3}" in argv
    assert f"--memory-swap={2 * 1024**3}" in argv
    assert "--pids-limit=128" in argv
    assert "--network=hub-ai-internal" in argv
    assert "--user" in argv and "10001:10001" in argv
    assert "--userns=keep-id:uid=10001,gid=10001" in argv
    assert "--publish=127.0.0.1::4096" in argv
    mounts = [value for value in argv if value.startswith("--volume=")]
    assert len(mounts) == 1
    assert mounts[0].endswith(":/workspace:rw,nodev,nosuid,noexec")
    assert str(PROJECT_ROOT).lower() not in " ".join(argv).lower()
    assert settings.image in argv
    assert argv[-5:] == ("serve", "--hostname", "0.0.0.0", "--port", "4096")


def test_container_identity_is_fenced_by_job_within_same_session(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="j" * 48)
    workspace = settings.workspace_root / "session-job-fence"
    workspace.mkdir()
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session-job-fence",
        job_id="job-old",
        user_id=7,
        credentials=credentials,
    )
    builder = PodmanArgvBuilder(settings)
    old_spec = builder.build(
        session_id="session-job-fence",
        job_id="job-old",
        workspace=WorkspaceLease("session-job-fence", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )
    new_spec = builder.build(
        session_id="session-job-fence",
        job_id="job-new",
        workspace=WorkspaceLease("session-job-fence", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )

    assert old_spec.container_name != new_spec.container_name
    assert old_spec.container_name.startswith("hub-opencode-")
    assert new_spec.container_name.startswith("hub-opencode-")


def test_builder_refuses_unverified_quota_and_forbidden_workspace(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="g" * 48)
    forbidden = settings.workspace_root / "hub-repository" / "session"
    forbidden.mkdir(parents=True)
    settings = SandboxSettings(
        enabled=True,
        image=settings.image,
        workspace_root=settings.workspace_root,
        runtime_secret_root=settings.runtime_secret_root,
        seccomp_profile=settings.seccomp_profile,
        forbidden_roots=(settings.workspace_root / "hub-repository",),
        content_transfer_url=settings.content_transfer_url,
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session",
        job_id="job",
        user_id=7,
        credentials=credentials,
    )
    builder = PodmanArgvBuilder(settings)
    with pytest.raises(Exception, match="quota"):
        builder.build(
            session_id="session",
            job_id="job-forbidden-unverified",
            workspace=WorkspaceLease("session", forbidden, 1024**3, False),
            secret_env_file=secret_file,
        )
    with pytest.raises(Exception, match="forbidden"):
        builder.build(
            session_id="session",
            job_id="job-forbidden-verified",
            workspace=WorkspaceLease("session", forbidden, 1024**3, True),
            secret_env_file=secret_file,
        )


def test_queue_contract_uses_atomic_postgres_claim_and_one_active_job() -> None:
    assert "FOR UPDATE SKIP LOCKED" in POSTGRES_CLAIM_JOB_SQL
    assert "job.status = 'queued'" in POSTGRES_CLAIM_JOB_SQL
    assert ":worker_id" in POSTGRES_CLAIM_JOB_SQL
    assert (
        "WHERE status IN ('preparing', 'queued', 'claimed', 'running', "
        "'waiting_permission', 'finalizing', 'cleanup_pending')"
    ) in (
        POSTGRES_ACTIVE_JOB_UNIQUE_INDEX_SQL
    )


def test_podman_runner_verifies_internal_network_and_never_uses_shell(tmp_path: Path, monkeypatch) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="g" * 48)
    workspace = settings.workspace_root / "session-runner"
    workspace.mkdir()
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session-runner",
        job_id="job-runner",
        user_id=7,
        credentials=credentials,
    )
    spec = PodmanArgvBuilder(settings).build(
        session_id="session-runner",
        job_id="job-runner",
        workspace=WorkspaceLease("session-runner", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((tuple(argv), kwargs))
        if tuple(argv[1:3]) == ("info", "--format"):
            return SimpleNamespace(stdout="true netavark\n", stderr="", returncode=0)
        if tuple(argv[1:3]) == ("network", "inspect"):
            return SimpleNamespace(stdout="true true\n", stderr="", returncode=0)
        if argv[1] == "run":
            return SimpleNamespace(stdout="container-id\n", stderr="", returncode=0)
        if tuple(argv[1:3]) == ("container", "exists"):
            return SimpleNamespace(stdout="", stderr="", returncode=1)
        return SimpleNamespace(stdout="", stderr="", returncode=0)

    monkeypatch.setattr("backend.ai_sandbox.runtime.subprocess.run", fake_run)
    runner = PodmanProcessRunner(podman_binary="podman", inherited_env={"PATH": "test"})
    assert runner.start(spec) == "container-id"
    runner.stop(spec.container_name)

    assert calls[0][0][:3] == ("podman", "info", "--format")
    assert calls[1][0][:4] == ("podman", "network", "inspect", "--format")
    assert calls[1][0][-1] == "hub-ai-internal"
    assert all(kwargs["shell"] is False for _, kwargs in calls)


@pytest.mark.parametrize(
    ("info_output", "network_output", "error"),
    (
        ("true cni\n", "true true\n", "Netavark"),
        ("true netavark\n", "true false\n", "Aardvark DNS"),
    ),
)
def test_podman_runner_rejects_network_without_netavark_dns(
    tmp_path: Path,
    monkeypatch,
    info_output: str,
    network_output: str,
    error: str,
) -> None:
    settings = _settings(tmp_path)
    credentials = generate_basic_auth_credentials(gateway_bearer_token="n" * 48)
    workspace = settings.workspace_root / "session-network-check"
    workspace.mkdir()
    secret_file = write_secret_env_file(
        settings=settings,
        session_id="session-network-check",
        job_id="job-network-check",
        user_id=8,
        credentials=credentials,
    )
    spec = PodmanArgvBuilder(settings).build(
        session_id="session-network-check",
        job_id="job-network-check",
        workspace=WorkspaceLease("session-network-check", workspace, 1024**3, True),
        secret_env_file=secret_file,
    )

    def fake_run(argv, **kwargs):
        if tuple(argv[1:3]) == ("info", "--format"):
            return SimpleNamespace(stdout=info_output, stderr="", returncode=0)
        if tuple(argv[1:3]) == ("network", "inspect"):
            return SimpleNamespace(stdout=network_output, stderr="", returncode=0)
        return SimpleNamespace(stdout="container-id\n", stderr="", returncode=0)

    monkeypatch.setattr("backend.ai_sandbox.runtime.subprocess.run", fake_run)
    runner = PodmanProcessRunner(podman_binary="podman", inherited_env={"PATH": "test"})
    with pytest.raises(SandboxRuntimeError, match=error):
        runner.start(spec)


def test_podman_runner_forces_removal_when_graceful_stop_fails(monkeypatch) -> None:
    calls = []
    exists_results = iter((0, 1))

    def fake_run(argv, **kwargs):
        calls.append(tuple(argv))
        if tuple(argv[1:3]) == ("container", "exists"):
            return SimpleNamespace(stdout="", stderr="", returncode=next(exists_results))
        if argv[1] == "stop":
            return SimpleNamespace(stdout="", stderr="busy", returncode=125)
        return SimpleNamespace(stdout="", stderr="", returncode=0)

    monkeypatch.setattr("backend.ai_sandbox.runtime.subprocess.run", fake_run)
    runner = PodmanProcessRunner(podman_binary="podman", inherited_env={"PATH": "test"})
    runner.stop("hub-opencode-" + "a" * 24)

    assert any(call[1] == "kill" for call in calls)
    assert any(call[1:3] == ("rm", "--force") for call in calls)


def test_podman_runner_fails_closed_when_exists_probe_errors(monkeypatch) -> None:
    def fake_run(argv, **kwargs):
        if tuple(argv[1:3]) == ("container", "exists"):
            return SimpleNamespace(stdout="", stderr="runtime unavailable", returncode=125)
        return SimpleNamespace(stdout="", stderr="", returncode=0)

    monkeypatch.setattr("backend.ai_sandbox.runtime.subprocess.run", fake_run)
    runner = PodmanProcessRunner(podman_binary="podman", inherited_env={"PATH": "test"})

    with pytest.raises(SandboxRuntimeError, match="verify sandbox container cleanup"):
        runner.stop("hub-opencode-" + "b" * 24)


def test_podman_control_target_accepts_only_ephemeral_ipv4_loopback(monkeypatch) -> None:
    outputs = iter(("127.0.0.1:49152\n", "0.0.0.0:49153\n"))

    def fake_run(argv, **kwargs):
        return SimpleNamespace(stdout=next(outputs), stderr="", returncode=0)

    monkeypatch.setattr("backend.ai_sandbox.runtime.subprocess.run", fake_run)
    runner = PodmanProcessRunner(podman_binary="podman", inherited_env={"PATH": "test"})
    target = runner.control_target("hub-opencode-" + "c" * 24)
    assert (target.host, target.port) == ("127.0.0.1", 49152)

    with pytest.raises(SandboxRuntimeError, match="loopback"):
        runner.control_target("hub-opencode-" + "d" * 24)


def test_containerfile_pins_reviewed_official_image() -> None:
    containerfile = (PROJECT_ROOT / "scripts" / "ai-sandbox" / "Containerfile").read_text(encoding="utf-8")
    assert "ghcr.io/anomalyco/opencode@sha256:d99f6cb95094" in containerfile
    assert ":latest" not in containerfile
    assert "OPENCODE_VERSION=1.18.18" in containerfile
    assert "python3.12" in containerfile
    assert 'find_spec("pip") is None' in containerfile
    assert "python3 -m pip --version" in containerfile


def test_gateway_containerfile_is_a_buildable_pinned_release_artifact(tmp_path: Path) -> None:
    containerfile = (PROJECT_ROOT / "scripts" / "ai-sandbox" / "GatewayContainerfile").read_text(
        encoding="utf-8"
    )
    requirements = (PROJECT_ROOT / "scripts" / "ai-sandbox" / "gateway-requirements.lock").read_text(
        encoding="utf-8"
    )

    assert "ghcr.io/anomalyco/opencode@sha256:d99f6cb95094" in containerfile
    assert ":latest" not in containerfile
    copy_sources = [
        line.split()[1]
        for line in containerfile.splitlines()
        if line.strip().startswith("COPY ")
    ]
    assert "WEB-itinvent/backend" not in copy_sources
    assert "shared" not in copy_sources
    assert "WEB-itinvent/backend/ai_sandbox/gateway.py" in copy_sources
    assert "WEB-itinvent/backend/appdb/db.py" in copy_sources
    assert "shared/llm/client.py" in copy_sources
    assert all(not source.lower().endswith((".env", ".env.legacy")) for source in copy_sources)
    assert all("*" not in source for source in copy_sources)
    readme = (PROJECT_ROOT / "scripts" / "ai-sandbox" / "README.md").read_text(
        encoding="utf-8"
    )
    archive_block = readme.split('git archive "$release_id"', 1)[1].split(
        "gateway_tag=", 1
    )[0]
    assert "WEB-itinvent/backend shared" not in archive_block
    assert "WEB-itinvent/backend/ai_sandbox/gateway.py" in archive_block
    assert "shared/llm/openai_gateway.py" in archive_block
    assert 'USER 10001:10001' in containerfile
    assert 'ENTRYPOINT ["python3", "-m", "uvicorn"]' in containerfile
    assert 'CMD ["backend.ai_sandbox_gateway_main:app"' in containerfile
    assert '"$HUB_AI_GATEWAY_IMAGE" python -m uvicorn' not in readme
    assert "backend.ai_sandbox_gateway_main:app" in containerfile
    dependency_lines = [line for line in requirements.splitlines() if line.strip()]
    assert dependency_lines
    assert all("==" in line for line in dependency_lines)

    # Recreate exactly the allowlisted image filesystem and import its ASGI
    # entrypoint in a clean subprocess. This catches an omitted internal module
    # without ever exposing or copying the dirty repository wholesale.
    bundle_root = tmp_path / "gateway-bundle"
    for line in containerfile.splitlines():
        if not line.strip().startswith("COPY "):
            continue
        _, source_text, destination_text = line.split()
        source = PROJECT_ROOT / source_text
        destination = bundle_root / destination_text.lstrip("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    import_env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join(
            (
                str(bundle_root / "opt" / "hub" / "WEB-itinvent"),
                str(bundle_root / "opt" / "hub"),
            )
        ),
    }
    imported = subprocess.run(
        [sys.executable, "-c", "import backend.ai_sandbox_gateway_main"],
        cwd=bundle_root,
        env=import_env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert imported.returncode == 0, imported.stderr
    assert not list(bundle_root.rglob(".env*"))
