from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.paths import SandboxPathError  # noqa: E402
from backend.ai_sandbox.transfer import (  # noqa: E402
    InputTransferGrant,
    OneTimeTransferToken,
    OutputTransferGrant,
    SandboxContentTransferClient,
    SandboxTransferCredentials,
    SandboxTransferError,
)


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("f" * 64)
SERVICE_TOKEN = "service-token-abcdefghijklmnopqrstuvwxyz-0123456789"


def _settings(tmp_path: Path) -> SandboxSettings:
    return SandboxSettings(
        enabled=True,
        image=PINNED_TEST_IMAGE,
        workspace_root=tmp_path / "workspaces",
        runtime_secret_root=tmp_path / "runtime-secrets",
        seccomp_profile=tmp_path / "seccomp.json",
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )


class _JsonResponse:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _ManifestClient:
    def __init__(self, payload):
        self.payload = payload

    def post(self, *args, **kwargs):
        return _JsonResponse(self.payload)


class _StreamResponse:
    status_code = 200

    def __init__(self, chunks):
        self._chunks = chunks

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    def iter_bytes(self, *, chunk_size):
        yield from self._chunks


class _DownloadClient:
    def __init__(self, chunks):
        self.chunks = chunks
        self.headers = None

    def stream(self, method, url, *, headers):
        self.headers = headers
        return _StreamResponse(self.chunks)


def test_transfer_tokens_are_redacted_and_only_sha256_digest_is_stable() -> None:
    raw = "one-time-token-abcdefghijklmnopqrstuvwxyz-0123456789"
    token = OneTimeTransferToken(raw)
    credentials = SandboxTransferCredentials(SERVICE_TOKEN)

    assert token.digest() == hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert raw not in repr(token)
    assert SERVICE_TOKEN not in repr(credentials)
    assert token.authorization_header() == f"Bearer {raw}"
    assert credentials.authorization_header() == f"Bearer {SERVICE_TOKEN}"


@pytest.mark.parametrize(
    "file_name, download_path, expected_error",
    [
        (
            "../secret.txt",
            "/api/v1/chat/internal/ai/sandbox/transfers/grant-1",
            SandboxPathError,
        ),
        (
            "safe.txt",
            "https://attacker.invalid/api/v1/chat/internal/ai/sandbox/transfers/grant-1",
            SandboxTransferError,
        ),
    ],
)
def test_manifest_rejects_path_escape_in_name_or_transfer_endpoint(
    tmp_path: Path,
    file_name: str,
    download_path: str,
    expected_error: type[Exception],
) -> None:
    payload = {
        "job_id": "job-1",
        "conversation_id": "conversation-1",
        "job_type": "prompt",
        "prompt": "inspect",
        "inputs": [
            {
                "grant_id": "grant-1",
                "file_id": "file-1",
                "file_name": file_name,
                "content_type": "text/plain",
                "size_bytes": 4,
                "sha256": "a" * 64,
                "download_path": download_path,
                "token": "t" * 48,
                "expires_at": "2026-08-15T12:00:00Z",
            }
        ],
    }
    client = SandboxContentTransferClient(
        settings=_settings(tmp_path),
        credentials=SandboxTransferCredentials(SERVICE_TOKEN),
        http_client=_ManifestClient(payload),
    )

    with pytest.raises(expected_error, match="path|escaped"):
        client.fetch_manifest(job_id="job-1")


def test_input_download_rejects_hash_change_and_removes_partial_file(tmp_path: Path) -> None:
    workspace = tmp_path / "workspaces" / "session-1"
    workspace.mkdir(parents=True)
    raw_token = "input-token-abcdefghijklmnopqrstuvwxyz-0123456789"
    http_client = _DownloadClient([b"evil"])
    client = SandboxContentTransferClient(
        settings=_settings(tmp_path),
        credentials=SandboxTransferCredentials(SERVICE_TOKEN),
        http_client=http_client,
    )
    grant = InputTransferGrant(
        grant_id="grant-1",
        file_id="file-1",
        file_name="input.txt",
        content_type="text/plain",
        size_bytes=4,
        sha256=hashlib.sha256(b"safe").hexdigest(),
        download_path="/api/v1/chat/internal/ai/sandbox/transfers/grant-1",
        token=OneTimeTransferToken(raw_token),
        expires_at="2026-08-15T12:00:00Z",
    )

    with pytest.raises(SandboxTransferError, match="hash or size"):
        client.download_input(grant=grant, workspace=workspace)

    assert http_client.headers == {"Authorization": f"Bearer {raw_token}"}
    assert not (workspace / "input" / "grant-1" / "input.txt").exists()
    assert not list(workspace.rglob("*.part"))


def test_output_upload_retries_one_server_failure_with_same_scoped_token(tmp_path: Path) -> None:
    source = tmp_path / "result.txt"
    source.write_bytes(b"retry-safe-output")
    raw_token = "output-token-abcdefghijklmnopqrstuvwxyz-0123456789"

    class _RetryUploadClient:
        def __init__(self) -> None:
            self.calls: list[dict] = []

        def put(self, url, *, headers, files):
            self.calls.append({"url": url, "headers": dict(headers), "name": files["file"][0]})
            if len(self.calls) == 1:
                response = _JsonResponse({"detail": "temporary"})
                response.status_code = 503
                return response
            return _JsonResponse(
                {"message_id": "message-once", "attachment_id": "attachment-once"}
            )

    http_client = _RetryUploadClient()
    client = SandboxContentTransferClient(
        settings=_settings(tmp_path),
        credentials=SandboxTransferCredentials(SERVICE_TOKEN),
        http_client=http_client,
    )
    grant = OutputTransferGrant(
        grant_id="grant-output-1",
        upload_path="/api/v1/chat/internal/ai/sandbox/transfers/grant-output-1",
        size_bytes=source.stat().st_size,
        sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
        token=OneTimeTransferToken(raw_token),
        expires_at="2026-08-15T12:00:00Z",
    )

    result = client.upload_output(grant=grant, source=source)

    assert result == {"message_id": "message-once", "attachment_id": "attachment-once"}
    assert len(http_client.calls) == 2
    assert http_client.calls[0]["url"] == http_client.calls[1]["url"]
    assert http_client.calls[0]["headers"] == http_client.calls[1]["headers"] == {
        "Authorization": f"Bearer {raw_token}"
    }
