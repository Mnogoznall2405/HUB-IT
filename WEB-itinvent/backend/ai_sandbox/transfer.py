from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping
from urllib.parse import urljoin, urlsplit

import httpx

from .config import SandboxSettings, validate_transfer_service_token
from .paths import normalize_upload_name, resolve_workspace_path


class SandboxTransferError(RuntimeError):
    """Fail-closed error at the chat-host <-> sandbox-worker boundary."""


class SandboxTransferCredentials:
    __slots__ = ("_service_token",)

    def __init__(self, service_token: str) -> None:
        self._service_token = validate_transfer_service_token(service_token)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "SandboxTransferCredentials":
        values = os.environ if environ is None else environ
        return cls(str(values.get("AI_SANDBOX_TRANSFER_SERVICE_TOKEN", "") or ""))

    def authorization_header(self) -> str:
        return f"Bearer {self._service_token}"

    def matches_authorization_header(self, value: str | None) -> bool:
        candidate = str(value or "")
        expected = self.authorization_header()
        return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))

    def __repr__(self) -> str:
        return "SandboxTransferCredentials(service_token=<redacted>)"


class OneTimeTransferToken:
    __slots__ = ("_value",)

    def __init__(self, value: str | None = None) -> None:
        candidate = str(value or secrets.token_urlsafe(48)).strip()
        if len(candidate) < 32 or any(character in candidate for character in "\r\n\x00"):
            raise SandboxTransferError("Invalid one-time transfer token")
        self._value = candidate

    def reveal(self) -> str:
        return self._value

    def digest(self) -> str:
        return hashlib.sha256(self._value.encode("utf-8")).hexdigest()

    def authorization_header(self) -> str:
        return f"Bearer {self._value}"

    def __repr__(self) -> str:
        return "OneTimeTransferToken(<redacted>)"


@dataclass(frozen=True)
class InputTransferGrant:
    grant_id: str
    file_id: str
    file_name: str
    content_type: str
    size_bytes: int
    sha256: str
    download_path: str
    token: OneTimeTransferToken
    expires_at: str

    def __repr__(self) -> str:
        return (
            f"InputTransferGrant(grant_id={self.grant_id!r}, file_id={self.file_id!r}, "
            f"file_name={self.file_name!r}, size_bytes={self.size_bytes!r}, token=<redacted>)"
        )


@dataclass(frozen=True)
class SandboxJobManifest:
    job_id: str
    conversation_id: str
    job_type: str
    target_file_id: str | None
    target_file: Mapping[str, object] | None
    prompt: str
    inputs: tuple[InputTransferGrant, ...]


@dataclass(frozen=True)
class OutputTransferGrant:
    grant_id: str
    upload_path: str
    size_bytes: int
    sha256: str
    token: OneTimeTransferToken
    expires_at: str

    def __repr__(self) -> str:
        return (
            f"OutputTransferGrant(grant_id={self.grant_id!r}, size_bytes={self.size_bytes!r}, "
            "token=<redacted>)"
        )


def _safe_id(value: object, *, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or len(normalized) > 128 or not all(character.isalnum() or character in "-_" for character in normalized):
        raise SandboxTransferError(f"Invalid {label}")
    return normalized


def _safe_relative_endpoint(value: object, *, prefix: str) -> str:
    normalized = str(value or "").strip()
    if not normalized.startswith(prefix) or urlsplit(normalized).scheme or urlsplit(normalized).netloc:
        raise SandboxTransferError("Transfer endpoint escaped the configured control service")
    return normalized


def _safe_workspace_relative(value: object) -> str:
    raw = str(value or "").replace("\\", "/")
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SandboxTransferError("Invalid workspace-relative path")
    return path.as_posix()


class SandboxContentTransferClient:
    """Worker-host client; credentials never enter a container or process argv."""

    def __init__(
        self,
        *,
        settings: SandboxSettings,
        credentials: SandboxTransferCredentials,
        http_client: Any | None = None,
    ) -> None:
        settings.validate(require_runtime_files=False)
        self._base_url = settings.content_transfer_url.rstrip("/") + "/"
        parsed_base = urlsplit(self._base_url)
        self._origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
        self._credentials = credentials
        self._http_client = http_client
        self._owns_client = http_client is None

    def __enter__(self) -> "SandboxContentTransferClient":
        if self._http_client is None:
            import httpx

            self._http_client = httpx.Client(
                timeout=httpx.Timeout(connect=10.0, read=120.0, write=120.0, pool=10.0),
                follow_redirects=False,
            )
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self._owns_client and self._http_client is not None:
            self._http_client.close()
        self._http_client = None

    def _client(self):
        if self._http_client is None:
            raise SandboxTransferError("Content transfer client is not open")
        return self._http_client

    def fetch_manifest(self, *, job_id: str) -> SandboxJobManifest:
        safe_job_id = _safe_id(job_id, label="job id")
        response = self._client().post(
            urljoin(self._base_url, f"jobs/{safe_job_id}/manifest"),
            headers={"Authorization": self._credentials.authorization_header()},
        )
        if int(response.status_code) != 200:
            raise SandboxTransferError("Sandbox input manifest was not authorized")
        payload = response.json()
        job_type = str(payload.get("job_type") or "prompt")
        if job_type not in {"prompt", "archive", "attach_file"}:
            raise SandboxTransferError("Unsupported sandbox job type")
        prompt = str(payload.get("prompt") or "")
        if (job_type == "prompt" and not prompt) or len(prompt.encode("utf-8")) > 1024 * 1024:
            raise SandboxTransferError("Sandbox prompt is empty or exceeds 1 MiB")
        grants: list[InputTransferGrant] = []
        for item in list(payload.get("inputs") or []):
            size_bytes = int(item.get("size_bytes") or 0)
            sha256 = str(item.get("sha256") or "").lower()
            if not (0 <= size_bytes <= 256 * 1024**2) or len(sha256) != 64:
                raise SandboxTransferError("Invalid sandbox input metadata")
            grants.append(
                InputTransferGrant(
                    grant_id=_safe_id(item.get("grant_id"), label="grant id"),
                    file_id=_safe_id(item.get("file_id"), label="file id"),
                    file_name=normalize_upload_name(str(item.get("file_name") or "input.bin")),
                    content_type=str(item.get("content_type") or "application/octet-stream")[:255],
                    size_bytes=size_bytes,
                    sha256=sha256,
                    download_path=_safe_relative_endpoint(
                        item.get("download_path"),
                        prefix="/api/v1/chat/internal/ai/sandbox/transfers/",
                    ),
                    token=OneTimeTransferToken(str(item.get("token") or "")),
                    expires_at=str(item.get("expires_at") or ""),
                )
            )
        return SandboxJobManifest(
            job_id=safe_job_id,
            conversation_id=_safe_id(payload.get("conversation_id"), label="conversation id"),
            job_type=job_type,
            target_file_id=(
                _safe_id(payload.get("target_file_id"), label="target file id")
                if payload.get("target_file_id")
                else None
            ),
            target_file=(
                {
                    "path": _safe_workspace_relative(payload["target_file"].get("path")),
                    "name": normalize_upload_name(str(payload["target_file"].get("name") or "result.bin")),
                    "size_bytes": int(payload["target_file"].get("size_bytes") or 0),
                    "sha256": str(payload["target_file"].get("sha256") or "").lower(),
                }
                if isinstance(payload.get("target_file"), dict)
                else None
            ),
            prompt=prompt,
            inputs=tuple(grants),
        )

    def download_input(self, *, grant: InputTransferGrant, workspace: Path) -> Path:
        destination = resolve_workspace_path(workspace, f"input/{grant.grant_id}/{grant.file_name}")
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if destination.exists() or destination.is_symlink():
            raise SandboxTransferError("Sandbox input destination already exists")
        temp_path = destination.with_name(f".{destination.name}.{secrets.token_hex(8)}.part")
        digest = hashlib.sha256()
        written = 0
        try:
            with self._client().stream(
                "GET",
                f"{self._origin}{grant.download_path}",
                headers={"Authorization": grant.token.authorization_header()},
            ) as response:
                if int(response.status_code) != 200:
                    raise SandboxTransferError("One-time sandbox input download was rejected")
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
                descriptor = os.open(temp_path, flags, 0o600)
                try:
                    with os.fdopen(descriptor, "wb", closefd=False) as handle:
                        for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                            written += len(chunk)
                            if written > grant.size_bytes:
                                raise SandboxTransferError("Sandbox input exceeded its verified size")
                            digest.update(chunk)
                            handle.write(chunk)
                        handle.flush()
                        os.fsync(handle.fileno())
                finally:
                    os.close(descriptor)
            if written != grant.size_bytes or not hmac.compare_digest(digest.hexdigest(), grant.sha256):
                raise SandboxTransferError("Sandbox input hash or size changed in transit")
            temp_stat = temp_path.lstat()
            if not stat.S_ISREG(temp_stat.st_mode) or temp_stat.st_nlink != 1:
                raise SandboxTransferError("Sandbox input staging produced an unsafe file")
            temp_path.replace(destination)
            os.chmod(destination, 0o600)
            return destination
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    def request_output_grant(self, *, job_id: str, file_id: str) -> OutputTransferGrant:
        safe_job_id = _safe_id(job_id, label="job id")
        safe_file_id = _safe_id(file_id, label="file id")
        response = self._client().post(
            urljoin(self._base_url, f"jobs/{safe_job_id}/outputs/{safe_file_id}/grant"),
            headers={"Authorization": self._credentials.authorization_header()},
        )
        if int(response.status_code) != 200:
            raise SandboxTransferError("Sandbox output transfer grant was not authorized")
        payload = response.json()
        size_bytes = int(payload.get("size_bytes") or 0)
        sha256 = str(payload.get("sha256") or "").lower()
        if not (0 <= size_bytes <= 1024**3) or len(sha256) != 64:
            raise SandboxTransferError("Invalid sandbox output grant metadata")
        return OutputTransferGrant(
            grant_id=_safe_id(payload.get("grant_id"), label="grant id"),
            upload_path=_safe_relative_endpoint(
                payload.get("upload_path"),
                prefix="/api/v1/chat/internal/ai/sandbox/transfers/",
            ),
            size_bytes=size_bytes,
            sha256=sha256,
            token=OneTimeTransferToken(str(payload.get("token") or "")),
            expires_at=str(payload.get("expires_at") or ""),
        )

    def upload_output(self, *, grant: OutputTransferGrant, source: Path) -> Mapping[str, object]:
        path = source.resolve(strict=True)
        source_stat = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(source_stat.st_mode)
            or source_stat.st_nlink != 1
            or int(source_stat.st_size) != grant.size_bytes
        ):
            raise SandboxTransferError("Sandbox output is not a verified regular file")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        if not hmac.compare_digest(digest.hexdigest(), grant.sha256):
            raise SandboxTransferError("Sandbox output hash changed before upload")
        response = None
        for attempt in range(2):
            try:
                with path.open("rb") as handle:
                    response = self._client().put(
                        f"{self._origin}{grant.upload_path}",
                        headers={"Authorization": grant.token.authorization_header()},
                        files={"file": (path.name, handle, "application/octet-stream")},
                    )
                if int(response.status_code) >= 500 and attempt == 0:
                    # The chat host may have committed deterministic delivery
                    # before an app-DB/HTTP failure. Retrying the same scoped
                    # grant reconciles it without a second attachment.
                    continue
                break
            except httpx.TransportError as exc:
                if attempt >= 1:
                    raise SandboxTransferError("Sandbox output response was lost after retry") from exc
        if response is None:  # pragma: no cover - defensive invariant
            raise SandboxTransferError("Sandbox output upload produced no response")
        if int(response.status_code) != 200:
            raise SandboxTransferError("Sandbox output upload was rejected")
        payload = response.json()
        if not payload.get("message_id") or not payload.get("attachment_id"):
            raise SandboxTransferError("Sandbox output response is incomplete")
        return payload
