"""Deterministic two-node Chat realtime smoke probe.

The probe keeps the sender websocket on node A and the recipient websocket on
node B.  It verifies inbox-only delivery, room+inbox de-duplication, a read
receipt in the reverse direction, and delivery after a recipient reconnect.

It does not start, stop, or restart services.  Use credentials created by
``seed_hub_chat_loadtest_users.py`` and clean them with the matching cleanup
script after the probe.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

import httpx

try:
    import websockets
    from websockets.exceptions import ConnectionClosed
except Exception:  # pragma: no cover - reported as an actionable runtime error
    websockets = None

    class ConnectionClosed(Exception):
        pass


DEFAULT_AUTH_API_BASE = "http://127.0.0.1:8001/api/v1"
DEFAULT_NODE_A_API_BASE = "http://127.0.0.1:8002/api/v1"
DEFAULT_NODE_B_API_BASE = "http://127.0.0.1:8004/api/v1"


@dataclass(frozen=True)
class Credential:
    username: str
    password: str


@dataclass(frozen=True)
class AuthSession:
    credential: Credential
    user_id: int
    access_token: str
    cookie_header: str
    client_ip: str = ""

    def http_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        if self.cookie_header:
            headers["Cookie"] = self.cookie_header
        if self.client_ip:
            headers["X-Forwarded-For"] = self.client_ip
            headers["X-Real-IP"] = self.client_ip
        return headers

    def ws_headers(self) -> list[tuple[str, str]]:
        return list(self.http_headers().items())


class ProbeFailure(RuntimeError):
    pass


def _normalized_api_base(value: str) -> str:
    return str(value or "").strip().rstrip("/")


def api_to_ws_url(api_base: str) -> str:
    parsed = urlsplit(_normalized_api_base(api_base))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, parsed.netloc, f"{parsed.path}/chat/ws", "", ""))


def api_to_readiness_url(api_base: str) -> str:
    parsed = urlsplit(_normalized_api_base(api_base))
    return urlunsplit((parsed.scheme, parsed.netloc, "/health/ready", "", ""))


def build_ssl_context(insecure: bool) -> ssl.SSLContext | None:
    if not insecure:
        return None
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def load_credentials(path: str | Path) -> list[Credential]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = payload.get("users") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ProbeFailure("users file must contain a JSON list or {\"users\": [...]} object")
    result: list[Credential] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        username = str(row.get("username") or "").strip()
        password = str(row.get("password") or "")
        if username and password:
            result.append(Credential(username=username, password=password))
    if len(result) < 2:
        raise ProbeFailure("at least two usable credentials are required")
    return result


def _cookie_header(client: httpx.AsyncClient) -> str:
    parts = [
        f"{cookie.name}={cookie.value}"
        for cookie in client.cookies.jar
        if str(getattr(cookie, "name", "")) and str(getattr(cookie, "value", ""))
    ]
    return "; ".join(parts)


async def login(
    *,
    api_base: str,
    credential: Credential,
    verify: bool | ssl.SSLContext,
    timeout_sec: float,
    client_ip: str = "",
) -> AuthSession:
    # The probe uses bearer auth intentionally: secure browser cookies are not
    # sent over the loopback HTTP URLs used to pin each websocket to a node.
    network_headers = {"X-Auth-Client": "mobile"}
    if str(client_ip or "").strip():
        network_headers.update(
            {
                "X-Forwarded-For": str(client_ip).strip(),
                "X-Real-IP": str(client_ip).strip(),
            }
        )
    async with httpx.AsyncClient(
        base_url=_normalized_api_base(api_base),
        headers=network_headers,
        verify=verify,
        timeout=timeout_sec,
    ) as client:
        response = await client.post(
            "/auth/login",
            json={"username": credential.username, "password": credential.password},
        )
        if response.status_code >= 400:
            raise ProbeFailure(f"login {credential.username}: HTTP {response.status_code} {response.text[:200]}")
        payload = response.json()
        if str((payload or {}).get("status") or "authenticated") != "authenticated":
            raise ProbeFailure(f"login {credential.username}: password-only authentication is required")
        token = str((payload or {}).get("access_token") or "").strip()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        me = await client.get("/auth/me", headers=headers)
        if me.status_code >= 400:
            raise ProbeFailure(f"auth/me {credential.username}: HTTP {me.status_code} {me.text[:200]}")
        user_id = int((me.json() or {}).get("id") or 0)
        if user_id <= 0:
            raise ProbeFailure(f"auth/me {credential.username}: response has no user id")
        return AuthSession(
            credential=credential,
            user_id=user_id,
            access_token=token,
            cookie_header=_cookie_header(client),
            client_ip=str(client_ip or "").strip(),
        )


async def fetch_readiness(
    *,
    api_base: str,
    verify: bool | ssl.SSLContext,
    timeout_sec: float,
) -> dict[str, Any]:
    url = api_to_readiness_url(api_base)
    async with httpx.AsyncClient(verify=verify, timeout=timeout_sec) as client:
        response = await client.get(url)
    try:
        payload = response.json()
    except Exception:
        payload = {"body": response.text[:200]}
    if response.status_code != 200 or (isinstance(payload, dict) and payload.get("ready") is False):
        raise ProbeFailure(f"readiness failed for {url}: HTTP {response.status_code} {payload}")
    return payload if isinstance(payload, dict) else {"payload": payload}


async def fetch_chat_health(
    *,
    api_base: str,
    auth: AuthSession,
    verify: bool | ssl.SSLContext,
    timeout_sec: float,
) -> dict[str, Any]:
    async with httpx.AsyncClient(
        base_url=_normalized_api_base(api_base),
        headers=auth.http_headers(),
        verify=verify,
        timeout=timeout_sec,
    ) as client:
        response = await client.get("/chat/health")
    if response.status_code != 200:
        raise ProbeFailure(f"chat health failed for {api_base}: HTTP {response.status_code} {response.text[:200]}")
    payload = response.json()
    if not isinstance(payload, dict) or payload.get("available") is False:
        raise ProbeFailure(f"chat unavailable for {api_base}: {payload}")
    return payload


def validate_distinct_ready_nodes(health_a: dict[str, Any], health_b: dict[str, Any]) -> None:
    node_a = str(health_a.get("realtime_node_id") or "").strip()
    node_b = str(health_b.get("realtime_node_id") or "").strip()
    if not node_a or not node_b:
        raise ProbeFailure("chat health must expose realtime_node_id on both nodes")
    if node_a == node_b:
        raise ProbeFailure(f"both API bases resolve to the same realtime node: {node_a}")
    local_modes = {"", "local", "local_fallback"}
    modes = {
        str(health_a.get("realtime_mode") or "").strip().lower(),
        str(health_b.get("realtime_mode") or "").strip().lower(),
    }
    if modes & local_modes:
        raise ProbeFailure(f"distributed realtime transport is not ready: modes={sorted(modes)}")


async def ensure_direct_conversation(
    *,
    node_a_api_base: str,
    sender: AuthSession,
    recipient_user_id: int,
    verify: bool | ssl.SSLContext,
    timeout_sec: float,
) -> str:
    async with httpx.AsyncClient(
        base_url=_normalized_api_base(node_a_api_base),
        headers=sender.http_headers(),
        verify=verify,
        timeout=timeout_sec,
    ) as client:
        response = await client.post(
            "/chat/conversations/direct",
            json={"peer_user_id": int(recipient_user_id)},
        )
    if response.status_code >= 400:
        raise ProbeFailure(f"create direct conversation: HTTP {response.status_code} {response.text[:240]}")
    conversation_id = str((response.json() or {}).get("id") or "").strip()
    if not conversation_id:
        raise ProbeFailure("create direct conversation returned no id")
    return conversation_id


EventPredicate = Callable[[dict[str, Any]], bool]


class ProbeSocket:
    """Single-reader websocket client with correlated command waiters and event history."""

    def __init__(self, ws: Any, *, label: str) -> None:
        self.ws = ws
        self.label = label
        self.events: list[dict[str, Any]] = []
        self.pending: dict[str, asyncio.Future] = {}
        self._changed = asyncio.Condition()
        self._reader = asyncio.create_task(self._read_loop(), name=f"cross-node-reader-{label}")

    @classmethod
    async def connect(
        cls,
        *,
        ws_url: str,
        headers: list[tuple[str, str]],
        ssl_context: bool | ssl.SSLContext | None,
        label: str,
        timeout_sec: float,
    ) -> "ProbeSocket":
        if websockets is None:
            raise ProbeFailure("websockets package is required")
        kwargs: dict[str, Any] = {
            "additional_headers": headers,
            "open_timeout": timeout_sec,
            "max_queue": 256,
            "ping_interval": 20,
            "ping_timeout": 20,
        }
        if ssl_context is not None:
            kwargs["ssl"] = ssl_context
        ws = await websockets.connect(ws_url, **kwargs)
        return cls(ws, label=label)

    async def _read_loop(self) -> None:
        try:
            while True:
                raw = await self.ws.recv()
                try:
                    message = json.loads(raw)
                except Exception:
                    continue
                if not isinstance(message, dict):
                    continue
                request_id = str(message.get("request_id") or "")
                waiter = self.pending.get(request_id) if request_id else None
                if waiter is not None and not waiter.done():
                    waiter.set_result(message)
                    continue
                async with self._changed:
                    self.events.append(message)
                    self._changed.notify_all()
        except (ConnectionClosed, asyncio.CancelledError):
            pass
        except Exception as exc:
            async with self._changed:
                self.events.append({"type": "probe.transport.error", "payload": {"detail": str(exc)}})
                self._changed.notify_all()

    async def command(
        self,
        command_type: str,
        *,
        conversation_id: str | None = None,
        payload: dict[str, Any] | None = None,
        timeout_sec: float,
    ) -> tuple[dict[str, Any], float]:
        request_id = f"cross-{uuid.uuid4().hex}"
        envelope: dict[str, Any] = {"type": command_type, "request_id": request_id}
        if conversation_id:
            envelope["conversation_id"] = conversation_id
        if payload is not None:
            envelope["payload"] = payload
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        started = time.perf_counter()
        try:
            await self.ws.send(json.dumps(envelope, ensure_ascii=False))
            response = await asyncio.wait_for(future, timeout=timeout_sec)
        finally:
            self.pending.pop(request_id, None)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        event_type = str(response.get("type") or "")
        nested = response.get("payload") if isinstance(response.get("payload"), dict) else {}
        if event_type.endswith(".error") or str(nested.get("code") or response.get("code") or ""):
            raise ProbeFailure(f"{self.label} {command_type}: {response}")
        return response, elapsed_ms

    async def wait_for_event(self, predicate: EventPredicate, *, timeout_sec: float, start_index: int = 0) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_sec
        while True:
            for event in self.events[max(0, int(start_index)) :]:
                if predicate(event):
                    return event
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProbeFailure(f"{self.label}: expected realtime event was not received in {timeout_sec:.1f}s")
            async with self._changed:
                try:
                    await asyncio.wait_for(self._changed.wait(), timeout=remaining)
                except asyncio.TimeoutError as exc:
                    raise ProbeFailure(
                        f"{self.label}: expected realtime event was not received in {timeout_sec:.1f}s"
                    ) from exc

    async def close(self) -> None:
        try:
            await self.ws.close(code=1000, reason="cross-node probe reconnect/teardown")
        finally:
            self._reader.cancel()
            try:
                await self._reader
            except asyncio.CancelledError:
                pass


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    value = event.get("payload")
    return value if isinstance(value, dict) else {}


def message_created_predicate(client_message_id: str) -> EventPredicate:
    expected = str(client_message_id or "").strip()
    return lambda event: (
        str(event.get("type") or "") == "chat.message.created"
        and str(_payload(event).get("client_message_id") or "").strip() == expected
    )


def message_read_predicate(message_id: str, reader_user_id: int) -> EventPredicate:
    expected_message_id = str(message_id or "").strip()
    expected_reader = int(reader_user_id)
    return lambda event: (
        str(event.get("type") or "") == "chat.message.read"
        and str(_payload(event).get("message_id") or "").strip() == expected_message_id
        and int(_payload(event).get("reader_user_id") or 0) == expected_reader
    )


async def require_exactly_once(
    socket: ProbeSocket,
    predicate: EventPredicate,
    *,
    start_index: int,
    timeout_sec: float,
    settle_sec: float,
    label: str,
) -> tuple[dict[str, Any], float]:
    started = time.perf_counter()
    event = await socket.wait_for_event(predicate, timeout_sec=timeout_sec, start_index=start_index)
    observed_ms = (time.perf_counter() - started) * 1000.0
    await asyncio.sleep(max(0.05, settle_sec))
    matches = [item for item in socket.events[start_index:] if predicate(item)]
    if len(matches) != 1:
        raise ProbeFailure(f"{label}: expected exactly one event, observed {len(matches)}")
    return event, observed_ms


def _ack_message_id(response: dict[str, Any]) -> str:
    payload = _payload(response)
    message = payload.get("message") if isinstance(payload.get("message"), dict) else {}
    return str(payload.get("message_id") or message.get("id") or "").strip()


async def _send_probe_message(
    *,
    sender_socket: ProbeSocket,
    recipient_socket: ProbeSocket,
    conversation_id: str,
    phase: str,
    timeout_sec: float,
    settle_sec: float,
) -> dict[str, Any]:
    client_message_id = f"cross-node-{phase}-{uuid.uuid4().hex}"
    start_index = len(recipient_socket.events)
    response, ack_ms = await sender_socket.command(
        "chat.send_message",
        conversation_id=conversation_id,
        payload={
            "body": f"cross-node probe {phase} {client_message_id}",
            "body_format": "plain",
            "client_message_id": client_message_id,
        },
        timeout_sec=timeout_sec,
    )
    message_id = _ack_message_id(response)
    if not message_id:
        raise ProbeFailure(f"{phase}: sender ACK has no message_id: {response}")
    _event, delivery_ms = await require_exactly_once(
        recipient_socket,
        message_created_predicate(client_message_id),
        start_index=start_index,
        timeout_sec=timeout_sec,
        settle_sec=settle_sec,
        label=phase,
    )
    return {
        "phase": phase,
        "client_message_id": client_message_id,
        "message_id": message_id,
        "ack_ms": round(ack_ms, 1),
        "delivery_ms": round(delivery_ms, 1),
        "delivery_count": 1,
    }


async def run_probe(args: argparse.Namespace) -> dict[str, Any]:
    insecure_context = build_ssl_context(bool(args.insecure))
    verify: bool | ssl.SSLContext = insecure_context or True
    ws_ssl: ssl.SSLContext | None = insecure_context
    credentials = load_credentials(args.users_file)
    try:
        sender_credential = credentials[int(args.sender_index)]
        recipient_credential = credentials[int(args.recipient_index)]
    except IndexError as exc:
        raise ProbeFailure(
            f"credential index is out of range for {len(credentials)} users: "
            f"sender={args.sender_index}, recipient={args.recipient_index}"
        ) from exc
    if sender_credential.username == recipient_credential.username:
        raise ProbeFailure("sender and recipient must be different users")

    sender, recipient = await asyncio.gather(
        login(
            api_base=args.auth_api_base,
            credential=sender_credential,
            verify=verify,
            timeout_sec=args.timeout_sec,
            client_ip=args.client_ip,
        ),
        login(
            api_base=args.auth_api_base,
            credential=recipient_credential,
            verify=verify,
            timeout_sec=args.timeout_sec,
            client_ip=args.client_ip,
        ),
    )
    ready_a, ready_b, health_a, health_b = await asyncio.gather(
        fetch_readiness(api_base=args.node_a_api_base, verify=verify, timeout_sec=args.timeout_sec),
        fetch_readiness(api_base=args.node_b_api_base, verify=verify, timeout_sec=args.timeout_sec),
        fetch_chat_health(
            api_base=args.node_a_api_base,
            auth=sender,
            verify=verify,
            timeout_sec=args.timeout_sec,
        ),
        fetch_chat_health(
            api_base=args.node_b_api_base,
            auth=recipient,
            verify=verify,
            timeout_sec=args.timeout_sec,
        ),
    )
    validate_distinct_ready_nodes(health_a, health_b)
    conversation_id = await ensure_direct_conversation(
        node_a_api_base=args.node_a_api_base,
        sender=sender,
        recipient_user_id=recipient.user_id,
        verify=verify,
        timeout_sec=args.timeout_sec,
    )

    sender_socket: ProbeSocket | None = None
    recipient_socket: ProbeSocket | None = None
    phases: list[dict[str, Any]] = []
    try:
        sender_socket, recipient_socket = await asyncio.gather(
            ProbeSocket.connect(
                ws_url=api_to_ws_url(args.node_a_api_base),
                headers=sender.ws_headers(),
                ssl_context=ws_ssl,
                label="sender-node-a",
                timeout_sec=args.timeout_sec,
            ),
            ProbeSocket.connect(
                ws_url=api_to_ws_url(args.node_b_api_base),
                headers=recipient.ws_headers(),
                ssl_context=ws_ssl,
                label="recipient-node-b",
                timeout_sec=args.timeout_sec,
            ),
        )
        await sender_socket.command("chat.subscribe_inbox", timeout_sec=args.timeout_sec)
        await sender_socket.command(
            "chat.subscribe_conversation",
            conversation_id=conversation_id,
            timeout_sec=args.timeout_sec,
        )
        await recipient_socket.command("chat.subscribe_inbox", timeout_sec=args.timeout_sec)

        # Inbox-only path: recipient deliberately hasn't joined the room yet.
        phases.append(
            await _send_probe_message(
                sender_socket=sender_socket,
                recipient_socket=recipient_socket,
                conversation_id=conversation_id,
                phase="inbox_only",
                timeout_sec=args.timeout_sec,
                settle_sec=args.settle_sec,
            )
        )

        # Room + inbox path must still result in a single logical event.
        await recipient_socket.command(
            "chat.subscribe_conversation",
            conversation_id=conversation_id,
            timeout_sec=args.timeout_sec,
        )
        room_phase = await _send_probe_message(
            sender_socket=sender_socket,
            recipient_socket=recipient_socket,
            conversation_id=conversation_id,
            phase="room_and_inbox",
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
        )
        phases.append(room_phase)

        read_start_index = len(sender_socket.events)
        _mark_ack, mark_read_ms = await recipient_socket.command(
            "chat.mark_read",
            conversation_id=conversation_id,
            payload={"message_id": room_phase["message_id"]},
            timeout_sec=args.timeout_sec,
        )
        _event, receipt_ms = await require_exactly_once(
            sender_socket,
            message_read_predicate(room_phase["message_id"], recipient.user_id),
            start_index=read_start_index,
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
            label="read_receipt",
        )
        phases.append(
            {
                "phase": "read_receipt",
                "message_id": room_phase["message_id"],
                "mark_read_ack_ms": round(mark_read_ms, 1),
                "receipt_ms": round(receipt_ms, 1),
                "receipt_count": 1,
            }
        )

        # Reconnect the recipient to the same node, restore subscriptions, and
        # verify that no stale listener or duplicate delivery survives.
        await recipient_socket.close()
        reconnect_started = time.perf_counter()
        recipient_socket = await ProbeSocket.connect(
            ws_url=api_to_ws_url(args.node_b_api_base),
            headers=recipient.ws_headers(),
            ssl_context=ws_ssl,
            label="recipient-node-b-reconnected",
            timeout_sec=args.timeout_sec,
        )
        await recipient_socket.command("chat.subscribe_inbox", timeout_sec=args.timeout_sec)
        await recipient_socket.command(
            "chat.subscribe_conversation",
            conversation_id=conversation_id,
            timeout_sec=args.timeout_sec,
        )
        reconnect_ms = (time.perf_counter() - reconnect_started) * 1000.0
        reconnect_phase = await _send_probe_message(
            sender_socket=sender_socket,
            recipient_socket=recipient_socket,
            conversation_id=conversation_id,
            phase="after_reconnect",
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
        )
        reconnect_phase["reconnect_and_resubscribe_ms"] = round(reconnect_ms, 1)
        phases.append(reconnect_phase)

        post_ready_a, post_ready_b = await asyncio.gather(
            fetch_readiness(api_base=args.node_a_api_base, verify=verify, timeout_sec=args.timeout_sec),
            fetch_readiness(api_base=args.node_b_api_base, verify=verify, timeout_sec=args.timeout_sec),
        )
    finally:
        await asyncio.gather(
            *(socket.close() for socket in (sender_socket, recipient_socket) if socket is not None),
            return_exceptions=True,
        )

    return {
        "ok": True,
        "sender": sender.credential.username,
        "recipient": recipient.credential.username,
        "conversation_id": conversation_id,
        "nodes": {
            "a": {
                "api_base": args.node_a_api_base,
                "realtime_node_id": health_a.get("realtime_node_id"),
                "realtime_mode": health_a.get("realtime_mode"),
                "ready_before": ready_a,
                "ready_after": post_ready_a,
            },
            "b": {
                "api_base": args.node_b_api_base,
                "realtime_node_id": health_b.get("realtime_node_id"),
                "realtime_mode": health_b.get("realtime_mode"),
                "ready_before": ready_b,
                "ready_after": post_ready_b,
            },
        },
        "phases": phases,
        "gates": {
            "distinct_nodes": True,
            "distributed_transport_ready": True,
            "inbox_delivery_exactly_once": True,
            "room_and_inbox_delivery_exactly_once": True,
            "cross_node_read_receipt_exactly_once": True,
            "delivery_after_reconnect_exactly_once": True,
            "both_nodes_ready_after_probe": True,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cross-node Chat realtime smoke probe (A: sender, B: recipient).")
    parser.add_argument("--auth-api-base", default=DEFAULT_AUTH_API_BASE)
    parser.add_argument("--node-a-api-base", default=DEFAULT_NODE_A_API_BASE)
    parser.add_argument("--node-b-api-base", default=DEFAULT_NODE_B_API_BASE)
    parser.add_argument("--users-file", default="tmp/hub-chat-load-users.json")
    parser.add_argument("--sender-index", type=int, default=0)
    parser.add_argument("--recipient-index", type=int, default=1)
    parser.add_argument("--timeout-sec", type=float, default=15.0)
    parser.add_argument("--settle-sec", type=float, default=0.75, help="Duplicate observation window after first event.")
    parser.add_argument(
        "--client-ip",
        default="127.0.0.101",
        help="Trusted internal X-Forwarded-For/X-Real-IP used only by the load-test login.",
    )
    parser.add_argument("--report-json", default="tmp/chat-cross-node-realtime.json")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        report = asyncio.run(run_probe(args))
    except Exception as exc:
        report = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    report_path = Path(args.report_json)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"report={report_path}")
    return 0 if bool(report.get("ok")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
