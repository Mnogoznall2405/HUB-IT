from __future__ import annotations

import hashlib
import ipaddress
import os
import re
import secrets
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from .config import SandboxConfigurationError, SandboxSettings
from .contracts import BasicAuthCredentials, WorkspaceLease
from .paths import inspect_workspace_tree, validate_workspace_lease


_SAFE_ENV_VALUE_RE = re.compile(r"^[^\r\n\x00]+$")
_SAFE_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{1,64}$")
_CONTAINER_NAME_RE = re.compile(
    r"^hub-opencode-(?:[0-9a-f]{24}|[0-9a-f]{16}-[0-9a-f]{16})$"
)


class SandboxRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class PodmanContainerSpec:
    session_id: str
    job_id: str
    container_name: str
    internal_network: str
    argv: tuple[str, ...]

    def redacted_argv(self) -> tuple[str, ...]:
        # Secrets are passed by file reference, never as argv values.
        return self.argv


@dataclass(frozen=True)
class PodmanControlTarget:
    host: str
    port: int


def sandbox_container_name(*, session_id: str, job_id: str) -> str:
    """Return a per-job identity so stale cleanup cannot target a newer run."""

    normalized_session = str(session_id or "")
    normalized_job = str(job_id or "")
    if not normalized_session or not normalized_job or len(normalized_session) > 128 or len(normalized_job) > 128:
        raise SandboxRuntimeError("Invalid sandbox container scope")
    session_hash = hashlib.sha256(normalized_session.encode("utf-8")).hexdigest()[:16]
    job_hash = hashlib.sha256(normalized_job.encode("utf-8")).hexdigest()[:16]
    return f"hub-opencode-{session_hash}-{job_hash}"


def legacy_sandbox_container_name(*, session_id: str) -> str:
    """Name used before job fencing; retained only for rollout cleanup."""

    normalized_session = str(session_id or "")
    if not normalized_session or len(normalized_session) > 128:
        raise SandboxRuntimeError("Invalid sandbox session scope")
    session_hash = hashlib.sha256(normalized_session.encode("utf-8")).hexdigest()[:24]
    return f"hub-opencode-{session_hash}"


def generate_basic_auth_credentials(*, gateway_bearer_token: str) -> BasicAuthCredentials:
    """Wrap a broker-registered gateway bearer with per-run Basic Auth."""

    gateway_token = _validate_env_value(gateway_bearer_token, label="HUB LLM gateway token")
    if len(gateway_token) < 32:
        raise SandboxRuntimeError("HUB LLM gateway token is too short")
    return BasicAuthCredentials(
        username="hub-worker",
        password=secrets.token_urlsafe(48),
        gateway_bearer_token=gateway_token,
    )


def _validate_env_value(value: str, *, label: str) -> str:
    normalized = str(value or "")
    if not _SAFE_ENV_VALUE_RE.fullmatch(normalized):
        raise SandboxRuntimeError(f"Invalid {label}")
    return normalized


def write_secret_env_file(
    *,
    settings: SandboxSettings,
    session_id: str,
    job_id: str,
    user_id: int,
    credentials: BasicAuthCredentials,
) -> Path:
    """Create a mode-0600 env file outside every workspace.

    The caller removes this file immediately after Podman has consumed it.
    Neither the path nor the returned object contains the password.
    """

    if not _SAFE_USERNAME_RE.fullmatch(credentials.username):
        raise SandboxRuntimeError("Invalid Basic Auth username")
    password = _validate_env_value(credentials.reveal_password(), label="Basic Auth password")
    gateway_token = _validate_env_value(
        credentials.reveal_gateway_bearer_token(),
        label="HUB LLM gateway token",
    )
    gateway = _validate_env_value(settings.llm_gateway_url, label="LLM gateway URL")
    safe_session_id = _validate_env_value(session_id, label="sandbox session id")
    safe_job_id = _validate_env_value(job_id, label="sandbox job id")
    if len(safe_session_id) > 128 or len(safe_job_id) > 128 or int(user_id) <= 0:
        raise SandboxRuntimeError("Invalid sandbox gateway scope")
    secret_root = settings.runtime_secret_root.resolve(strict=False)
    workspace_root = settings.workspace_root.resolve(strict=False)
    try:
        secret_root.relative_to(workspace_root)
    except ValueError:
        pass
    else:
        raise SandboxRuntimeError("Runtime secret directory must be outside workspaces")

    secret_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(secret_root, 0o700)
    except OSError as exc:
        raise SandboxRuntimeError("Unable to secure runtime secret directory") from exc

    opaque_name = hashlib.sha256(f"{session_id}:{secrets.token_hex(16)}".encode("utf-8")).hexdigest()
    destination = secret_root / f"{opaque_name}.env"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor: int | None = None
    try:
        descriptor = os.open(destination, flags, 0o600)
        payload = (
            f"OPENCODE_SERVER_USERNAME={credentials.username}\n"
            f"OPENCODE_SERVER_PASSWORD={password}\n"
            f"HUB_LLM_GATEWAY_URL={gateway}\n"
            f"HUB_LLM_GATEWAY_BEARER_TOKEN={gateway_token}\n"
            f"HUB_SANDBOX_JOB_ID={safe_job_id}\n"
            f"HUB_SANDBOX_SESSION_ID={safe_session_id}\n"
            f"HUB_SANDBOX_USER_ID={int(user_id)}\n"
        ).encode("utf-8")
        os.write(descriptor, payload)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = None
        os.chmod(destination, 0o600)
        return destination
    except OSError as exc:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            destination.unlink(missing_ok=True)
        except OSError:
            pass
        raise SandboxRuntimeError("Unable to create runtime credential file") from exc


def remove_secret_env_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        raise SandboxRuntimeError("Unable to remove runtime credential file") from exc


class PodmanArgvBuilder:
    def __init__(self, settings: SandboxSettings) -> None:
        self.settings = settings

    def build(
        self,
        *,
        session_id: str,
        job_id: str,
        workspace: WorkspaceLease,
        secret_env_file: Path,
    ) -> PodmanContainerSpec:
        self.settings.validate(require_runtime_files=True)
        workspace_path = validate_workspace_lease(
            workspace,
            workspace_root=self.settings.workspace_root,
            forbidden_roots=(*self.settings.forbidden_roots, self.settings.hub_code_root),
            maximum_quota_bytes=self.settings.limits.workspace_bytes,
        )
        inspect_workspace_tree(
            workspace_path,
            maximum_bytes=self.settings.limits.workspace_bytes,
        )
        secret_path = secret_env_file.resolve(strict=True)
        mode = stat.S_IMODE(secret_path.stat().st_mode)
        if os.name == "posix" and mode & 0o077:
            raise SandboxRuntimeError("Runtime credential file must have mode 0600")
        if workspace_path in secret_path.parents:
            raise SandboxRuntimeError("Runtime credential file must be outside the workspace")

        session_hash = hashlib.sha256(str(session_id).encode("utf-8")).hexdigest()[:16]
        job_hash = hashlib.sha256(str(job_id).encode("utf-8")).hexdigest()[:16]
        container_name = sandbox_container_name(session_id=session_id, job_id=job_id)
        limits = self.settings.limits
        mount_value = f"{workspace_path.as_posix()}:/workspace:rw,nodev,nosuid,noexec"
        argv = (
            self.settings.podman_binary,
            "run",
            "--detach",
            "--rm",
            "--name",
            container_name,
            "--hostname",
            container_name,
            "--user",
            f"{self.settings.run_as_uid}:{self.settings.run_as_gid}",
            f"--userns=keep-id:uid={self.settings.run_as_uid},gid={self.settings.run_as_gid}",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            f"--security-opt=seccomp={self.settings.seccomp_profile.as_posix()}",
            "--pid=private",
            "--ipc=private",
            f"--cpus={limits.cpus:g}",
            f"--memory={limits.memory_bytes}",
            f"--memory-swap={limits.memory_bytes}",
            f"--pids-limit={limits.pids}",
            f"--tmpfs=/tmp:rw,nosuid,nodev,noexec,size={limits.tmpfs_bytes},mode=1777",
            f"--network={self.settings.internal_network}",
            "--publish=127.0.0.1::4096",
            f"--volume={mount_value}",
            "--workdir=/workspace",
            f"--env-file={secret_path.as_posix()}",
            "--env=HOME=/tmp/home",
            "--env=TMPDIR=/tmp",
            "--env=OPENCODE_CONFIG=/etc/opencode/opencode.json",
            "--env=XDG_DATA_HOME=/workspace/.hub-opencode/data",
            "--env=XDG_STATE_HOME=/workspace/.hub-opencode/state",
            "--env=XDG_CACHE_HOME=/tmp/opencode-cache",
            "--stop-timeout=10",
            "--label=hub.component=ai-sandbox",
            f"--label=hub.session={session_hash}",
            f"--label=hub.job={job_hash}",
            self.settings.image,
            "serve",
            "--hostname",
            "0.0.0.0",
            "--port",
            "4096",
        )
        return PodmanContainerSpec(
            session_id=session_id,
            job_id=job_id,
            container_name=container_name,
            internal_network=self.settings.internal_network,
            argv=argv,
        )


class PodmanProcessRunner:
    """Small shell-free Podman adapter used by the Linux worker only."""

    def __init__(
        self,
        *,
        podman_binary: str = "podman",
        inherited_env: Mapping[str, str] | None = None,
    ) -> None:
        if Path(podman_binary).name.lower() not in {"podman", "podman.exe"}:
            raise SandboxRuntimeError("Only the Podman runtime is supported")
        self._podman_binary = podman_binary
        source = os.environ if inherited_env is None else inherited_env
        self._environment = {
            key: value
            for key, value in source.items()
            if key in {"PATH", "HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL"}
        }

    def start(self, spec: PodmanContainerSpec, *, timeout_seconds: int = 30) -> str:
        if spec.argv[0] != self._podman_binary:
            raise SandboxRuntimeError("Podman binary mismatch between runtime settings and runner")
        self.assert_rootless(timeout_seconds=min(timeout_seconds, 10))
        self.assert_internal_network(spec.internal_network, timeout_seconds=min(timeout_seconds, 10))
        try:
            completed = subprocess.run(
                list(spec.argv),
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Podman failed to start the sandbox container") from exc
        container_id = completed.stdout.strip()
        if not container_id:
            raise SandboxRuntimeError("Podman returned no container id")
        return container_id

    def assert_rootless(self, *, timeout_seconds: int = 10) -> None:
        try:
            completed = subprocess.run(
                [
                    self._podman_binary,
                    "info",
                    "--format",
                    "{{.Host.Security.Rootless}} {{.Host.NetworkBackend}}",
                ],
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Unable to verify rootless Podman") from exc
        rootless, separator, network_backend = completed.stdout.strip().lower().partition(" ")
        if rootless != "true":
            raise SandboxRuntimeError("Sandbox worker requires rootless Podman")
        if not separator or network_backend.strip() != "netavark":
            raise SandboxRuntimeError("Sandbox worker requires the Netavark network backend")

    def assert_internal_network(self, network: str, *, timeout_seconds: int = 10) -> None:
        try:
            completed = subprocess.run(
                [
                    self._podman_binary,
                    "network",
                    "inspect",
                    "--format",
                    "{{.Internal}} {{.DNSEnabled}}",
                    network,
                ],
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Unable to verify the sandbox network") from exc
        internal, separator, dns_enabled = completed.stdout.strip().lower().partition(" ")
        if internal != "true":
            raise SandboxRuntimeError("Sandbox network is not internal-only")
        if not separator or dns_enabled.strip() != "true":
            raise SandboxRuntimeError("Sandbox network requires Aardvark DNS")

    def stop(self, container_name: str, *, timeout_seconds: int = 20) -> None:
        if not _CONTAINER_NAME_RE.fullmatch(str(container_name or "")):
            raise SandboxRuntimeError("Invalid sandbox container name")
        stop_error: Exception | None = None
        try:
            subprocess.run(
                [self._podman_binary, "stop", "--time", "10", container_name],
                shell=False,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            stop_error = exc
        try:
            if self._container_exists(container_name, timeout_seconds=min(timeout_seconds, 10)):
                subprocess.run(
                    [self._podman_binary, "kill", container_name],
                    shell=False,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=min(timeout_seconds, 10),
                    env=self._environment,
                )
                subprocess.run(
                    [self._podman_binary, "rm", "--force", container_name],
                    shell=False,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=min(timeout_seconds, 10),
                    env=self._environment,
                )
                if self._container_exists(container_name, timeout_seconds=min(timeout_seconds, 10)):
                    raise SandboxRuntimeError("Sandbox container remained after forced removal")
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Podman failed to remove the sandbox container") from exc
        if stop_error is not None:
            # A timed-out graceful stop is acceptable only after verified
            # forced removal. The check above is the authoritative outcome.
            return

    def _container_exists(self, container_name: str, *, timeout_seconds: int) -> bool:
        """Interpret Podman's tri-state `container exists` result fail closed.

        Podman documents 0 as present and 1 as absent. Any other status is a
        runtime/CLI failure and must never be mistaken for successful cleanup.
        """

        completed = subprocess.run(
            [self._podman_binary, "container", "exists", container_name],
            shell=False,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            env=self._environment,
        )
        return_code = int(completed.returncode)
        if return_code == 0:
            return True
        if return_code == 1:
            return False
        raise SandboxRuntimeError("Unable to verify sandbox container cleanup")

    def container_ip(self, container_name: str, *, timeout_seconds: int = 10) -> str:
        if not _CONTAINER_NAME_RE.fullmatch(str(container_name or "")):
            raise SandboxRuntimeError("Invalid sandbox container name")
        try:
            completed = subprocess.run(
                [
                    self._podman_binary,
                    "inspect",
                    "--format",
                    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
                    container_name,
                ],
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Unable to inspect sandbox container address") from exc
        candidate = completed.stdout.strip()
        try:
            address = ipaddress.ip_address(candidate)
        except ValueError as exc:
            raise SandboxRuntimeError("Podman returned an invalid container address") from exc
        if address.is_loopback or address.is_unspecified or address.is_multicast:
            raise SandboxRuntimeError("Podman returned an unsafe container address")
        return address.compressed

    def control_target(self, container_name: str, *, timeout_seconds: int = 10) -> PodmanControlTarget:
        if not _CONTAINER_NAME_RE.fullmatch(str(container_name or "")):
            raise SandboxRuntimeError("Invalid sandbox container name")
        try:
            completed = subprocess.run(
                [self._podman_binary, "port", container_name, "4096/tcp"],
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                env=self._environment,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxRuntimeError("Unable to resolve OpenCode loopback control port") from exc
        rendered = completed.stdout.strip()
        match = re.fullmatch(r"127\.0\.0\.1:([0-9]{1,5})", rendered)
        if match is None:
            raise SandboxRuntimeError("OpenCode control port is not bound exclusively to IPv4 loopback")
        port = int(match.group(1))
        if not (1024 <= port <= 65535):
            raise SandboxRuntimeError("OpenCode control port is outside the ephemeral range")
        return PodmanControlTarget(host="127.0.0.1", port=port)


def assert_no_secret_in_argv(argv: Sequence[str], credentials: BasicAuthCredentials) -> None:
    secrets_to_check = (
        credentials.reveal_password(),
        credentials.reveal_gateway_bearer_token(),
    )
    if any(secret and secret in str(argument) for secret in secrets_to_check for argument in argv):
        raise SandboxConfigurationError("A session credential was placed in process arguments")
