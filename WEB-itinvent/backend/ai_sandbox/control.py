from __future__ import annotations

from dataclasses import dataclass
import ipaddress
import json
from threading import Lock
import time
from typing import AsyncIterator, Mapping, Protocol
from urllib.parse import quote

from .contracts import PermissionGrantScope


class OpenCodeControlError(ValueError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _opaque_path_id(value: str, *, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or len(normalized) > 200 or any(character in normalized for character in "\r\n\x00"):
        raise OpenCodeControlError(f"Invalid {label}")
    return quote(normalized, safe="")


@dataclass(frozen=True)
class OpenCodeApiPaths:
    """Paths from the reviewed OpenCode 1.18.18 server contract."""

    @staticmethod
    def create_session() -> str:
        return "/session"

    @staticmethod
    def async_prompt(session_id: str) -> str:
        return f"/session/{_opaque_path_id(session_id, label='session id')}/prompt_async"

    @staticmethod
    def abort(session_id: str) -> str:
        return f"/session/{_opaque_path_id(session_id, label='session id')}/abort"

    @staticmethod
    def diff(session_id: str) -> str:
        return f"/session/{_opaque_path_id(session_id, label='session id')}/diff"

    @staticmethod
    def permission(session_id: str, permission_id: str) -> str:
        return (
            f"/session/{_opaque_path_id(session_id, label='session id')}"
            f"/permissions/{_opaque_path_id(permission_id, label='permission id')}"
        )

    @staticmethod
    def events() -> str:
        return "/event"


def permission_response_payload(*, approved: bool, scope: PermissionGrantScope) -> Mapping[str, object]:
    """Build a response without ever persisting a global OpenCode grant.

    A session-scoped grant is remembered by HUB and replayed as an individual
    ``once`` response for matching requests. ``remember`` therefore always
    stays false at the OpenCode boundary.
    """

    if not isinstance(scope, PermissionGrantScope):
        scope = PermissionGrantScope(str(scope))
    return {
        "response": "once" if approved else "reject",
        "remember": False,
    }


class OpenCodeControlClient(Protocol):
    """Authenticated client used only on the internal sandbox network."""

    async def create_session(self) -> Mapping[str, object]: ...

    async def prompt_async(self, *, session_id: str, prompt: Mapping[str, object]) -> None: ...

    async def abort(self, *, session_id: str) -> None: ...

    async def get_diff(self, *, session_id: str) -> list[Mapping[str, object]]: ...

    async def answer_permission(
        self,
        *,
        session_id: str,
        permission_id: str,
        payload: Mapping[str, object],
    ) -> None: ...

    def events(self) -> AsyncIterator[Mapping[str, object]]: ...


class OpenCodeHttpControlClient:
    """Synchronous Basic-auth client used by the dedicated worker process."""

    def __init__(
        self,
        *,
        control_host: str,
        control_port: int,
        username: str,
        password: str,
        response_timeout_seconds: int,
        http_client: object | None = None,
    ) -> None:
        try:
            address = ipaddress.ip_address(str(control_host))
        except ValueError as exc:
            raise OpenCodeControlError("Invalid OpenCode loopback control address") from exc
        if address.version != 4 or not address.is_loopback or address.compressed != "127.0.0.1":
            raise OpenCodeControlError("OpenCode control address must be exact IPv4 loopback")
        port = int(control_port)
        if not (1024 <= port <= 65535):
            raise OpenCodeControlError("Invalid OpenCode loopback control port")
        if not username or not password or any(ch in f"{username}{password}" for ch in "\r\n\x00"):
            raise OpenCodeControlError("Invalid OpenCode Basic Auth credentials")
        self._base_url = f"http://127.0.0.1:{port}"
        self._username = username
        self._password = password
        self._response_timeout_seconds = max(1, min(int(response_timeout_seconds), 900))
        self._client = http_client
        self._owns_client = http_client is None
        self._event_response = None
        self._event_lock = Lock()

    def __repr__(self) -> str:
        return f"OpenCodeHttpControlClient(base_url={self._base_url!r}, credentials=<redacted>)"

    def __enter__(self) -> "OpenCodeHttpControlClient":
        if self._client is None:
            import httpx

            self._client = httpx.Client(
                auth=(self._username, self._password),
                # OpenCode heartbeats every 30 seconds. Cancel/deadline checks
                # run in a separate executor watchdog, so keep one lossless
                # SSE connection instead of reconnecting between heartbeats.
                timeout=httpx.Timeout(connect=5.0, read=45.0, write=30.0, pool=5.0),
                follow_redirects=False,
            )
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.interrupt_events()
        if self._owns_client and self._client is not None:
            self._client.close()
        self._client = None

    def _request(self, method: str, path: str, **kwargs):
        if self._client is None:
            raise OpenCodeControlError("OpenCode control client is not open")
        response = self._client.request(method, self._base_url + path, **kwargs)
        if int(response.status_code) < 200 or int(response.status_code) >= 300:
            raise OpenCodeControlError(
                f"OpenCode control request failed with status {response.status_code}",
                status_code=int(response.status_code),
            )
        return response

    def create_session(self, *, startup_timeout_seconds: int = 30) -> Mapping[str, object]:
        deadline = time.monotonic() + max(1, min(int(startup_timeout_seconds), 60))
        while True:
            try:
                response = self._request("POST", OpenCodeApiPaths.create_session(), json={})
                payload = response.json()
                if isinstance(payload, dict) and payload.get("id"):
                    return payload
                raise OpenCodeControlError("OpenCode returned no session id")
            except Exception as exc:
                if time.monotonic() >= deadline:
                    raise OpenCodeControlError("OpenCode server did not become ready") from exc
                time.sleep(0.2)

    def prompt_async(self, *, session_id: str, prompt: Mapping[str, object]) -> None:
        self._request("POST", OpenCodeApiPaths.async_prompt(session_id), json=dict(prompt))

    def abort(self, *, session_id: str) -> None:
        self._request("POST", OpenCodeApiPaths.abort(session_id), json={})

    def get_diff(self, *, session_id: str) -> list[Mapping[str, object]]:
        payload = self._request("GET", OpenCodeApiPaths.diff(session_id)).json()
        if not isinstance(payload, list):
            raise OpenCodeControlError("OpenCode diff response is invalid")
        return [item for item in payload if isinstance(item, dict)]

    def answer_permission(
        self,
        *,
        session_id: str,
        permission_id: str,
        payload: Mapping[str, object],
    ) -> None:
        self._request(
            "POST",
            OpenCodeApiPaths.permission(session_id, permission_id),
            json=dict(payload),
        )

    def events(self):
        if self._client is None:
            raise OpenCodeControlError("OpenCode control client is not open")
        with self._client.stream("GET", self._base_url + OpenCodeApiPaths.events()) as response:
            with self._event_lock:
                self._event_response = response
            try:
                if int(response.status_code) != 200:
                    raise OpenCodeControlError("OpenCode event stream was rejected")
                for line in response.iter_lines():
                    normalized = str(line or "").strip()
                    if not normalized.startswith("data:"):
                        continue
                    raw = normalized[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(payload, dict):
                        yield payload
            finally:
                with self._event_lock:
                    if self._event_response is response:
                        self._event_response = None

    def interrupt_events(self) -> None:
        with self._event_lock:
            response = self._event_response
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
