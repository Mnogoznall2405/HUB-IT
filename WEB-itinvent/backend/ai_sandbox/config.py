from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


BASELINE_OPENCODE_VERSION = "1.18.18"
MINIMUM_SAFE_OPENCODE_VERSION = "1.0.216"
OFFICIAL_OPENCODE_AMD64_IMAGE = (
    "ghcr.io/anomalyco/opencode@sha256:"
    "d99f6cb95094eb9934ead4b600242e950ae6681d20c5a5f131a1c0a62208517f"
)
DEFAULT_RETENTION_DAYS = 30
DEFAULT_COMMAND_TIMEOUT_SECONDS = 120
DEFAULT_RESPONSE_TIMEOUT_SECONDS = 15 * 60
DEFAULT_WORKSPACE_QUOTA_BYTES = 1024**3
HUB_CODE_ROOT = Path(__file__).resolve().parents[3]

_DIGEST_IMAGE_RE = re.compile(r"^[^\s@:]+(?:[/:][^\s@]+)+@sha256:[0-9a-f]{64}$", re.IGNORECASE)
_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
_SAFE_NETWORK_RE = re.compile(r"^hub-ai-internal(?:-[a-z0-9][a-z0-9-]{0,31})?$", re.IGNORECASE)
_SAFE_CONTROL_HOST_RE = re.compile(r"^hub-ai-control(?:-[a-z0-9][a-z0-9-]{0,31})?$", re.IGNORECASE)
_TRANSFER_TOKEN_RE = re.compile(r"^[A-Za-z0-9._~-]{32,512}$")


class SandboxConfigurationError(RuntimeError):
    """Raised when sandbox configuration weakens the isolation boundary."""


def _env_bool(value: object, *, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_version(value: str) -> tuple[int, int, int]:
    match = _VERSION_RE.fullmatch(str(value or "").strip())
    if not match:
        raise SandboxConfigurationError(f"Invalid OpenCode version: {value!r}")
    return tuple(int(part) for part in match.groups())


def validate_digest_image(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise SandboxConfigurationError("AI_SANDBOX_IMAGE is required when the sandbox is enabled")
    if ":latest" in normalized.lower() or normalized.lower().endswith("/latest"):
        raise SandboxConfigurationError("Floating latest images are forbidden")
    if not _DIGEST_IMAGE_RE.fullmatch(normalized):
        raise SandboxConfigurationError("Sandbox image must be pinned as registry/name@sha256:<64 hex>")
    return normalized


def validate_transfer_service_token(value: str) -> str:
    normalized = str(value or "").strip()
    lowered = normalized.lower()
    if (
        not _TRANSFER_TOKEN_RE.fullmatch(normalized)
        or any(marker in lowered for marker in ("change-me", "changeme", "placeholder", "example"))
        or len(set(normalized)) < 8
    ):
        raise SandboxConfigurationError(
            "AI_SANDBOX_TRANSFER_SERVICE_TOKEN must be a strong non-placeholder secret"
        )
    return normalized


def _is_valid_transfer_service_token(value: str) -> bool:
    try:
        validate_transfer_service_token(value)
    except SandboxConfigurationError:
        return False
    return True


@dataclass(frozen=True)
class SandboxResourceLimits:
    cpus: float = 2.0
    memory_bytes: int = 2 * 1024**3
    pids: int = 128
    workspace_bytes: int = DEFAULT_WORKSPACE_QUOTA_BYTES
    tmpfs_bytes: int = 256 * 1024**2
    command_timeout_seconds: int = DEFAULT_COMMAND_TIMEOUT_SECONDS
    response_timeout_seconds: int = DEFAULT_RESPONSE_TIMEOUT_SECONDS
    active_jobs_per_user: int = 1

    def validate(self) -> None:
        if not (0 < self.cpus <= 2.0):
            raise SandboxConfigurationError("Sandbox CPU limit must be in (0, 2]")
        if not (0 < self.memory_bytes <= 2 * 1024**3):
            raise SandboxConfigurationError("Sandbox memory limit must not exceed 2 GiB")
        if not (0 < self.pids <= 128):
            raise SandboxConfigurationError("Sandbox PID limit must not exceed 128")
        if not (0 < self.workspace_bytes <= DEFAULT_WORKSPACE_QUOTA_BYTES):
            raise SandboxConfigurationError("Workspace quota must not exceed 1 GiB")
        if not (16 * 1024**2 <= self.tmpfs_bytes <= 512 * 1024**2):
            raise SandboxConfigurationError("Sandbox tmpfs must be between 16 and 512 MiB")
        if not (0 < self.command_timeout_seconds <= DEFAULT_COMMAND_TIMEOUT_SECONDS):
            raise SandboxConfigurationError("Command timeout must not exceed 120 seconds")
        if not (0 < self.response_timeout_seconds <= DEFAULT_RESPONSE_TIMEOUT_SECONDS):
            raise SandboxConfigurationError("Response timeout must not exceed 15 minutes")
        if self.active_jobs_per_user != 1:
            raise SandboxConfigurationError("Exactly one active sandbox job per user is required")


@dataclass(frozen=True)
class SandboxSettings:
    enabled: bool = False
    image: str = ""
    opencode_version: str = BASELINE_OPENCODE_VERSION
    workspace_root: Path = Path("/var/lib/hub-ai-sandbox/workspaces")
    runtime_secret_root: Path = Path("/run/user/10001/hub-ai-sandbox")
    seccomp_profile: Path = Path("/etc/hub-ai-sandbox/seccomp-opencode.json")
    internal_network: str = "hub-ai-internal"
    llm_gateway_url: str = "http://hub-ai-llm-gateway:8080/v1"
    content_transfer_url: str = ""
    content_transfer_allowed_host: str = "hub-ai-control"
    content_transfer_ready: bool = False
    transfer_auth_configured: bool = False
    retention_days: int = DEFAULT_RETENTION_DAYS
    retention_enabled: bool = True
    podman_binary: str = "podman"
    run_as_uid: int = 10001
    run_as_gid: int = 10001
    forbidden_roots: tuple[Path, ...] = field(default_factory=tuple)
    hub_code_root: Path = HUB_CODE_ROOT
    limits: SandboxResourceLimits = field(default_factory=SandboxResourceLimits)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "SandboxSettings":
        values = os.environ if environ is None else environ
        transfer_service_token = str(values.get("AI_SANDBOX_TRANSFER_SERVICE_TOKEN", "") or "").strip()
        forbidden = tuple(
            Path(item.strip())
            for item in str(values.get("AI_SANDBOX_FORBIDDEN_ROOTS", "")).split(os.pathsep)
            if item.strip()
        )
        settings = cls(
            enabled=_env_bool(values.get("AI_SANDBOX_ENABLED")),
            image=str(values.get("AI_SANDBOX_IMAGE", "")).strip(),
            opencode_version=str(values.get("AI_SANDBOX_OPENCODE_VERSION", BASELINE_OPENCODE_VERSION)).strip(),
            workspace_root=Path(values.get("AI_SANDBOX_WORKSPACE_ROOT", "/var/lib/hub-ai-sandbox/workspaces")),
            runtime_secret_root=Path(values.get("AI_SANDBOX_RUNTIME_SECRET_ROOT", "/run/user/10001/hub-ai-sandbox")),
            seccomp_profile=Path(values.get("AI_SANDBOX_SECCOMP_PROFILE", "/etc/hub-ai-sandbox/seccomp-opencode.json")),
            internal_network=str(values.get("AI_SANDBOX_INTERNAL_NETWORK", "hub-ai-internal")).strip(),
            llm_gateway_url=str(values.get("AI_SANDBOX_LLM_GATEWAY_URL", "http://hub-ai-llm-gateway:8080/v1")).strip(),
            content_transfer_url=str(values.get("AI_SANDBOX_CONTENT_TRANSFER_URL", "")).strip().rstrip("/"),
            content_transfer_allowed_host=str(
                values.get("AI_SANDBOX_CONTENT_TRANSFER_ALLOWED_HOST", "hub-ai-control")
            ).strip().lower(),
            content_transfer_ready=_env_bool(values.get("AI_SANDBOX_CONTENT_TRANSFER_READY")),
            transfer_auth_configured=bool(
                transfer_service_token
                and _is_valid_transfer_service_token(transfer_service_token)
            ),
            retention_days=int(values.get("AI_SANDBOX_RETENTION_DAYS", DEFAULT_RETENTION_DAYS)),
            retention_enabled=_env_bool(values.get("AI_SANDBOX_RETENTION_ENABLED", "true")),
            podman_binary=str(values.get("AI_SANDBOX_PODMAN_BINARY", "podman")).strip(),
            run_as_uid=int(values.get("AI_SANDBOX_UID", 10001)),
            run_as_gid=int(values.get("AI_SANDBOX_GID", 10001)),
            forbidden_roots=forbidden,
        )
        settings.validate(require_runtime_files=False)
        return settings

    def validate(self, *, require_runtime_files: bool) -> None:
        self.limits.validate()
        if not self.enabled:
            return

        validate_digest_image(self.image)
        if _parse_version(self.opencode_version) < _parse_version(MINIMUM_SAFE_OPENCODE_VERSION):
            raise SandboxConfigurationError(
                f"OpenCode {self.opencode_version} is below the safe minimum {MINIMUM_SAFE_OPENCODE_VERSION}"
            )
        if self.opencode_version != BASELINE_OPENCODE_VERSION:
            raise SandboxConfigurationError(
                f"The reviewed baseline is OpenCode {BASELINE_OPENCODE_VERSION}; rebuild and review before changing it"
            )
        workspace_absolute = self.workspace_root.is_absolute() or self.workspace_root.as_posix().startswith("/")
        secret_absolute = self.runtime_secret_root.is_absolute() or self.runtime_secret_root.as_posix().startswith("/")
        if not workspace_absolute or not secret_absolute:
            raise SandboxConfigurationError("Sandbox workspace and secret roots must be absolute")
        if self.workspace_root.resolve(strict=False) == self.runtime_secret_root.resolve(strict=False):
            raise SandboxConfigurationError("Runtime secrets must not be stored in a workspace")
        workspace_resolved = self.workspace_root.resolve(strict=False)
        code_resolved = self.hub_code_root.resolve(strict=False)
        try:
            workspace_resolved.relative_to(code_resolved)
        except ValueError:
            pass
        else:
            raise SandboxConfigurationError("Sandbox workspaces must not be stored inside the HUB code tree")
        if not _SAFE_NETWORK_RE.fullmatch(self.internal_network):
            raise SandboxConfigurationError("Only a dedicated hub-ai-internal network is allowed")
        gateway_url = urlsplit(self.llm_gateway_url)
        if (
            gateway_url.scheme.lower() not in {"http", "https"}
            or gateway_url.hostname != "hub-ai-llm-gateway"
            or gateway_url.port != 8080
            or gateway_url.path.rstrip("/") != "/v1"
            or gateway_url.username is not None
            or gateway_url.password is not None
            or gateway_url.query
            or gateway_url.fragment
        ):
            raise SandboxConfigurationError("OpenCode may only use the internal HUB LLM gateway service")
        self.validate_worker_control()
        if not (1 <= self.retention_days <= DEFAULT_RETENTION_DAYS):
            raise SandboxConfigurationError("Sandbox retention must be between 1 and 30 days")
        if self.run_as_uid <= 0 or self.run_as_gid <= 0:
            raise SandboxConfigurationError("Sandbox must run as a non-root UID/GID")
        if not self.podman_binary or Path(self.podman_binary).name.lower() not in {"podman", "podman.exe"}:
            raise SandboxConfigurationError("Only the Podman runtime is supported")
        if require_runtime_files and not self.seccomp_profile.is_file():
            raise SandboxConfigurationError(f"Seccomp profile is missing: {self.seccomp_profile}")

    def validate_worker_control(self) -> None:
        """Validate the worker-to-HUB boundary even in cleanup-only mode."""

        if not self.content_transfer_ready:
            raise SandboxConfigurationError("Authenticated sandbox content transfer must be explicitly ready")
        transfer_url = urlsplit(self.content_transfer_url)
        if (
            not _SAFE_CONTROL_HOST_RE.fullmatch(self.content_transfer_allowed_host)
            or
            transfer_url.scheme.lower() != "https"
            or not transfer_url.hostname
            or transfer_url.hostname.lower() != self.content_transfer_allowed_host
            or transfer_url.username is not None
            or transfer_url.password is not None
            or transfer_url.query
            or transfer_url.fragment
        ):
            raise SandboxConfigurationError(
                "Sandbox content transfer must use the configured internal HTTPS host"
            )
        if not self.transfer_auth_configured:
            raise SandboxConfigurationError(
                "AI_SANDBOX_TRANSFER_SERVICE_TOKEN must be a non-placeholder secret of at least 32 characters"
            )

    def validate_cleanup_runtime(self) -> None:
        """Validate destructive retention/cleanup targets with execution off."""

        self.limits.validate()
        workspace_absolute = self.workspace_root.is_absolute() or self.workspace_root.as_posix().startswith("/")
        workspace_resolved = self.workspace_root.resolve(strict=False)
        if not workspace_absolute or workspace_resolved == Path(workspace_resolved.anchor):
            raise SandboxConfigurationError("Sandbox cleanup workspace root is unsafe")
        code_resolved = self.hub_code_root.resolve(strict=False)
        try:
            workspace_resolved.relative_to(code_resolved)
        except ValueError:
            pass
        else:
            raise SandboxConfigurationError("Sandbox cleanup must not target the HUB code tree")
        if not (1 <= self.retention_days <= DEFAULT_RETENTION_DAYS):
            raise SandboxConfigurationError("Sandbox retention must be between 1 and 30 days")
        if not self.podman_binary or Path(self.podman_binary).name.lower() not in {"podman", "podman.exe"}:
            raise SandboxConfigurationError("Only the Podman runtime is supported")
