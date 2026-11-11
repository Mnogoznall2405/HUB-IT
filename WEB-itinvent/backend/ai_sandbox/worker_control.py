"""Authenticated worker-to-HUB control client for permissions and results."""
from __future__ import annotations

from typing import Any, Mapping
from urllib.parse import urljoin

from .config import SandboxSettings
from .transfer import SandboxTransferCredentials, SandboxTransferError, _safe_id


class SandboxWorkerControlClient:
    def __init__(
        self,
        *,
        settings: SandboxSettings,
        credentials: SandboxTransferCredentials,
        http_client: Any | None = None,
    ) -> None:
        settings.validate_worker_control()
        self._base_url = settings.content_transfer_url.rstrip("/") + "/"
        self._credentials = credentials
        self._client = http_client
        self._owns_client = http_client is None

    def __enter__(self) -> "SandboxWorkerControlClient":
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                timeout=httpx.Timeout(connect=10.0, read=30.0, write=120.0, pool=10.0),
                follow_redirects=False,
            )
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()
        self._client = None

    def _request(self, method: str, relative: str, **kwargs):
        if self._client is None:
            raise SandboxTransferError("Sandbox worker control client is not open")
        headers = dict(kwargs.pop("headers", {}) or {})
        headers["Authorization"] = self._credentials.authorization_header()
        response = self._client.request(
            method,
            urljoin(self._base_url, relative),
            headers=headers,
            **kwargs,
        )
        if int(response.status_code) != 200:
            raise SandboxTransferError("Sandbox worker control request was rejected")
        payload = response.json()
        if not isinstance(payload, dict):
            raise SandboxTransferError("Sandbox worker control response is invalid")
        return payload

    def create_permission(
        self,
        *,
        job_id: str,
        session_id: str,
        opencode_permission_id: str,
        tool: str,
        operation: str,
        arguments: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"jobs/{_safe_id(job_id, label='job id')}/permissions",
            json={
                "session_id": _safe_id(session_id, label="session id"),
                "opencode_permission_id": str(opencode_permission_id)[:200],
                "tool": str(tool)[:64],
                "operation": str(operation)[:2_000],
                "arguments": dict(arguments),
            },
        )

    def get_permission(self, *, job_id: str, permission_id: str) -> Mapping[str, Any]:
        return self._request(
            "GET",
            f"jobs/{_safe_id(job_id, label='job id')}/permissions/"
            f"{_safe_id(permission_id, label='permission id')}",
        )

    def record_result(
        self,
        *,
        job_id: str,
        opencode_session_id: str | None,
        assistant_markdown: str,
        files: list[dict[str, Any]],
    ) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"jobs/{_safe_id(job_id, label='job id')}/result",
            json={
                "opencode_session_id": opencode_session_id,
                "assistant_markdown": assistant_markdown,
                "files": files,
            },
        )

    def finalize_result(self, *, job_id: str, assistant_markdown: str) -> Mapping[str, Any]:
        return self._request(
            "POST",
            f"jobs/{_safe_id(job_id, label='job id')}/finalize",
            json={"assistant_markdown": assistant_markdown},
        )

    def publish_status(self, *, job_id: str) -> Mapping[str, Any]:
        return self._request("POST", f"jobs/{_safe_id(job_id, label='job id')}/status")

    def get_job_state(self, *, job_id: str) -> Mapping[str, Any]:
        return self._request("GET", f"jobs/{_safe_id(job_id, label='job id')}/status")
