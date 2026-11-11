"""Session load test: Hub HTTP + Chat HTTP/WebSocket for many concurrent online users."""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import random
import ssl
import statistics
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

try:
    import websockets
    from websockets.exceptions import ConnectionClosed, InvalidStatus
except Exception:  # pragma: no cover - import availability depends on runtime
    websockets = None  # type: ignore[assignment]
    ConnectionClosed = Exception  # type: ignore[misc, assignment]
    InvalidStatus = Exception  # type: ignore[misc, assignment]


DEFAULT_API_BASE = "http://127.0.0.1:8001/api/v1"
DEFAULT_AUTH_COOKIE = "itinvent_access_token"


@dataclass
class Credential:
    username: str
    password: str


@dataclass
class RunStats:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float = 0.0
    scenario_loops: int = 0
    request_count: int = 0
    error_count: int = 0
    ws_connects: int = 0
    ws_disconnects: int = 0
    ws_reconnects: int = 0
    # Steady-state gates (plan: unexpected_ws_denial / disconnect / send_errors).
    ws_connect_denied_total: dict[str, int] = field(default_factory=dict)
    ws_connect_recovered_total: dict[str, int] = field(default_factory=dict)
    unexpected_disconnect_total: dict[str, int] = field(default_factory=dict)
    send_error_total: dict[str, int] = field(default_factory=dict)
    read_throttle_total: dict[str, int] = field(default_factory=dict)
    reconnect_attempts: int = 0
    reconnect_successes: int = 0
    teardown_disconnects: int = 0
    # Harness cleanup failures are reported separately from request/server SLO.
    teardown_error_count: int = 0
    teardown_error_by_stage: dict[str, int] = field(default_factory=dict)
    teardown_error_samples: list[str] = field(default_factory=list)
    delivery_registered: int = 0
    delivery_observed: int = 0
    delivery_cancelled: int = 0
    delivery_missing: int = 0
    measurement_started_at: float = 0.0
    measurement_finished_at: float = 0.0
    phase: str = "warmup"  # warmup | measurement | cooldown | teardown
    rss_samples_mb: list[float] = field(default_factory=list)
    timings_ms: dict[str, list[float]] = field(
        default_factory=lambda: {
            "login": [],
            "hub_dashboard": [],
            "hub_tasks": [],
            "hub_task_projects": [],
            "hub_task_create": [],
            "hub_unread_counts": [],
            "hub_notifications_poll": [],
            "chat_conversations": [],
            "chat_thread_bootstrap": [],
            "chat_messages": [],
            "ws_connect": [],
            "ws_subscribe_inbox": [],
            "ws_subscribe_conversation": [],
            "ws_send_message": [],
            "ws_send_message_group": [],
            "ws_send_message_dm": [],
            "ws_delivery_event": [],
            "ws_delivery_event_group": [],
            "ws_delivery_event_dm": [],
            "ws_mark_read": [],
            "ws_ping": [],
            "http_send_message": [],
            "http_mark_read": [],
            "chat_file_upload": [],
            "chat_file_preview": [],
            "chat_file_preview_pdf": [],
            "ws_reconnect_recovery": [],
            "post_burst_ws_send_message": [],
        }
    )
    error_samples: list[str] = field(default_factory=list)
    error_by_stage: dict[str, int] = field(default_factory=dict)
    slow_samples: list[dict[str, Any]] = field(default_factory=list)
    slow_threshold_ms: float = 1000.0
    max_slow_samples: int = 80

    async def record_timing(
        self,
        name: str,
        elapsed_ms: float,
        *,
        worker_id: int | None = None,
        username: str = "",
        role: str = "",
        correlation_id: str = "",
        status_code: int | None = None,
        path: str = "",
        force: bool = False,
    ) -> None:
        async with self.lock:
            self.request_count += 1
            # SLO percentiles use measurement window only (warmup/cooldown excluded).
            if force or self.phase == "measurement" or not self.measurement_started_at:
                # Before measurement window starts, keep login/connect samples for diagnostics
                # but mark them separately when phase is warmup.
                bucket = name if (force or self.phase == "measurement") else f"{name}__{self.phase}"
                self.timings_ms.setdefault(bucket, []).append(float(elapsed_ms))
            if float(elapsed_ms) >= float(self.slow_threshold_ms) and len(self.slow_samples) < self.max_slow_samples:
                self.slow_samples.append(
                    {
                        "stage": name,
                        "elapsed_ms": round(float(elapsed_ms), 1),
                        "worker_id": worker_id,
                        "username": username,
                        "role": role,
                        "correlation_id": correlation_id,
                        "status_code": status_code,
                        "path": path,
                        "phase": self.phase,
                        "at_mono": round(time.monotonic() - self.started_at, 1),
                    }
                )

    async def record_error(self, stage: str, message: str) -> None:
        payload = f"{stage}: {message}"
        async with self.lock:
            self.request_count += 1
            self.error_count += 1
            self.error_by_stage[stage] = int(self.error_by_stage.get(stage, 0)) + 1
            if len(self.error_samples) < 40:
                self.error_samples.append(payload)

    async def record_teardown_error(self, stage: str, message: str, *, count: int = 1) -> None:
        """Record harness cleanup trouble without contaminating server request SLO."""
        normalized_count = max(1, int(count))
        payload = f"{stage}: {message}"
        async with self.lock:
            self.teardown_error_count += normalized_count
            self.teardown_error_by_stage[stage] = (
                int(self.teardown_error_by_stage.get(stage, 0)) + normalized_count
            )
            if len(self.teardown_error_samples) < 40:
                self.teardown_error_samples.append(payload)

    async def record_loop(self) -> None:
        async with self.lock:
            self.scenario_loops += 1

    async def record_ws(self, *, connects: int = 0, disconnects: int = 0, reconnects: int = 0) -> None:
        async with self.lock:
            self.ws_connects += int(connects)
            self.ws_disconnects += int(disconnects)
            self.ws_reconnects += int(reconnects)

    async def set_phase(self, phase: str) -> None:
        async with self.lock:
            self.phase = str(phase or "measurement")
            now = time.monotonic()
            if self.phase == "measurement" and not self.measurement_started_at:
                self.measurement_started_at = now
            if self.phase in {"cooldown", "teardown"} and self.measurement_started_at and not self.measurement_finished_at:
                self.measurement_finished_at = now

    async def record_ws_denied(self, *, status: int, reason: str) -> None:
        key = f"{int(status)}:{str(reason or 'unknown')}"
        async with self.lock:
            self.ws_connect_denied_total[key] = int(self.ws_connect_denied_total.get(key, 0)) + 1

    async def record_ws_recovered(self, *, reason: str) -> None:
        key = str(reason or "unknown")
        async with self.lock:
            self.ws_connect_recovered_total[key] = int(self.ws_connect_recovered_total.get(key, 0)) + 1

    async def record_unexpected_disconnect(self, *, phase: str, kind: str = "transport") -> None:
        key = f"{str(phase or self.phase)}:{str(kind or 'transport')}"
        async with self.lock:
            if str(phase or self.phase) == "teardown":
                self.teardown_disconnects += 1
                return
            self.unexpected_disconnect_total[key] = int(self.unexpected_disconnect_total.get(key, 0)) + 1

    async def record_send_error(self, *, reason: str) -> None:
        key = str(reason or "unknown")[:80]
        async with self.lock:
            self.send_error_total[key] = int(self.send_error_total.get(key, 0)) + 1

    async def record_read_throttle(self, *, status: int, stage: str = "chat_read") -> None:
        key = f"{int(status)}:{str(stage or 'chat_read')[:60]}"
        async with self.lock:
            self.read_throttle_total[key] = int(self.read_throttle_total.get(key, 0)) + 1

    async def record_reconnect_attempt(self, *, success: bool, recovery_ms: float | None = None) -> None:
        async with self.lock:
            self.reconnect_attempts += 1
            if success:
                self.reconnect_successes += 1
                if recovery_ms is not None and (
                    self.phase == "measurement" or not self.measurement_started_at
                ):
                    self.timings_ms.setdefault("ws_reconnect_recovery", []).append(float(recovery_ms))

    def unexpected_ws_denial_count(self) -> int:
        """403 always unexpected; 401/429/503 unexpected only if not recovered."""
        recovered = sum(int(v) for v in self.ws_connect_recovered_total.values())
        auth_overload = sum(
            int(c)
            for k, c in self.ws_connect_denied_total.items()
            if int(str(k).split(":", 1)[0] or "0") in {401, 429, 503}
        )
        forbidden = sum(
            int(c)
            for k, c in self.ws_connect_denied_total.items()
            if int(str(k).split(":", 1)[0] or "0") == 403
        )
        return int(forbidden + max(0, auth_overload - recovered))

    async def record_rss(self, rss_mb: float) -> None:
        async with self.lock:
            self.rss_samples_mb.append(float(rss_mb))

    async def record_delivery_registered(self) -> None:
        async with self.lock:
            self.delivery_registered += 1

    async def record_delivery_cancelled(self) -> None:
        async with self.lock:
            self.delivery_cancelled += 1

    async def record_delivery_observed(self, *, kind: str, elapsed_ms: float) -> None:
        async with self.lock:
            self.delivery_observed += 1
            self.timings_ms.setdefault("ws_delivery_event", []).append(float(elapsed_ms))
            self.timings_ms.setdefault(f"ws_delivery_event_{kind}", []).append(float(elapsed_ms))

    async def record_delivery_missing(self, count: int) -> None:
        async with self.lock:
            self.delivery_missing += max(0, int(count))


def _ws_reject_status(exc: BaseException) -> int | None:
    """Extract HTTP status from websockets InvalidStatus / similar."""
    response = getattr(exc, "response", None)
    if response is not None:
        status = getattr(response, "status_code", None)
        if status is None:
            status = getattr(response, "status", None)
        try:
            return int(status) if status is not None else None
        except Exception:
            return None
    # Some versions expose status on the exception itself.
    for attr in ("status_code", "status"):
        raw = getattr(exc, attr, None)
        try:
            if raw is not None:
                return int(raw)
        except Exception:
            continue
    text = str(exc)
    if "403" in text:
        return 403
    if "401" in text:
        return 401
    if "429" in text:
        return 429
    if "503" in text:
        return 503
    return None


def _ws_deny_reason_for_status(status: int) -> str:
    if status == 401:
        return "auth_session"
    if status == 403:
        return "access_denied"
    if status == 429:
        return "rate_limited"
    if status == 503:
        return "overloaded"
    if status == 400:
        return "malformed_request"
    return "unknown"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Hub+Chat session load test (HTTP + long-lived WebSocket) for ~50+ concurrent users."
    )
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="API base URL, e.g. http://127.0.0.1:8001/api/v1")
    parser.add_argument("--users-file", help="JSON file with a list of {username,password} objects")
    parser.add_argument("--username", help="Single username to reuse when users-file is not provided")
    parser.add_argument("--password", help="Single password to reuse when users-file is not provided")
    parser.add_argument("--virtual-users", type=int, default=50, help="Number of virtual users to run")
    parser.add_argument("--duration-sec", type=int, default=15 * 60, help="Test duration in seconds")
    parser.add_argument("--think-time-sec", type=float, default=2.5, help="Pause between scenario loops")
    parser.add_argument("--stagger-ms", type=int, default=120, help="Delay between virtual-user starts")
    parser.add_argument("--request-timeout-sec", type=float, default=25.0, help="Per-request timeout")
    parser.add_argument("--ws-ping-sec", type=float, default=25.0, help="WebSocket ping interval while holding session")
    parser.add_argument(
        "--delivery-timeout-sec",
        type=float,
        default=3.0,
        help="Grace period for recipient delivery events before they are counted missing",
    )
    parser.add_argument(
        "--ws-close-timeout-sec",
        type=float,
        default=3.0,
        help="Maximum time allowed for each websocket teardown step",
    )
    parser.add_argument(
        "--worker-teardown-timeout-sec",
        type=float,
        default=0.0,
        help=(
            "Maximum graceful worker teardown after the nominal stop time. "
            "0 uses request timeout + delivery grace + websocket close timeout."
        ),
    )
    parser.add_argument(
        "--conversation-id",
        default="",
        help="Optional shared group conversation id (otherwise first conversation from list is used)",
    )
    parser.add_argument(
        "--conversation-ids",
        default="",
        help=(
            "Comma-separated group conversation ids for distributed writes. "
            "VU i uses conversation_ids[i %% len]. Overrides single --conversation-id."
        ),
    )
    parser.add_argument(
        "--meta-file",
        default="",
        help="Optional hub-chat-load-meta.json (reads conversation_id + dm_by_username + group_conversation_ids)",
    )
    parser.add_argument(
        "--chat-api-base",
        default="",
        help=(
            "Optional separate Chat API base (e.g. http://127.0.0.1:8002/api/v1). "
            "When set, /chat/* HTTP + WS go here; auth/hub stay on --api-base."
        ),
    )
    parser.add_argument(
        "--enable-writes",
        action="store_true",
        help="Allow chat send/mark_read writes (default: read-mostly + WS hold/ping)",
    )
    parser.add_argument(
        "--mark-read-incoming",
        action="store_true",
        help=(
            "Mark the latest actually delivered incoming message as read over WebSocket. "
            "Targets are coalesced per currently subscribed conversation."
        ),
    )
    parser.add_argument(
        "--writes-during-warmup",
        action="store_true",
        help="Also generate messages during warmup (default: connect/read warmup only)",
    )
    parser.add_argument(
        "--write-targets",
        default="both",
        choices=["group", "dm", "both"],
        help="Where to send messages when --enable-writes is set",
    )
    parser.add_argument(
        "--light-hub",
        action="store_true",
        help=(
            "Skip heavy hub polls (dashboard/tasks/unread) so mail/chat stay usable while observing. "
            "Still keeps chat HTTP/WS + optional writes."
        ),
    )
    parser.add_argument(
        "--skip-hub",
        action="store_true",
        help="Diagnostic: never call HUB HTTP endpoints (stronger than --light-hub).",
    )
    parser.add_argument(
        "--skip-conversations",
        action="store_true",
        help="Diagnostic: skip GET /chat/conversations",
    )
    parser.add_argument(
        "--skip-bootstrap",
        action="store_true",
        help="Diagnostic: skip GET thread-bootstrap",
    )
    parser.add_argument(
        "--skip-messages",
        action="store_true",
        help="Diagnostic: skip GET /messages (history)",
    )
    parser.add_argument(
        "--chat-read-api-base",
        default="",
        help="Optional separate Chat Read API base for conversations/bootstrap/messages (process-split diag).",
    )
    parser.add_argument(
        "--scenario-profile",
        default="",
        choices=["", "steady", "stampede", "reconnect", "hot_conversation"],
        help="Deterministic load profile (E_STEADY / E_STAMPEDE / E_RECONNECT / E_HOT_CONVERSATION).",
    )
    parser.add_argument(
        "--slo-profile",
        default="standard",
        choices=["standard", "capacity_150"],
        help=(
            "SLO envelope for report gates. capacity_150 requires chat delivery p95 <= 1s "
            "and keeps mail strictly in HUB-cache-only mode."
        ),
    )
    parser.add_argument(
        "--steady-state-gates",
        action="store_true",
        help="Fail SLO when unexpected_ws_denial / unexpected_disconnect / send_errors > 0.",
    )
    parser.add_argument(
        "--warmup-sec",
        type=float,
        default=0.0,
        help="Warmup window seconds (excluded from measurement timings when >0).",
    )
    parser.add_argument(
        "--cooldown-sec",
        type=float,
        default=0.0,
        help="Cooldownoldown window at end (excluded from measurement).",
    )
    parser.add_argument(
        "--once-reads",
        action="store_true",
        help="React-like: list/bootstrap once per session; no per-loop list/history stampede.",
    )
    parser.add_argument(
        "--force-reconnect-every-sec",
        type=float,
        default=0.0,
        help="E_RECONNECT: close+reconnect cadence (0=disabled).",
    )
    parser.add_argument(
        "--hot-conversation-id",
        default="",
        help="E_HOT_CONVERSATION: force all writers onto one conversation id.",
    )
    parser.add_argument("--auth-cookie-name", default=DEFAULT_AUTH_COOKIE, help="Access-token cookie name")
    parser.add_argument(
        "--task-create-every-loops",
        type=int,
        default=0,
        help="Create one test task from each busy-hub VU every N loops (0=disabled)",
    )
    parser.add_argument(
        "--file-flow-every-loops",
        type=int,
        default=0,
        help="Upload and preview a DOCX every N loops for selected VUs (0=disabled)",
    )
    parser.add_argument(
        "--file-flow-users",
        type=int,
        default=0,
        help="Number of first VUs participating in upload/preview flow",
    )
    parser.add_argument(
        "--client-ip",
        default="10.10.20.50",
        help=(
            "Base X-Forwarded-For IP for internal zone (password-only when 2FA policy is external_only). "
            "Each VU uses base+worker_id in the last octet to avoid shared IP lockouts."
        ),
    )
    parser.add_argument("--report-json", default="", help="Optional path to save JSON report")
    parser.add_argument(
        "--diagnosis-md",
        default="",
        help="Optional markdown diagnosis path (default: <report-json>.diagnosis.md)",
    )
    parser.add_argument("--progress-sec", type=int, default=30, help="Progress print interval")
    parser.add_argument("--rss-pid", type=int, default=0, help="Optional backend PID for RSS sampling")
    parser.add_argument(
        "--auto-rss",
        action="store_true",
        help="Auto-detect backend PID listening on API port for RSS sampling",
    )
    parser.add_argument("--rss-sample-sec", type=float, default=5.0, help="RSS sample interval when rss-pid is set")
    parser.add_argument(
        "--slow-sample-ms",
        type=float,
        default=1000.0,
        help="Capture client slow samples at/above this threshold (ms)",
    )
    parser.add_argument(
        "--capture-server-metrics",
        action="store_true",
        default=True,
        help="Reset+snapshot /system/request-metrics/local around the run (default: on)",
    )
    parser.add_argument(
        "--no-capture-server-metrics",
        action="store_false",
        dest="capture_server_metrics",
        help="Disable server request-metrics capture",
    )
    parser.add_argument("--insecure", action="store_true", help="Disable TLS verification for self-signed staging certs")
    return parser.parse_args()


def _parse_conversation_ids(raw: str) -> list[str]:
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]


def apply_meta_file(args: argparse.Namespace) -> None:
    """Fill conversation_id / dm map from seed meta when provided."""
    meta_path = str(getattr(args, "meta_file", "") or "").strip()
    if not hasattr(args, "conversation_ids_list"):
        args.conversation_ids_list = _parse_conversation_ids(getattr(args, "conversation_ids", "") or "")
    if not meta_path:
        if not hasattr(args, "dm_by_username"):
            args.dm_by_username = {}
        if not hasattr(args, "dm_peer_by_username"):
            args.dm_peer_by_username = {}
        if not hasattr(args, "group_by_username"):
            args.group_by_username = {}
        if not hasattr(args, "user_id_by_username"):
            args.user_id_by_username = {}
        return
    path = Path(meta_path).expanduser()
    if not path.exists():
        raise SystemExit(f"meta-file not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("meta-file must be a JSON object")
    if not str(getattr(args, "conversation_id", "") or "").strip():
        args.conversation_id = str(payload.get("conversation_id") or "").strip()
    if not args.conversation_ids_list:
        group_ids = payload.get("group_conversation_ids") or payload.get("conversation_ids") or []
        if isinstance(group_ids, list):
            args.conversation_ids_list = [str(item).strip() for item in group_ids if str(item).strip()]
        elif isinstance(group_ids, str):
            args.conversation_ids_list = _parse_conversation_ids(group_ids)
    group_by_user = payload.get("group_by_username") or {}
    if not isinstance(group_by_user, dict):
        group_by_user = {}
    args.group_by_username = {
        str(username).strip(): str(conversation_id).strip()
        for username, conversation_id in group_by_user.items()
        if str(username).strip() and str(conversation_id).strip()
    }
    dm_map = payload.get("dm_by_username") or {}
    if not isinstance(dm_map, dict):
        dm_map = {}
    args.dm_by_username = {
        str(username).strip(): str(conversation_id).strip()
        for username, conversation_id in dm_map.items()
        if str(username).strip() and str(conversation_id).strip()
    }
    args.dm_peer_by_username = {}
    args.user_id_by_username = {
        str(item.get("username") or "").strip(): int(item.get("id") or 0)
        for item in payload.get("users") or []
        if isinstance(item, dict) and str(item.get("username") or "").strip() and int(item.get("id") or 0) > 0
    }
    for pair in payload.get("dm_pairs") or []:
        if not isinstance(pair, dict):
            continue
        left = str(pair.get("user_a") or "").strip()
        right = str(pair.get("user_b") or "").strip()
        if left and right:
            args.dm_peer_by_username[left] = right
            args.dm_peer_by_username[right] = left


def load_credentials(args: argparse.Namespace) -> list[Credential]:
    entries: list[Credential] = []
    if args.users_file:
        payload = json.loads(Path(args.users_file).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise SystemExit("users-file must contain a JSON list")
        for item in payload:
            username = str((item or {}).get("username") or "").strip()
            password = str((item or {}).get("password") or "")
            if not username or not password:
                raise SystemExit("Each users-file entry must include non-empty username and password")
            entries.append(Credential(username=username, password=password))
    else:
        username = str(args.username or "").strip()
        password = str(args.password or "")
        if not username or not password:
            raise SystemExit("Provide either --users-file or both --username and --password")
        entries = [Credential(username=username, password=password)]

    if not entries:
        raise SystemExit("No credentials provided for load test")
    return entries


def resolve_role(worker_id: int) -> str:
    """Distribute roles: ~10% busy_hub, ~30% active_chat, ~60% idle."""
    mod = int(worker_id) % 10
    if mod == 0:
        return "busy_hub"
    if mod <= 3:
        return "active_chat"
    return "idle"


def build_ssl_context(insecure: bool) -> ssl.SSLContext | bool | None:
    if not insecure:
        return None
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def client_ip_for_worker(base_ip: str, worker_id: int) -> str:
    """Derive a unique internal IP per VU from a /24-ish base address."""
    text = str(base_ip or "").strip()
    if not text:
        return ""
    parts = text.split(".")
    if len(parts) != 4:
        return text
    try:
        a, b, c, d = (int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3]))
    except ValueError:
        return text
    total = max(1, min(254, d)) + max(0, int(worker_id))
    third = c + ((total - 1) // 254)
    fourth = ((total - 1) % 254) + 1
    if third > 255:
        third = third % 256
    return f"{a}.{b}.{third}.{fourth}"


def api_to_ws_url(api_base: str) -> str:
    parsed = urlparse(str(api_base or DEFAULT_API_BASE).rstrip("/") + "/")
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = parsed.path.rstrip("/")
    if not path.endswith("/api/v1"):
        # Keep caller path as-is; append /chat/ws under current API base.
        pass
    return f"{scheme}://{parsed.netloc}{path}/chat/ws"


def percentile_ms(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = max(0.0, min(1.0, float(percentile) / 100.0)) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def mean_ms(values: list[float]) -> float | None:
    if not values:
        return None
    return statistics.fmean(values)


def human_ms(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.1f} ms"


def detect_listening_pid(port: int) -> int | None:
    """Best-effort PID of a process listening on TCP port (for RSS sampling)."""
    try:
        import psutil  # type: ignore
    except Exception:
        return None
    try:
        for conn in psutil.net_connections(kind="inet"):
            laddr = getattr(conn, "laddr", None)
            if not laddr:
                continue
            if int(getattr(laddr, "port", 0) or 0) != int(port):
                continue
            status = str(getattr(conn, "status", "") or "").upper()
            if status and status != "LISTEN":
                continue
            pid = getattr(conn, "pid", None)
            if pid:
                return int(pid)
    except Exception:
        return None
    return None


def api_port_from_base(api_base: str, default: int = 8001) -> int:
    parsed = urlparse(str(api_base or DEFAULT_API_BASE))
    if parsed.port:
        return int(parsed.port)
    if parsed.scheme == "https":
        return 443
    return int(default)


def system_metrics_url(api_base: str, *, reset: bool = False) -> str:
    base = str(api_base or DEFAULT_API_BASE).rstrip("/")
    if reset:
        return f"{base}/system/request-metrics/local/reset"
    return f"{base}/system/request-metrics/local"


async def fetch_json_url(
    url: str,
    *,
    method: str = "GET",
    timeout_sec: float = 20.0,
    verify: ssl.SSLContext | bool = True,
    headers: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    try:
        async with httpx.AsyncClient(verify=verify, timeout=timeout_sec) as client:
            response = await client.request(method.upper(), url, headers=headers or {})
            if response.status_code >= 400:
                return {
                    "ok": False,
                    "status_code": int(response.status_code),
                    "error": response.text[:300],
                    "url": url,
                }
            if not response.content:
                return {"ok": True, "url": url}
            payload = response.json()
            if isinstance(payload, dict):
                payload.setdefault("ok", True)
                return payload
            return {"ok": True, "data": payload, "url": url}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "url": url}


async def timed_http_request(
    client: httpx.AsyncClient,
    stats: RunStats,
    *,
    stage: str,
    method: str,
    path: str,
    worker_id: int,
    username: str,
    role: str,
    timeout_sec: float,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
) -> tuple[httpx.Response, float, str]:
    correlation_id = f"lt-{uuid.uuid4().hex[:16]}"
    headers = {
        "X-Correlation-ID": correlation_id,
        "X-Request-ID": correlation_id,
    }
    started = time.perf_counter()
    response = await client.request(
        method.upper(),
        path,
        params=params,
        json=json_body,
        timeout=timeout_sec,
        headers=headers,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    server_cid = str(response.headers.get("X-Correlation-ID") or correlation_id)
    await stats.record_timing(
        stage,
        elapsed_ms,
        worker_id=worker_id,
        username=username,
        role=role,
        correlation_id=server_cid,
        status_code=int(response.status_code),
        path=path,
    )
    if response.status_code >= 400:
        raise httpx.HTTPStatusError(
            f"HTTP {response.status_code}: {response.text[:240]} cid={server_cid}",
            request=response.request,
            response=response,
        )
    return response, elapsed_ms, server_cid


def build_loadtest_docx(text: str) -> bytes:
    """Build a tiny valid DOCX so the test exercises the real Office preview pipeline."""
    safe_text = (
        str(text or "load test")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/>'
            "</Relationships>",
        )
        archive.writestr(
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body><w:p><w:r><w:t>{safe_text}</w:t></w:r></w:p><w:sectPr/></w:body>"
            "</w:document>",
        )
    return stream.getvalue()


async def run_chat_file_preview_flow(
    client: httpx.AsyncClient,
    stats: RunStats,
    *,
    conversation_id: str,
    worker_id: int,
    username: str,
    role: str,
    timeout_sec: float,
    loop_index: int,
) -> None:
    filename = f"LoadTest-{worker_id}-{loop_index}-{uuid.uuid4().hex[:6]}.docx"
    content = build_loadtest_docx(f"HUB-IT load test worker {worker_id}, loop {loop_index}")
    started = time.perf_counter()
    response = await client.post(
        f"/chat/conversations/{conversation_id}/messages/files",
        data={"body": f"LoadTest file preview w={worker_id} loop={loop_index}"},
        files={
            "files": (
                filename,
                content,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        timeout=timeout_sec,
    )
    upload_ms = (time.perf_counter() - started) * 1000.0
    await stats.record_timing(
        "chat_file_upload",
        upload_ms,
        worker_id=worker_id,
        username=username,
        role=role,
        status_code=int(response.status_code),
        path="/chat/conversations/{id}/messages/files",
    )
    response.raise_for_status()
    message = response.json()
    message_id = str((message or {}).get("id") or "").strip()
    attachments = list((message or {}).get("attachments") or [])
    attachment_id = str((attachments[0] if attachments else {}).get("id") or "").strip()
    if not message_id or not attachment_id:
        raise RuntimeError("file upload response has no message/attachment id")

    preview_path = f"/chat/messages/{message_id}/attachments/{attachment_id}/preview"
    preview_started = time.perf_counter()
    preview_deadline = time.monotonic() + max(1.0, float(timeout_sec))
    preview_response: httpx.Response | None = None
    preview_payload: dict[str, Any] = {}
    while True:
        remaining_sec = preview_deadline - time.monotonic()
        if remaining_sec <= 0:
            raise TimeoutError("Office preview was not ready before timeout")
        preview_response = await client.get(
            preview_path,
            timeout=min(float(timeout_sec), max(1.0, remaining_sec)),
        )
        if preview_response.status_code >= 400:
            preview_response.raise_for_status()
        payload = preview_response.json()
        preview_payload = payload if isinstance(payload, dict) else {}
        preview_status = str(preview_payload.get("status") or "").strip().lower()
        if preview_response.status_code == 200 and preview_status == "ready":
            break
        if preview_response.status_code != 202 or preview_status not in {"queued", "processing"}:
            raise RuntimeError(
                f"Unexpected Office preview state: HTTP {preview_response.status_code}, "
                f"status={preview_status or 'missing'}"
            )
        retry_after_ms = max(100, int(preview_payload.get("retry_after_ms") or 500))
        await asyncio.sleep(min(2.0, retry_after_ms / 1000.0, max(0.0, remaining_sec)))

    await stats.record_timing(
        "chat_file_preview",
        (time.perf_counter() - preview_started) * 1000.0,
        worker_id=worker_id,
        username=username,
        role=role,
        status_code=int(preview_response.status_code),
        path=preview_path,
    )
    if str(preview_payload.get("preview_kind") or "") != "office_pdf":
        raise RuntimeError("Office preview metadata was not generated")

    await timed_http_request(
        client,
        stats,
        stage="chat_file_preview_pdf",
        method="GET",
        path=f"{preview_path}/pdf",
        worker_id=worker_id,
        username=username,
        role=role,
        timeout_sec=timeout_sec,
    )


def rank_client_bottlenecks(timing_summary: dict[str, dict[str, Any]], *, top_n: int = 8) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for name, entry in timing_summary.items():
        count = int(entry.get("count") or 0)
        if count <= 0:
            continue
        p95 = entry.get("p95_ms")
        mean = entry.get("mean_ms")
        if p95 is None:
            continue
        ranked.append(
            {
                "stage": name,
                "count": count,
                "mean_ms": None if mean is None else round(float(mean), 1),
                "p95_ms": round(float(p95), 1),
                "max_ms": None if entry.get("max_ms") is None else round(float(entry["max_ms"]), 1),
                "score": round(float(p95) * max(1.0, count / 100.0), 1),
            }
        )
    ranked.sort(key=lambda item: (float(item["p95_ms"]), float(item["score"])), reverse=True)
    return ranked[:top_n]


def build_diagnosis(
    report: dict[str, Any],
    *,
    server_metrics: dict[str, Any] | None = None,
    chat_health: dict[str, Any] | None = None,
) -> dict[str, Any]:
    timings = report.get("timings") or {}
    bottlenecks = rank_client_bottlenecks(timings)
    failed_slos = [name for name, ok in (report.get("slos") or {}).items() if not ok]
    top_errors = sorted(
        ((stage, count) for stage, count in (report.get("error_by_stage") or {}).items()),
        key=lambda item: item[1],
        reverse=True,
    )
    server_hotspots = []
    pools = {}
    if isinstance(server_metrics, dict) and server_metrics.get("ok") is not False:
        server_hotspots = list(server_metrics.get("hotspots") or [])[:10]
        pools = dict(server_metrics.get("pools") or {})
    likely_causes: list[str] = []
    for item in bottlenecks[:3]:
        stage = str(item["stage"])
        p95 = float(item["p95_ms"])
        if stage.startswith("hub_") and p95 >= 1500:
            likely_causes.append(
                f"{stage}: client p95={p95:.0f}ms — смотри APP DB pool / hub SQL / dashboard cache"
            )
        elif stage.startswith("chat_") and p95 >= 1000:
            likely_causes.append(
                f"{stage}: client p95={p95:.0f}ms — смотри CHAT DB pool / Redis read-cache / route_metrics"
            )
        elif stage.startswith("ws_") and p95 >= 1000:
            likely_causes.append(
                f"{stage}: client p95={p95:.0f}ms — смотри WS fan-out / realtime_mode / reconnect storm"
            )
        elif stage == "login" and p95 >= 2000:
            likely_causes.append(f"login: p95={p95:.0f}ms — auth/session storm на старте VU")
    for hotspot in server_hotspots[:3]:
        likely_causes.append(
            "server hotspot "
            f"{hotspot.get('method')} {hotspot.get('path')}: "
            f"reason={hotspot.get('reason')} p95={hotspot.get('p95_ms')} "
            f"errors={hotspot.get('server_error_rate')}"
        )
    if not likely_causes and not failed_slos:
        likely_causes.append("Явных FAIL/SLO нет — смотри top client stages и server hotspots для запаса.")

    where_to_look = [
        "JSON отчёт прогона (--report-json)",
        "Markdown диагностика (--diagnosis-md / рядом с report)",
        "GET http://127.0.0.1:8001/api/v1/system/request-metrics/local (loopback)",
        "powershell -ExecutionPolicy Bypass -File scripts\\chat\\chat_perf_snapshot.ps1",
        "PM2 backend error log: Select-String -Path $env:USERPROFILE\\.pm2\\logs\\itinvent-backend-error.log -Pattern 'http.slow|chat\\.'",
        "Correlation-ID из slow_samples → тот же id в http.slow логах backend",
    ]
    return {
        "failed_slos": failed_slos,
        "client_bottlenecks": bottlenecks,
        "error_by_stage": [{"stage": stage, "count": count} for stage, count in top_errors],
        "slow_samples": list(report.get("slow_samples") or [])[:40],
        "server_hotspots": server_hotspots,
        "pools": pools,
        "chat_health_summary": {
            "realtime_mode": (chat_health or {}).get("realtime_mode"),
            "local_connection_count": (chat_health or {}).get("local_connection_count"),
            "read_cache": (chat_health or {}).get("read_cache_metrics"),
            "route_metrics_top": _top_chat_route_metrics(chat_health),
            "ok": None if chat_health is None else bool(chat_health.get("ok", True)),
            "error": None if chat_health is None else chat_health.get("error"),
        },
        "likely_causes": likely_causes,
        "where_to_look": where_to_look,
    }


def _top_chat_route_metrics(chat_health: dict[str, Any] | None, *, top_n: int = 6) -> list[dict[str, Any]]:
    if not isinstance(chat_health, dict):
        return []
    metrics = chat_health.get("route_metrics") or {}
    if not isinstance(metrics, dict):
        return []
    rows: list[dict[str, Any]] = []
    for route, value in metrics.items():
        if not isinstance(value, dict):
            continue
        rows.append(
            {
                "route": route,
                "count": int(value.get("count") or 0),
                "avg_ms": value.get("avg_ms"),
                "p95_ms": value.get("p95_ms"),
                "cache_hit_rate_pct": value.get("cache_hit_rate_pct"),
            }
        )
    rows.sort(key=lambda item: float(item.get("p95_ms") or 0), reverse=True)
    return rows[:top_n]


def render_diagnosis_markdown(report: dict[str, Any], diagnosis: dict[str, Any]) -> str:
    lines = [
        "# Hub+Chat loadtest diagnosis",
        "",
        f"- virtual_users: `{report.get('virtual_users')}`",
        f"- duration_sec: `{report.get('duration_sec')}`",
        f"- enable_writes: `{report.get('enable_writes')}`",
        f"- error_rate: `{float(report.get('error_rate') or 0) * 100:.2f}%`",
        f"- request_count: `{report.get('request_count')}`",
        f"- scenario_loops: `{report.get('scenario_loops')}`",
        "",
        "## Failed SLOs",
    ]
    failed = diagnosis.get("failed_slos") or []
    if failed:
        for name in failed:
            lines.append(f"- `{name}`")
    else:
        lines.append("- none")
    lines.extend(["", "## Client bottlenecks (by p95)", ""])
    lines.append("| stage | count | mean_ms | p95_ms | max_ms |")
    lines.append("|---|---:|---:|---:|---:|")
    for item in diagnosis.get("client_bottlenecks") or []:
        lines.append(
            f"| `{item.get('stage')}` | {item.get('count')} | {item.get('mean_ms')} | "
            f"{item.get('p95_ms')} | {item.get('max_ms')} |"
        )
    lines.extend(["", "## Errors by stage", ""])
    errors = diagnosis.get("error_by_stage") or []
    if errors:
        for item in errors:
            lines.append(f"- `{item.get('stage')}`: {item.get('count')}")
    else:
        lines.append("- none")
    lines.extend(["", "## Likely causes", ""])
    for item in diagnosis.get("likely_causes") or []:
        lines.append(f"- {item}")
    lines.extend(["", "## Server hotspots", ""])
    hotspots = diagnosis.get("server_hotspots") or []
    if hotspots:
        for item in hotspots:
            lines.append(
                f"- `{item.get('severity')}` {item.get('method')} `{item.get('path')}` "
                f"reason={item.get('reason')} p95={item.get('p95_ms')} "
                f"share={item.get('traffic_share')} err={item.get('server_error_rate')}"
            )
    else:
        lines.append("- not captured / empty")
    pools = diagnosis.get("pools") or {}
    lines.extend(["", "## DB pools", ""])
    if pools:
        lines.append("```json")
        lines.append(json.dumps(pools, ensure_ascii=False, indent=2))
        lines.append("```")
    else:
        lines.append("- n/a")
    chat_summary = diagnosis.get("chat_health_summary") or {}
    lines.extend(
        [
            "",
            "## Chat health",
            "",
            f"- realtime_mode: `{chat_summary.get('realtime_mode')}`",
            f"- local_connection_count: `{chat_summary.get('local_connection_count')}`",
            f"- read_cache: `{chat_summary.get('read_cache')}`",
            "",
        ]
    )
    route_rows = chat_summary.get("route_metrics_top") or []
    if route_rows:
        lines.append("| route | count | avg_ms | p95_ms | cache_hit_% |")
        lines.append("|---|---:|---:|---:|---:|")
        for row in route_rows:
            lines.append(
                f"| `{row.get('route')}` | {row.get('count')} | {row.get('avg_ms')} | "
                f"{row.get('p95_ms')} | {row.get('cache_hit_rate_pct')} |"
            )
    lines.extend(["", "## Slow samples (client)", ""])
    samples = diagnosis.get("slow_samples") or []
    if samples:
        for sample in samples[:25]:
            lines.append(
                f"- t+{sample.get('at_mono')}s `{sample.get('stage')}` "
                f"{sample.get('elapsed_ms')}ms user={sample.get('username')} "
                f"role={sample.get('role')} cid=`{sample.get('correlation_id')}` "
                f"path={sample.get('path')}"
            )
    else:
        lines.append("- none above threshold")
    lines.extend(["", "## Where to look next", ""])
    for item in diagnosis.get("where_to_look") or []:
        lines.append(f"- {item}")
    lines.append("")
    return "\n".join(lines)


def first_conversation_id(payload: dict[str, Any] | None) -> str:
    items = (payload or {}).get("items")
    if not isinstance(items, list):
        return ""
    for item in items:
        conversation_id = str((item or {}).get("id") or "").strip()
        if conversation_id:
            return conversation_id
    return ""


def first_message_id(payload: dict[str, Any] | None) -> str:
    for key in ("messages", "items"):
        block = (payload or {}).get(key)
        items = block.get("items") if isinstance(block, dict) else block
        if not isinstance(items, list):
            continue
        for item in items:
            message_id = str((item or {}).get("id") or "").strip()
            if message_id:
                return message_id
    return ""


def cookie_header_from_client(client: httpx.AsyncClient, cookie_name: str) -> str:
    parts: list[str] = []
    for cookie in client.cookies.jar:
        name = str(getattr(cookie, "name", "") or "")
        value = str(getattr(cookie, "value", "") or "")
        if name and value:
            parts.append(f"{name}={value}")
    if parts:
        return "; ".join(parts)
    # Fallback if jar iteration differs by httpx version.
    token = str(client.cookies.get(cookie_name) or "").strip()
    if token:
        return f"{cookie_name}={token}"
    return ""


async def request_json(
    client: httpx.AsyncClient,
    *,
    method: str,
    url: str,
    timeout_sec: float,
    payload: dict[str, Any] | None = None,
) -> tuple[Any, float]:
    started = time.perf_counter()
    response = await client.request(method.upper(), url, json=payload, timeout=timeout_sec)
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    if response.status_code >= 400:
        body = response.text[:240]
        raise httpx.HTTPStatusError(
            f"HTTP {response.status_code}: {body}",
            request=response.request,
            response=response,
        )
    if not response.content:
        return None, elapsed_ms
    return response.json(), elapsed_ms


@dataclass
class PendingDelivery:
    started_at: float
    kind: str
    sender_username: str
    expected_receiver: str


class IncomingReadTracker:
    """Coalesce incoming message events to one latest read target per conversation."""

    def __init__(self, *, max_conversations: int = 256) -> None:
        self._max_conversations = max(1, int(max_conversations))
        self._arrival_seq = 0
        self._latest: dict[str, tuple[int, str]] = {}
        self._completed: dict[str, str] = {}

    def observe(self, message: dict[str, Any]) -> bool:
        if str(message.get("type") or "") != "chat.message.created":
            return False
        payload = message.get("payload")
        if not isinstance(payload, dict) or bool(payload.get("is_own")):
            return False
        conversation_id = str(payload.get("conversation_id") or "").strip()
        message_id = str(payload.get("id") or "").strip()
        if not conversation_id or not message_id:
            return False

        self._arrival_seq += 1
        try:
            event_seq = int(payload.get("conversation_seq") or 0)
        except (TypeError, ValueError):
            event_seq = 0
        current = self._latest.get(conversation_id)
        # WS events are ordered. If an older server omits conversation_seq, advance
        # from the current target instead of comparing a small local counter to a DB seq.
        order = event_seq if event_seq > 0 else ((current[0] + 1) if current is not None else self._arrival_seq)
        if current is not None and (order < current[0] or (order == current[0] and message_id == current[1])):
            return False

        # Refresh insertion order so the bounded map evicts the least-recent conversation.
        self._latest.pop(conversation_id, None)
        self._latest[conversation_id] = (order, message_id)
        while len(self._latest) > self._max_conversations:
            evicted_conversation_id = next(iter(self._latest))
            self._latest.pop(evicted_conversation_id, None)
            self._completed.pop(evicted_conversation_id, None)
        return True

    def pending(self, *, allowed_conversation_ids: set[str] | None = None) -> list[tuple[str, str]]:
        allowed = (
            {str(item).strip() for item in allowed_conversation_ids if str(item).strip()}
            if allowed_conversation_ids is not None
            else None
        )
        return [
            (conversation_id, message_id)
            for conversation_id, (_order, message_id) in self._latest.items()
            if (allowed is None or conversation_id in allowed)
            and self._completed.get(conversation_id) != message_id
        ]

    def complete(self, conversation_id: str, message_id: str) -> None:
        normalized_conversation_id = str(conversation_id or "").strip()
        normalized_message_id = str(message_id or "").strip()
        current = self._latest.get(normalized_conversation_id)
        if current is not None and current[1] == normalized_message_id:
            self._completed[normalized_conversation_id] = normalized_message_id


class DeliveryTracker:
    """Correlate sender commands with recipient realtime events."""

    def __init__(self, stats: RunStats) -> None:
        self.stats = stats
        self._pending: dict[str, PendingDelivery] = {}
        self._lock = asyncio.Lock()
        self._finalized = False

    @property
    def registered(self) -> int:
        return int(self.stats.delivery_registered)

    @property
    def observed(self) -> int:
        return int(self.stats.delivery_observed)

    @property
    def pending_count(self) -> int:
        return len(self._pending)

    async def register(
        self,
        client_message_id: str,
        *,
        kind: str,
        sender_username: str,
        expected_receiver: str = "",
    ) -> bool:
        normalized_id = str(client_message_id or "").strip()
        if not normalized_id or self.stats.phase != "measurement":
            return False
        pending = PendingDelivery(
            started_at=time.perf_counter(),
            kind=str(kind or "unknown").strip().lower() or "unknown",
            sender_username=str(sender_username or "").strip(),
            expected_receiver=str(expected_receiver or "").strip(),
        )
        async with self._lock:
            self._pending[normalized_id] = pending
        await self.stats.record_delivery_registered()
        return True

    async def cancel(self, client_message_id: str) -> bool:
        normalized_id = str(client_message_id or "").strip()
        async with self._lock:
            pending = self._pending.pop(normalized_id, None)
        if pending is None:
            return False
        await self.stats.record_delivery_cancelled()
        return True

    async def observe(self, *, receiver_username: str, message: dict[str, Any]) -> bool:
        if str(message.get("type") or "") != "chat.message.created":
            return False
        payload = message.get("payload")
        if not isinstance(payload, dict):
            return False
        client_message_id = str(payload.get("client_message_id") or "").strip()
        if not client_message_id:
            return False
        receiver = str(receiver_username or "").strip()
        async with self._lock:
            pending = self._pending.get(client_message_id)
            if pending is None:
                return False
            if receiver == pending.sender_username:
                return False
            if pending.expected_receiver and receiver != pending.expected_receiver:
                return False
            self._pending.pop(client_message_id, None)
        elapsed_ms = (time.perf_counter() - pending.started_at) * 1000.0
        await self.stats.record_delivery_observed(kind=pending.kind, elapsed_ms=elapsed_ms)
        return True

    async def finalize(self) -> int:
        async with self._lock:
            if self._finalized:
                return 0
            missing = len(self._pending)
            self._pending.clear()
            self._finalized = True
        await self.stats.record_delivery_missing(missing)
        return missing


class WsSession:
    """Always-on reader + request/response waiters (does not stall under fan-out)."""

    def __init__(
        self,
        ws: Any,
        *,
        username: str = "",
        delivery_tracker: DeliveryTracker | None = None,
    ) -> None:
        self.ws = ws
        self.username = str(username or "").strip()
        self.delivery_tracker = delivery_tracker
        self.incoming_reads = IncomingReadTracker()
        self.pending: dict[str, asyncio.Future] = {}
        self.stop_event = asyncio.Event()
        self.reader = asyncio.create_task(self._read_loop(), name="lt-ws-reader")

    async def _read_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except ConnectionClosed:
                break
            except Exception:
                break
            try:
                message = json.loads(raw)
            except Exception:
                continue
            if not isinstance(message, dict):
                continue
            request_id = str(message.get("request_id") or "")
            future = self.pending.get(request_id) if request_id else None
            if future is not None and not future.done():
                future.set_result(message)
                continue
            self.incoming_reads.observe(message)
            if self.delivery_tracker is not None:
                await self.delivery_tracker.observe(
                    receiver_username=self.username,
                    message=message,
                )

    async def send_command(
        self,
        *,
        command_type: str,
        conversation_id: str | None = None,
        payload: dict[str, Any] | None = None,
        timeout_sec: float = 15.0,
    ) -> tuple[dict[str, Any], float]:
        request_id = f"lt-{uuid.uuid4().hex}"
        envelope: dict[str, Any] = {"type": command_type, "request_id": request_id}
        if conversation_id:
            envelope["conversation_id"] = conversation_id
        if payload is not None:
            envelope["payload"] = payload
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self.pending[request_id] = future
        started = time.perf_counter()
        try:
            await self.ws.send(json.dumps(envelope, ensure_ascii=False))
            message = await asyncio.wait_for(future, timeout=max(1.0, float(timeout_sec)))
        finally:
            self.pending.pop(request_id, None)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        event_type = str(message.get("type") or "")
        nested = message.get("payload") if isinstance(message.get("payload"), dict) else {}
        code = str(message.get("code") or nested.get("code") or "")
        if event_type.endswith(".error") or code in {"rate_limited", "command_failed"}:
            detail = str(
                message.get("detail")
                or nested.get("detail")
                or message.get("code")
                or nested.get("code")
                or "ws command failed"
            )
            raise RuntimeError(detail)
        return message, elapsed_ms

    async def close(self) -> None:
        self.stop_event.set()
        self.reader.cancel()
        try:
            await self.reader
        except asyncio.CancelledError:
            pass
        except Exception:
            pass


async def ws_send_command(
    ws: Any,
    *,
    command_type: str,
    conversation_id: str | None = None,
    payload: dict[str, Any] | None = None,
    timeout_sec: float = 15.0,
    session: "WsSession | None" = None,
) -> tuple[dict[str, Any], float]:
    if session is not None:
        return await session.send_command(
            command_type=command_type,
            conversation_id=conversation_id,
            payload=payload,
            timeout_sec=timeout_sec,
        )
    # Legacy fallback (single-threaded recv) — prefer WsSession under load.
    request_id = f"lt-{uuid.uuid4().hex}"
    envelope: dict[str, Any] = {"type": command_type, "request_id": request_id}
    if conversation_id:
        envelope["conversation_id"] = conversation_id
    if payload is not None:
        envelope["payload"] = payload

    started = time.perf_counter()
    await ws.send(json.dumps(envelope, ensure_ascii=False))
    deadline = time.monotonic() + max(1.0, float(timeout_sec))
    while time.monotonic() < deadline:
        remaining = max(0.1, deadline - time.monotonic())
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        try:
            message = json.loads(raw)
        except Exception:
            continue
        if not isinstance(message, dict):
            continue
        if str(message.get("request_id") or "") != request_id:
            continue
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        event_type = str(message.get("type") or "")
        nested = message.get("payload") if isinstance(message.get("payload"), dict) else {}
        code = str(message.get("code") or nested.get("code") or "")
        if event_type.endswith(".error") or code in {"rate_limited", "command_failed"}:
            detail = str(
                message.get("detail")
                or nested.get("detail")
                or message.get("code")
                or nested.get("code")
                or "ws command failed"
            )
            raise RuntimeError(detail)
        return message, elapsed_ms
    raise TimeoutError(f"WS command timed out: {command_type}")


async def hold_ws_reader(ws: Any, stop_event: asyncio.Event) -> None:
    """Drain inbound events so the socket buffer does not stall under fan-out."""
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(ws.recv(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except ConnectionClosed:
            break
        except Exception:
            break


class WsConnectForbidden(RuntimeError):
    """Hard access denial — do not re-login in a loop."""

    def __init__(self, status: int, reason: str, message: str = ""):
        super().__init__(message or f"ws_connect_denied status={status} reason={reason}")
        self.status = int(status)
        self.reason = str(reason)


async def ensure_ws_connected(
    *,
    ws_url: str,
    headers: list[tuple[str, str]],
    ssl_context: ssl.SSLContext | bool | None,
    stats: RunStats,
    username: str = "",
    delivery_tracker: DeliveryTracker | None = None,
    reconnect: bool = False,
    max_attempts: int = 4,
) -> WsSession:
    if websockets is None:
        raise RuntimeError("websockets package is required (install uvicorn[standard] / websockets)")

    connect_kwargs: dict[str, Any] = {
        "additional_headers": headers,
        "open_timeout": 20,
        # Large inbound buffer so group fan-out does not block the server sender.
        "max_queue": 2048,
    }
    if ssl_context is not None:
        connect_kwargs["ssl"] = ssl_context

    last_exc: BaseException | None = None
    attempts = max(1, int(max_attempts))
    for attempt in range(1, attempts + 1):
        started = time.perf_counter()
        try:
            ws = await websockets.connect(ws_url, **connect_kwargs)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            await stats.record_timing("ws_connect", elapsed_ms)
            await stats.record_ws(connects=1, reconnects=1 if reconnect else 0)
            if attempt > 1:
                await stats.record_ws_recovered(reason="connect_retry")
            return WsSession(
                ws,
                username=username,
                delivery_tracker=delivery_tracker,
            )
        except Exception as exc:
            last_exc = exc
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            await stats.record_timing("ws_connect", elapsed_ms)
            status = _ws_reject_status(exc)
            if status is None and not isinstance(exc, InvalidStatus):
                # Transport / timeout — retry with backoff.
                if attempt < attempts:
                    await asyncio.sleep(min(2.0, 0.15 * (2 ** (attempt - 1))))
                    continue
                raise
            status = int(status or 403)
            reason = _ws_deny_reason_for_status(status)
            await stats.record_ws_denied(status=status, reason=reason)
            if status == 403:
                raise WsConnectForbidden(status, reason, str(exc)) from exc
            if status == 401:
                # Caller should re-login; do not spin forever here.
                raise
            if status in {429, 503}:
                retry_after = 0.5 * attempt
                response = getattr(exc, "response", None)
                header_val = None
                if response is not None:
                    headers_map = getattr(response, "headers", None) or {}
                    try:
                        header_val = headers_map.get("Retry-After") or headers_map.get("retry-after")
                    except Exception:
                        header_val = None
                if header_val is not None:
                    try:
                        retry_after = max(retry_after, float(header_val))
                    except Exception:
                        pass
                if attempt < attempts:
                    await asyncio.sleep(retry_after)
                    continue
                raise
            if attempt < attempts:
                await asyncio.sleep(min(2.0, 0.15 * (2 ** (attempt - 1))))
                continue
            raise
    assert last_exc is not None
    raise last_exc


async def close_ws_session(
    session: WsSession | None,
    stats: RunStats,
    *,
    expected: bool = False,
    kind: str = "client_close",
    timeout_sec: float = 3.0,
) -> None:
    if session is None:
        return
    close_timeout = max(0.25, float(timeout_sec or 3.0))
    try:
        await asyncio.wait_for(session.close(), timeout=close_timeout)
    except asyncio.TimeoutError:
        await stats.record_teardown_error(
            "ws_reader_close_timeout",
            f"kind={kind} timeout_sec={close_timeout:.2f}",
        )
    except Exception as exc:
        await stats.record_teardown_error(
            "ws_reader_close_error",
            f"kind={kind} error={type(exc).__name__}: {exc}",
        )
    try:
        await asyncio.wait_for(session.ws.close(), timeout=close_timeout)
    except asyncio.TimeoutError:
        await stats.record_teardown_error(
            "ws_transport_close_timeout",
            f"kind={kind} timeout_sec={close_timeout:.2f}",
        )
    except Exception as exc:
        await stats.record_teardown_error(
            "ws_transport_close_error",
            f"kind={kind} error={type(exc).__name__}: {exc}",
        )
    await stats.record_ws(disconnects=1)
    if expected or stats.phase in {"teardown", "cooldown"}:
        async with stats.lock:
            stats.teardown_disconnects += 1
    else:
        await stats.record_unexpected_disconnect(phase=stats.phase, kind=kind)


def worker_teardown_timeout_sec(args: argparse.Namespace) -> float:
    explicit = float(getattr(args, "worker_teardown_timeout_sec", 0.0) or 0.0)
    if explicit > 0:
        return max(1.0, explicit)
    request_timeout = max(1.0, float(getattr(args, "request_timeout_sec", 25.0) or 25.0))
    delivery_grace = max(0.0, float(getattr(args, "delivery_timeout_sec", 3.0) or 0.0))
    ws_close_timeout = max(0.25, float(getattr(args, "ws_close_timeout_sec", 3.0) or 3.0))
    return request_timeout + delivery_grace + ws_close_timeout


async def settle_worker_tasks(
    workers: list[asyncio.Task],
    stats: RunStats,
    *,
    graceful_timeout_sec: float,
    cancel_timeout_sec: float = 3.0,
) -> list[str]:
    """Bound worker teardown and return genuine worker failures for diagnostics."""
    if not workers:
        return []
    indexed = {task: index for index, task in enumerate(workers)}
    done, pending = await asyncio.wait(
        workers,
        timeout=max(0.1, float(graceful_timeout_sec)),
    )
    timed_out = set(pending)
    if timed_out:
        await stats.record_teardown_error(
            "worker_grace_timeout",
            (
                f"workers={len(timed_out)} "
                f"timeout_sec={max(0.1, float(graceful_timeout_sec)):.2f}"
            ),
            count=len(timed_out),
        )
        for task in timed_out:
            task.cancel()
        cancelled_done, pending = await asyncio.wait(
            timed_out,
            timeout=max(0.1, float(cancel_timeout_sec)),
        )
        done.update(cancelled_done)
        if pending:
            await stats.record_teardown_error(
                "worker_cancel_timeout",
                (
                    f"workers={len(pending)} "
                    f"timeout_sec={max(0.1, float(cancel_timeout_sec)):.2f}"
                ),
                count=len(pending),
            )
            # A second cancellation is best-effort; never await these stragglers here.
            for task in pending:
                task.cancel()

    failures: list[str] = []
    for task in done:
        if task.cancelled():
            continue
        try:
            result = task.result()
        except asyncio.CancelledError:
            continue
        except BaseException as exc:
            failures.append(f"worker[{indexed[task]}] {type(exc).__name__}: {exc}")
        else:
            if isinstance(result, BaseException):
                failures.append(f"worker[{indexed[task]}] {type(result).__name__}: {result}")
    return sorted(failures)


async def connect_ws_with_auth_recovery(
    *,
    client: httpx.AsyncClient,
    credential: Credential,
    args: argparse.Namespace,
    stats: RunStats,
    delivery_tracker: DeliveryTracker,
    client_ip: str,
    ws_url: str,
    headers: list[tuple[str, str]],
    ssl_context: ssl.SSLContext | bool | None,
    reconnect: bool = False,
) -> tuple[WsSession, list[tuple[str, str]]]:
    """Connect WS; on 401 re-login once; on 403 fail VU (no login storm)."""
    try:
        session = await ensure_ws_connected(
            ws_url=ws_url,
            headers=headers,
            ssl_context=ssl_context,
            stats=stats,
            username=credential.username,
            delivery_tracker=delivery_tracker,
            reconnect=reconnect,
        )
        return session, headers
    except WsConnectForbidden:
        raise
    except Exception as exc:
        status = _ws_reject_status(exc)
        if status != 401:
            raise
        logged_in = await login_and_apply_token(
            client,
            credential=credential,
            args=args,
            stats=stats,
            client_ip=client_ip,
        )
        if not logged_in:
            raise
        _token, new_headers = logged_in
        session = await ensure_ws_connected(
            ws_url=ws_url,
            headers=new_headers,
            ssl_context=ssl_context,
            stats=stats,
            username=credential.username,
            delivery_tracker=delivery_tracker,
            reconnect=True,
        )
        await stats.record_ws_recovered(reason="relogin_after_401")
        return session, new_headers


async def login_and_apply_token(
    client: httpx.AsyncClient,
    *,
    credential: Credential,
    args: argparse.Namespace,
    stats: RunStats,
    client_ip: str,
) -> tuple[str, list[tuple[str, str]]] | None:
    login_payload, login_ms = await request_json(
        client,
        method="POST",
        url="/auth/login",
        timeout_sec=args.request_timeout_sec,
        payload={"username": credential.username, "password": credential.password},
    )
    await stats.record_timing("login", login_ms)
    status = str((login_payload or {}).get("status") or "authenticated")
    if status != "authenticated":
        await stats.record_error("login", f"user={credential.username} status={status}")
        return None
    access_token = str((login_payload or {}).get("access_token") or "").strip()
    if not access_token:
        access_token = str(client.cookies.get(str(args.auth_cookie_name)) or "").strip()
    if not access_token:
        await stats.record_error("login", f"user={credential.username} missing access_token")
        return None
    client.headers["Authorization"] = f"Bearer {access_token}"
    headers: list[tuple[str, str]] = [("Authorization", f"Bearer {access_token}")]
    if client_ip:
        headers.append(("X-Forwarded-For", client_ip))
    cookie_header = cookie_header_from_client(client, str(args.auth_cookie_name))
    if cookie_header:
        headers.append(("Cookie", cookie_header))
    # Give session row a moment to become visible under concurrent login storms.
    await asyncio.sleep(0.15)
    return access_token, headers


async def vu_worker(
    worker_id: int,
    credential: Credential,
    args: argparse.Namespace,
    stats: RunStats,
    delivery_tracker: DeliveryTracker,
    stop_at: float,
    ssl_context: ssl.SSLContext | bool | None,
) -> None:
    try:
        await _vu_worker_impl(
            worker_id=worker_id,
            credential=credential,
            args=args,
            stats=stats,
            delivery_tracker=delivery_tracker,
            stop_at=stop_at,
            ssl_context=ssl_context,
        )
    except Exception as exc:
        await stats.record_error("worker_crash", f"user={credential.username} error={exc}")
        raise


async def _vu_worker_impl(
    worker_id: int,
    credential: Credential,
    args: argparse.Namespace,
    stats: RunStats,
    delivery_tracker: DeliveryTracker,
    stop_at: float,
    ssl_context: ssl.SSLContext | bool | None,
) -> None:
    role = resolve_role(worker_id)
    conversation_ids = list(getattr(args, "conversation_ids_list", None) or [])
    if not conversation_ids:
        single = str(args.conversation_id or "").strip()
        if single:
            conversation_ids = [single]
    group_by_username = getattr(args, "group_by_username", None) or {}
    pinned_conversation = ""
    # Prefer per-user shard membership so VU only write to chats they belong to.
    if isinstance(group_by_username, dict):
        pinned_conversation = str(group_by_username.get(credential.username) or "").strip()
    if not pinned_conversation and conversation_ids:
        pinned_conversation = conversation_ids[worker_id % len(conversation_ids)]
    chat_api_base = str(getattr(args, "chat_api_base", "") or "").strip() or str(args.api_base)
    ws_url = api_to_ws_url(chat_api_base)
    verify: ssl.SSLContext | bool = True
    if ssl_context is not None:
        verify = ssl_context

    default_headers: dict[str, str] = {
        # Return bearer tokens in JSON (Secure cookies are not sent over plain http://).
        "X-Auth-Client": "mobile",
    }
    client_ip = client_ip_for_worker(str(args.client_ip or "").strip(), worker_id)
    if client_ip:
        default_headers["X-Forwarded-For"] = client_ip

    from contextlib import AsyncExitStack

    async with AsyncExitStack() as stack:
        client = await stack.enter_async_context(
            httpx.AsyncClient(
                base_url=str(args.api_base).rstrip("/"),
                verify=verify,
                follow_redirects=True,
                headers=default_headers,
            )
        )
        try:
            logged_in = await login_and_apply_token(
                client,
                credential=credential,
                args=args,
                stats=stats,
                client_ip=client_ip,
            )
        except Exception as exc:
            await stats.record_error("login", f"user={credential.username} error={exc}")
            return
        if not logged_in:
            return
        _access_token, headers = logged_in

        if str(chat_api_base).rstrip("/") != str(args.api_base).rstrip("/"):
            chat_client = await stack.enter_async_context(
                httpx.AsyncClient(
                    base_url=str(chat_api_base).rstrip("/"),
                    verify=verify,
                    follow_redirects=True,
                    headers=default_headers,
                )
            )
            chat_client.headers["Authorization"] = client.headers.get("Authorization", "")
        else:
            chat_client = client

        session: WsSession | None = None
        conversation_id = pinned_conversation
        hot_conversation = str(getattr(args, "hot_conversation_id", "") or "").strip()
        if hot_conversation:
            conversation_id = hot_conversation
            pinned_conversation = hot_conversation
        next_ws_ping_at = 0.0
        next_force_reconnect_at = 0.0
        force_reconnect_every = float(getattr(args, "force_reconnect_every_sec", 0.0) or 0.0)
        once_reads = bool(getattr(args, "once_reads", False))
        list_loaded = False
        thread_bootstrapped = False
        subscribed_conversation_ids: set[str] = set()
        chat_read_client: httpx.AsyncClient | None = None
        loop_index = 0
        task_project_id = ""

        try:
            session, headers = await connect_ws_with_auth_recovery(
                client=client,
                credential=credential,
                args=args,
                stats=stats,
                delivery_tracker=delivery_tracker,
                client_ip=client_ip,
                ws_url=ws_url,
                headers=headers,
                ssl_context=ssl_context,
            )
            _, inbox_ms = await ws_send_command(
                session.ws,
                command_type="chat.subscribe_inbox",
                timeout_sec=args.request_timeout_sec,
                session=session,
            )
            await stats.record_timing("ws_subscribe_inbox", inbox_ms)
            next_ws_ping_at = time.monotonic() + max(5.0, float(args.ws_ping_sec))
        except WsConnectForbidden as exc:
            await stats.record_error(
                "ws_connect_forbidden",
                f"user={credential.username} status={exc.status} reason={exc.reason}",
            )
            await close_ws_session(
                session,
                stats,
                expected=True,
                kind="forbidden",
                timeout_sec=args.ws_close_timeout_sec,
            )
            return
        except Exception as exc:
            await stats.record_error("ws_connect", f"user={credential.username} error={exc}")
            await close_ws_session(
                session,
                stats,
                kind="connect_failure",
                timeout_sec=args.ws_close_timeout_sec,
            )
            session = None

        while time.monotonic() < stop_at:
            try:
                light_hub = bool(getattr(args, "light_hub", False))
                skip_hub = bool(getattr(args, "skip_hub", False)) or light_hub
                skip_conversations = bool(getattr(args, "skip_conversations", False))
                skip_bootstrap = bool(getattr(args, "skip_bootstrap", False))
                skip_messages = bool(getattr(args, "skip_messages", False))
                if once_reads:
                    if list_loaded:
                        skip_conversations = True
                    if thread_bootstrapped:
                        skip_bootstrap = True
                        skip_messages = True
                if force_reconnect_every > 0 and session is not None:
                    now_mono = time.monotonic()
                    if next_force_reconnect_at <= 0:
                        next_force_reconnect_at = now_mono + force_reconnect_every
                    elif now_mono >= next_force_reconnect_at:
                        await close_ws_session(
                            session,
                            stats,
                            expected=True,
                            kind="forced_reconnect",
                            timeout_sec=args.ws_close_timeout_sec,
                        )
                        session = None
                        session, headers = await connect_ws_with_auth_recovery(
                            client=client,
                            credential=credential,
                            args=args,
                            stats=stats,
                            delivery_tracker=delivery_tracker,
                            client_ip=client_ip,
                            ws_url=ws_url,
                            headers=headers,
                            ssl_context=ssl_context,
                            reconnect=True,
                        )
                        subscribed_conversation_ids.clear()
                        _, inbox_ms = await ws_send_command(
                            session.ws,
                            command_type="chat.subscribe_inbox",
                            timeout_sec=args.request_timeout_sec,
                            session=session,
                        )
                        await stats.record_timing("ws_subscribe_inbox", inbox_ms)
                        next_force_reconnect_at = now_mono + force_reconnect_every
                        list_loaded = False
                        thread_bootstrapped = False
                read_client = chat_client
                read_base = str(getattr(args, "chat_read_api_base", "") or "").strip()
                if read_base:
                    # Separate Chat Read process (diagnostic split). Reuse auth header.
                    if chat_read_client is None:
                        chat_read_client = httpx.AsyncClient(
                            base_url=read_base.rstrip("/"),
                            verify=verify,
                            follow_redirects=True,
                            headers=default_headers,
                        )
                        stack.push_async_callback(chat_read_client.aclose)
                    chat_read_client.headers["Authorization"] = client.headers.get("Authorization", "")
                    read_client = chat_read_client

                if (not skip_hub) and role in {"busy_hub", "idle"}:
                    await timed_http_request(
                        client,
                        stats,
                        stage="hub_dashboard",
                        method="GET",
                        path="/hub/dashboard",
                        worker_id=worker_id,
                        username=credential.username,
                        role=role,
                        timeout_sec=args.request_timeout_sec,
                    )
                    await timed_http_request(
                        client,
                        stats,
                        stage="hub_tasks",
                        method="GET",
                        path="/hub/tasks",
                        params={"scope": "my", "role_scope": "both", "limit": 100},
                        worker_id=worker_id,
                        username=credential.username,
                        role=role,
                        timeout_sec=args.request_timeout_sec,
                    )
                    await timed_http_request(
                        client,
                        stats,
                        stage="hub_unread_counts",
                        method="GET",
                        path="/hub/notifications/unread-counts",
                        worker_id=worker_id,
                        username=credential.username,
                        role=role,
                        timeout_sec=args.request_timeout_sec,
                    )

                if (not skip_hub) and role in {"busy_hub", "active_chat", "idle"}:
                    await timed_http_request(
                        client,
                        stats,
                        stage="hub_notifications_poll",
                        method="GET",
                        path="/hub/notifications/poll",
                        params={"limit": 20},
                        worker_id=worker_id,
                        username=credential.username,
                        role=role,
                        timeout_sec=args.request_timeout_sec,
                    )

                task_every = max(0, int(getattr(args, "task_create_every_loops", 0) or 0))
                if (
                    stats.phase == "measurement"
                    and task_every > 0
                    and role == "busy_hub"
                    and (loop_index + 1) % task_every == 0
                ):
                    assignee_id = int(
                        (getattr(args, "user_id_by_username", {}) or {}).get(credential.username) or 0
                    )
                    if assignee_id > 0:
                        try:
                            if not task_project_id:
                                projects_response, _projects_ms, _ = await timed_http_request(
                                    client,
                                    stats,
                                    stage="hub_task_projects",
                                    method="GET",
                                    path="/hub/task-projects",
                                    worker_id=worker_id,
                                    username=credential.username,
                                    role=role,
                                    timeout_sec=args.request_timeout_sec,
                                )
                                projects = list((projects_response.json() or {}).get("items") or [])
                                task_project_id = str((projects[0] if projects else {}).get("id") or "").strip()
                                if not task_project_id:
                                    raise RuntimeError("no active Hub task project")
                            await timed_http_request(
                                client,
                                stats,
                                stage="hub_task_create",
                                method="POST",
                                path="/hub/tasks",
                                json_body={
                                    "title": (
                                        f"LoadTestPerf {credential.username} "
                                        f"w={worker_id} loop={loop_index} {uuid.uuid4().hex[:8]}"
                                    ),
                                    "description": "HUB-IT mixed workload capacity test",
                                    "assignee_user_ids": [assignee_id],
                                    "project_id": task_project_id,
                                    "priority": "normal",
                                },
                                worker_id=worker_id,
                                username=credential.username,
                                role=role,
                                timeout_sec=args.request_timeout_sec,
                            )
                        except Exception as exc:
                            await stats.record_error(
                                "hub_task_create",
                                f"user={credential.username} error={exc}",
                            )

                # light_hub / skip_hub: idle users only hold WS; avoid list/bootstrap stampede.
                # stampede profile: all roles hit chat reads.
                scenario_profile = str(getattr(args, "scenario_profile", "") or "").strip().lower()
                poll_chat_http = (
                    role in {"active_chat", "busy_hub"}
                    or ((not skip_hub) and role == "idle")
                    or scenario_profile == "stampede"
                )
                if poll_chat_http and not skip_conversations:
                    response, _conversations_ms, _cid = await timed_http_request(
                        read_client,
                        stats,
                        stage="chat_conversations",
                        method="GET",
                        path="/chat/conversations",
                        params={"limit": 50},
                        worker_id=worker_id,
                        username=credential.username,
                        role=role,
                        timeout_sec=args.request_timeout_sec,
                    )
                    conversations_payload = response.json()
                    if not conversation_id:
                        conversation_id = first_conversation_id(conversations_payload)
                    list_loaded = True

                if conversation_id and (
                    role in {"active_chat", "busy_hub"} or scenario_profile == "stampede"
                ):
                    if not skip_bootstrap:
                        response, _bootstrap_ms, _cid = await timed_http_request(
                            read_client,
                            stats,
                            stage="chat_thread_bootstrap",
                            method="GET",
                            path=f"/chat/conversations/{conversation_id}/thread-bootstrap",
                            params={"limit": 40, "lightweight": "1"},
                            worker_id=worker_id,
                            username=credential.username,
                            role=role,
                            timeout_sec=args.request_timeout_sec,
                        )
                        bootstrap_payload = response.json()
                        thread_bootstrapped = True

                    if not skip_messages:
                        response, _messages_ms, _cid = await timed_http_request(
                            read_client,
                            stats,
                            stage="chat_messages",
                            method="GET",
                            path=f"/chat/conversations/{conversation_id}/messages",
                            params={"limit": 50},
                            worker_id=worker_id,
                            username=credential.username,
                            role=role,
                            timeout_sec=args.request_timeout_sec,
                        )
                        messages_payload = response.json()

                    if session is not None:
                        try:
                            if conversation_id not in subscribed_conversation_ids:
                                _, sub_ms = await ws_send_command(
                                    session.ws,
                                    command_type="chat.subscribe_conversation",
                                    conversation_id=conversation_id,
                                    timeout_sec=args.request_timeout_sec,
                                    session=session,
                                )
                                subscribed_conversation_ids.add(conversation_id)
                                await stats.record_timing(
                                    "ws_subscribe_conversation",
                                    sub_ms,
                                    worker_id=worker_id,
                                    username=credential.username,
                                    role=role,
                                    path="ws:chat.subscribe_conversation",
                                )

                            writes_allowed_in_phase = (
                                stats.phase == "measurement"
                                or bool(getattr(args, "writes_during_warmup", False))
                            )
                            if (
                                bool(args.enable_writes)
                                and writes_allowed_in_phase
                                and role in {"active_chat", "busy_hub"}
                            ):
                                write_targets = str(getattr(args, "write_targets", "both") or "both")
                                dm_conversation_id = str(
                                    (getattr(args, "dm_by_username", {}) or {}).get(credential.username) or ""
                                ).strip()
                                targets: list[tuple[str, str]] = []
                                if write_targets in {"group", "both"} and conversation_id:
                                    targets.append(("group", conversation_id))
                                if write_targets in {"dm", "both"} and dm_conversation_id:
                                    targets.append(("dm", dm_conversation_id))
                                for kind, target_conversation_id in targets:
                                    stage_name = (
                                        "ws_send_message_group" if kind == "group" else "ws_send_message_dm"
                                    )
                                    if target_conversation_id not in subscribed_conversation_ids:
                                        _, sub_target_ms = await ws_send_command(
                                            session.ws,
                                            command_type="chat.subscribe_conversation",
                                            conversation_id=target_conversation_id,
                                            timeout_sec=args.request_timeout_sec,
                                            session=session,
                                        )
                                        await stats.record_timing(
                                            "ws_subscribe_conversation",
                                            sub_target_ms,
                                            worker_id=worker_id,
                                            username=credential.username,
                                            role=role,
                                            path=f"ws:chat.subscribe_conversation:{kind}",
                                        )
                                        subscribed_conversation_ids.add(target_conversation_id)
                                    body = (
                                        f"loadtest {kind} msg w={worker_id} "
                                        f"u={credential.username} {uuid.uuid4().hex[:8]}"
                                    )
                                    client_message_id = f"lt-{kind}-{uuid.uuid4().hex}"
                                    expected_receiver = ""
                                    if kind == "dm":
                                        expected_receiver = str(
                                            (getattr(args, "dm_peer_by_username", {}) or {}).get(
                                                credential.username
                                            )
                                            or ""
                                        ).strip()
                                    delivery_registered = await delivery_tracker.register(
                                        client_message_id,
                                        kind=kind,
                                        sender_username=credential.username,
                                        expected_receiver=expected_receiver,
                                    )
                                    try:
                                        _, send_ms = await ws_send_command(
                                            session.ws,
                                            command_type="chat.send_message",
                                            conversation_id=target_conversation_id,
                                            payload={
                                                "body": body,
                                                "body_format": "plain",
                                                "client_message_id": client_message_id,
                                            },
                                            timeout_sec=args.request_timeout_sec,
                                            session=session,
                                        )
                                        await stats.record_timing(
                                            "ws_send_message",
                                            send_ms,
                                            worker_id=worker_id,
                                            username=credential.username,
                                            role=role,
                                            path=f"ws:chat.send_message:{kind}",
                                        )
                                        await stats.record_timing(
                                            stage_name,
                                            send_ms,
                                            worker_id=worker_id,
                                            username=credential.username,
                                            role=role,
                                            path=f"ws:chat.send_message:{kind}",
                                        )
                                    except Exception as send_exc:
                                        if delivery_registered:
                                            await delivery_tracker.cancel(client_message_id)
                                        await stats.record_error(
                                            stage_name,
                                            f"user={credential.username} kind={kind} error={send_exc}",
                                        )
                                        await stats.record_send_error(
                                            reason=f"{type(send_exc).__name__}:{str(send_exc)[:60]}"
                                        )
                                        # Keep going so DM is still measured if group send fails.
                                        continue

                                message_id = first_message_id(bootstrap_payload) or first_message_id(messages_payload)
                                # light-hub focuses on send latency; mark_read fan-out was starving
                                # the chat write pool under 100 concurrent VU.
                                if message_id and not light_hub:
                                    await timed_http_request(
                                        chat_client,
                                        stats,
                                        stage="http_mark_read",
                                        method="POST",
                                        path=f"/chat/conversations/{conversation_id}/read",
                                        json_body={"message_id": message_id},
                                        worker_id=worker_id,
                                        username=credential.username,
                                        role=role,
                                        timeout_sec=args.request_timeout_sec,
                                    )
                        finally:
                            pass

                file_every = max(0, int(getattr(args, "file_flow_every_loops", 0) or 0))
                file_users = max(0, int(getattr(args, "file_flow_users", 0) or 0))
                file_conversation_id = str(
                    (getattr(args, "dm_by_username", {}) or {}).get(credential.username) or ""
                ).strip()
                if (
                    stats.phase == "measurement"
                    and worker_id < file_users
                    and file_every > 0
                    and file_conversation_id
                    and (loop_index + 1) % file_every == 0
                ):
                    try:
                        await run_chat_file_preview_flow(
                            chat_client,
                            stats,
                            conversation_id=file_conversation_id,
                            worker_id=worker_id,
                            username=credential.username,
                            role=role,
                            timeout_sec=args.request_timeout_sec,
                            loop_index=loop_index,
                        )
                    except Exception as exc:
                        await stats.record_error(
                            "chat_file_flow",
                            f"user={credential.username} error={exc}",
                        )

                if bool(getattr(args, "mark_read_incoming", False)) and session is not None:
                    for read_conversation_id, read_message_id in session.incoming_reads.pending(
                        allowed_conversation_ids=subscribed_conversation_ids,
                    ):
                        try:
                            _, mark_read_ms = await ws_send_command(
                                session.ws,
                                command_type="chat.mark_read",
                                conversation_id=read_conversation_id,
                                payload={"message_id": read_message_id},
                                timeout_sec=args.request_timeout_sec,
                                session=session,
                            )
                            await stats.record_timing(
                                "ws_mark_read",
                                mark_read_ms,
                                worker_id=worker_id,
                                username=credential.username,
                                role=role,
                                path="ws:chat.mark_read",
                            )
                            session.incoming_reads.complete(read_conversation_id, read_message_id)
                        except Exception as exc:
                            # Keep the target pending: mark_read is idempotent and a lost ACK is retry-safe.
                            await stats.record_error(
                                "ws_mark_read",
                                f"user={credential.username} conversation={read_conversation_id} error={exc}",
                            )

                if session is not None and time.monotonic() >= next_ws_ping_at:
                    try:
                        _, ping_ms = await ws_send_command(
                            session.ws,
                            command_type="chat.ping",
                            timeout_sec=min(10.0, float(args.request_timeout_sec)),
                            session=session,
                        )
                        await stats.record_timing(
                            "ws_ping",
                            ping_ms,
                            worker_id=worker_id,
                            username=credential.username,
                            role=role,
                            path="ws:chat.ping",
                        )
                    except Exception as exc:
                        await stats.record_error("ws_ping", f"user={credential.username} error={exc}")
                        await close_ws_session(
                            session,
                            stats,
                            kind="ping_failure",
                            timeout_sec=args.ws_close_timeout_sec,
                        )
                        session = None
                        try:
                            session, headers = await connect_ws_with_auth_recovery(
                                client=client,
                                credential=credential,
                                args=args,
                                stats=stats,
                                delivery_tracker=delivery_tracker,
                                client_ip=client_ip,
                                ws_url=ws_url,
                                headers=headers,
                                ssl_context=ssl_context,
                                reconnect=True,
                            )
                            _, inbox_ms = await ws_send_command(
                                session.ws,
                                command_type="chat.subscribe_inbox",
                                timeout_sec=args.request_timeout_sec,
                                session=session,
                            )
                            await stats.record_timing("ws_subscribe_inbox", inbox_ms)
                        except WsConnectForbidden as forbidden_exc:
                            await stats.record_error(
                                "ws_reconnect_forbidden",
                                f"user={credential.username} status={forbidden_exc.status} "
                                f"reason={forbidden_exc.reason}",
                            )
                            return
                        except Exception as reconnect_exc:
                            await stats.record_error(
                                "ws_reconnect",
                                f"user={credential.username} error={reconnect_exc}",
                            )
                            session = None
                    next_ws_ping_at = time.monotonic() + max(5.0, float(args.ws_ping_sec))

                await stats.record_loop()
                loop_index += 1
            except httpx.HTTPStatusError as exc:
                status_code = int(exc.response.status_code) if exc.response is not None else 0
                # Read admission (429/503) is expected under E_STAMPEDE; do not treat as send/hard error.
                if status_code in {429, 503}:
                    await stats.record_read_throttle(status=status_code, stage="http_loop")
                else:
                    await stats.record_error(
                        "loop",
                        f"user={credential.username} role={role} error=HTTP {status_code}: "
                        f"{(exc.response.text[:200] if exc.response is not None else str(exc))}",
                    )
                if status_code == 401:
                    try:
                        logged_in = await login_and_apply_token(
                            client,
                            credential=credential,
                            args=args,
                            stats=stats,
                            client_ip=client_ip,
                        )
                        if logged_in:
                            _access_token, headers = logged_in
                            await close_ws_session(
                                session,
                                stats,
                                expected=True,
                                kind="relogin",
                                timeout_sec=args.ws_close_timeout_sec,
                            )
                            session, headers = await connect_ws_with_auth_recovery(
                                client=client,
                                credential=credential,
                                args=args,
                                stats=stats,
                                delivery_tracker=delivery_tracker,
                                client_ip=client_ip,
                                ws_url=ws_url,
                                headers=headers,
                                ssl_context=ssl_context,
                                reconnect=True,
                            )
                            _, inbox_ms = await ws_send_command(
                                session.ws,
                                command_type="chat.subscribe_inbox",
                                timeout_sec=args.request_timeout_sec,
                                session=session,
                            )
                            await stats.record_timing("ws_subscribe_inbox", inbox_ms)
                    except WsConnectForbidden as forbidden_exc:
                        await stats.record_error(
                            "relogin_forbidden",
                            f"user={credential.username} status={forbidden_exc.status}",
                        )
                        return
                    except Exception as relogin_exc:
                        await stats.record_error(
                            "relogin",
                            f"user={credential.username} error={relogin_exc}",
                        )
                elif status_code == 403:
                    # Access denied — do not create login/reconnect storm.
                    await stats.record_error(
                        "http_forbidden",
                        f"user={credential.username} role={role}",
                    )
                    return
                elif status_code in {429, 503}:
                    retry_after = 1.0
                    try:
                        header_val = exc.response.headers.get("Retry-After") if exc.response else None
                        if header_val is not None:
                            retry_after = max(0.25, float(header_val))
                    except Exception:
                        pass
                    # Jittered backoff; 503 must not trigger reconnect.
                    jitter = retry_after * (0.15 * random.random())
                    await asyncio.sleep(retry_after + jitter)
                    continue
                await asyncio.sleep(min(float(args.think_time_sec), 1.0))
            except Exception as exc:
                await stats.record_error("loop", f"user={credential.username} role={role} error={exc}")
                await asyncio.sleep(min(float(args.think_time_sec), 1.0))

            if args.think_time_sec > 0:
                await asyncio.sleep(float(args.think_time_sec))

        if bool(args.enable_writes) and session is not None:
            await asyncio.sleep(max(0.0, float(getattr(args, "delivery_timeout_sec", 3.0) or 0.0)))
        await close_ws_session(
            session,
            stats,
            expected=True,
            kind="teardown",
            timeout_sec=args.ws_close_timeout_sec,
        )


async def rss_sampler(*, pid: int, stats: RunStats, stop_event: asyncio.Event, sample_sec: float) -> None:
    if pid <= 0:
        return
    try:
        import psutil  # type: ignore
    except Exception:
        return
    try:
        process = psutil.Process(pid)
    except Exception:
        return
    while not stop_event.is_set():
        try:
            rss_bytes = float(process.memory_info().rss)
        except Exception:
            break
        await stats.record_rss(rss_bytes / (1024.0 * 1024.0))
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=max(0.5, float(sample_sec or 5.0)))
        except asyncio.TimeoutError:
            continue


def build_report(stats: RunStats, args: argparse.Namespace) -> dict[str, Any]:
    finished_at = stats.finished_at or time.monotonic()
    elapsed_sec = max(0.0, finished_at - stats.started_at)
    request_count = int(stats.request_count)
    error_count = int(stats.error_count)
    error_rate = (float(error_count) / float(request_count)) if request_count else 0.0

    timing_summary: dict[str, dict[str, Any]] = {}
    for name, values in stats.timings_ms.items():
        timing_summary[name] = {
            "count": len(values),
            "mean_ms": mean_ms(values),
            "p50_ms": percentile_ms(values, 50),
            "p95_ms": percentile_ms(values, 95),
            "p99_ms": percentile_ms(values, 99),
            "max_ms": max(values) if values else None,
        }

    rss_summary = {
        "samples": len(stats.rss_samples_mb),
        "min_mb": min(stats.rss_samples_mb) if stats.rss_samples_mb else None,
        "max_mb": max(stats.rss_samples_mb) if stats.rss_samples_mb else None,
        "growth_mb": (
            (stats.rss_samples_mb[-1] - stats.rss_samples_mb[0])
            if len(stats.rss_samples_mb) >= 2
            else None
        ),
    }

    def p95(name: str) -> float | None:
        entry = timing_summary.get(name) or {}
        if int(entry.get("count") or 0) <= 0:
            return None
        value = entry.get("p95_ms")
        return None if value is None else float(value)

    def slo_le(name: str, limit_ms: float, *, required: bool = True) -> bool:
        value = p95(name)
        if value is None:
            return not required
        return value <= limit_ms

    slo_profile = str(getattr(args, "slo_profile", "standard") or "standard").strip().lower()
    if slo_profile not in {"standard", "capacity_150"}:
        slo_profile = "standard"
    capacity_150 = slo_profile == "capacity_150"
    hub_reads_required = not bool(getattr(args, "skip_hub", False) or getattr(args, "light_hub", False))
    hub_dashboard_limit_ms = 1500.0 if capacity_150 else 2000.0
    hub_tasks_limit_ms = 1500.0 if capacity_150 else 2000.0
    slos = {
        "error_rate_lt_1pct": error_rate < 0.01,
        f"hub_dashboard_p95_le_{int(hub_dashboard_limit_ms)}ms": slo_le(
            "hub_dashboard", hub_dashboard_limit_ms, required=hub_reads_required
        ),
        f"hub_tasks_p95_le_{int(hub_tasks_limit_ms)}ms": slo_le(
            "hub_tasks", hub_tasks_limit_ms, required=hub_reads_required
        ),
        "chat_conversations_p95_le_1500ms": slo_le("chat_conversations", 1500.0),
        "chat_thread_bootstrap_p95_le_2000ms": slo_le("chat_thread_bootstrap", 2000.0),
        "ws_connect_p95_le_3000ms": slo_le("ws_connect", 3000.0),
        "ws_ping_p95_le_1000ms": slo_le("ws_ping", 1000.0, required=False),
        "rss_not_growing_continuously": (
            rss_summary["growth_mb"] is None or float(rss_summary["growth_mb"]) <= 256.0
        ),
    }
    if bool(args.enable_writes):
        send_limit_ms = 500.0 if capacity_150 else 2500.0
        delivery_p95_limit_ms = 1000.0 if capacity_150 else 500.0
        delivery_p99_limit_ms = 2000.0 if capacity_150 else 1000.0
        slos[f"ws_send_message_p95_le_{int(send_limit_ms)}ms"] = slo_le(
            "ws_send_message", send_limit_ms, required=False
        )
        slos[f"ws_send_message_group_p95_le_{int(send_limit_ms)}ms"] = slo_le(
            "ws_send_message_group", send_limit_ms, required=False
        )
        slos[f"ws_send_message_dm_p95_le_{int(send_limit_ms)}ms"] = slo_le(
            "ws_send_message_dm", send_limit_ms, required=False
        )
        delivery_samples = list(stats.timings_ms.get("ws_delivery_event") or [])
        delivery_eligible = max(
            0,
            int(stats.delivery_registered) - int(stats.delivery_cancelled),
        )
        delivery_missing = max(
            int(stats.delivery_missing),
            delivery_eligible - int(stats.delivery_observed),
        )
        delivery_p99 = percentile_ms(delivery_samples, 99) if delivery_samples else None
        slos["delivery_missing_eq_0"] = delivery_missing == 0
        slos[f"delivery_p95_le_{int(delivery_p95_limit_ms)}ms"] = slo_le(
            "ws_delivery_event", delivery_p95_limit_ms, required=delivery_eligible > 0
        )
        slos[f"delivery_p99_le_{int(delivery_p99_limit_ms)}ms"] = (
            delivery_p99 is None or float(delivery_p99) <= delivery_p99_limit_ms
        )
    else:
        delivery_eligible = 0
        delivery_missing = 0

    if bool(getattr(args, "mark_read_incoming", False)):
        slos["ws_mark_read_p95_le_1000ms"] = slo_le("ws_mark_read", 1000.0)

    if int(getattr(args, "task_create_every_loops", 0) or 0) > 0:
        slos["hub_task_create_p95_le_2000ms"] = slo_le("hub_task_create", 2000.0)
    if int(getattr(args, "file_flow_every_loops", 0) or 0) > 0:
        slos["chat_file_upload_p95_le_3000ms"] = slo_le("chat_file_upload", 3000.0)
        preview_limit_ms = 8000.0 if capacity_150 else 5000.0
        slos[f"chat_file_preview_p95_le_{int(preview_limit_ms)}ms"] = slo_le(
            "chat_file_preview", preview_limit_ms
        )
        slos["chat_file_preview_pdf_p95_le_2000ms"] = slo_le("chat_file_preview_pdf", 2000.0)

    if capacity_150:
        slos["hub_notifications_poll_p95_le_1000ms"] = slo_le(
            "hub_notifications_poll", 1000.0, required=hub_reads_required
        )
        # This runner deliberately contains no /mail calls. Mail performance
        # is exercised through cached browser state only, never through Exchange.
        slos["mail_external_calls_eq_0"] = True

    unexpected_ws_denial = int(stats.unexpected_ws_denial_count())
    unexpected_disconnect = int(sum(stats.unexpected_disconnect_total.values()))
    send_errors = int(sum(stats.send_error_total.values()))
    read_throttles = int(sum(stats.read_throttle_total.values()))
    steady_gates = {
        "unexpected_ws_denial": unexpected_ws_denial,
        "unexpected_disconnect": unexpected_disconnect,
        "send_errors": send_errors,
        "read_throttles": read_throttles,
        "unexpected_ws_denial_eq_0": unexpected_ws_denial == 0,
        "unexpected_disconnect_eq_0": unexpected_disconnect == 0,
        "send_errors_eq_0": send_errors == 0,
        "delivery_missing_eq_0": delivery_missing == 0,
    }
    if bool(getattr(args, "steady_state_gates", False)):
        slos["unexpected_ws_denial_eq_0"] = bool(steady_gates["unexpected_ws_denial_eq_0"])
        slos["unexpected_disconnect_eq_0"] = bool(steady_gates["unexpected_disconnect_eq_0"])
        slos["send_errors_eq_0"] = bool(steady_gates["send_errors_eq_0"])
        if bool(args.enable_writes):
            slos["delivery_missing_eq_0"] = bool(steady_gates["delivery_missing_eq_0"])

    scenario_profile = str(getattr(args, "scenario_profile", "") or "").strip().lower()
    send_p95 = p95("ws_send_message")
    send_p99 = None
    send_samples = list(stats.timings_ms.get("ws_send_message") or [])
    if send_samples:
        send_p99 = percentile_ms(send_samples, 99)
    reconnect_attempts = int(stats.reconnect_attempts)
    reconnect_successes = int(stats.reconnect_successes)
    reconnect_success_rate = (
        (reconnect_successes / reconnect_attempts) if reconnect_attempts > 0 else 1.0
    )
    reconnect_recovery_p95 = p95("ws_reconnect_recovery")
    stampede_gates = {
        "read_503_allowed": True,
        "read_throttles": read_throttles,
        "send_errors_eq_0": send_errors == 0,
        "unexpected_disconnect_eq_0": unexpected_disconnect == 0,
        "ack_p95_le_700ms": send_p95 is None or float(send_p95) <= 700.0,
        "ack_p99_le_1500ms": send_p99 is None or float(send_p99) <= 1500.0,
    }
    stampede_gates["pass"] = (
        bool(stampede_gates["send_errors_eq_0"])
        and bool(stampede_gates["unexpected_disconnect_eq_0"])
        and bool(stampede_gates["ack_p95_le_700ms"])
        and bool(stampede_gates["ack_p99_le_1500ms"])
    )
    reconnect_gates = {
        "reconnect_attempts": reconnect_attempts,
        "reconnect_successes": reconnect_successes,
        "reconnect_success_rate": reconnect_success_rate,
        "reconnect_success_rate_ge_0_95": reconnect_success_rate >= 0.95,
        "ws_reconnect_recovery_p95_ms": reconnect_recovery_p95,
        "ws_reconnect_recovery_p95_le_5000ms": (
            reconnect_recovery_p95 is None or float(reconnect_recovery_p95) <= 5000.0
        ),
        "unexpected_ws_denial_eq_0": unexpected_ws_denial == 0,
        "send_errors_eq_0": send_errors == 0,
        # Forced reconnect disconnects are expected; unexpected_disconnect must stay 0.
        "unexpected_disconnect_eq_0": unexpected_disconnect == 0,
    }
    reconnect_gates["pass"] = (
        bool(reconnect_gates["reconnect_success_rate_ge_0_95"])
        and bool(reconnect_gates["ws_reconnect_recovery_p95_le_5000ms"])
        and bool(reconnect_gates["unexpected_ws_denial_eq_0"])
        and bool(reconnect_gates["send_errors_eq_0"])
        and bool(reconnect_gates["unexpected_disconnect_eq_0"])
    )
    if scenario_profile == "stampede":
        slos["stampede_send_errors_eq_0"] = bool(stampede_gates["send_errors_eq_0"])
        slos["stampede_unexpected_disconnect_eq_0"] = bool(stampede_gates["unexpected_disconnect_eq_0"])
        slos["stampede_ack_p95_le_700ms"] = bool(stampede_gates["ack_p95_le_700ms"])
        slos["stampede_ack_p99_le_1500ms"] = bool(stampede_gates["ack_p99_le_1500ms"])
        slos["stampede_objective"] = bool(stampede_gates["pass"])
        # Read throttles are expected; do not fail generic error_rate on them.
        slos["error_rate_lt_1pct"] = True
    elif scenario_profile == "reconnect":
        slos["reconnect_success_rate_ge_0_95"] = bool(reconnect_gates["reconnect_success_rate_ge_0_95"])
        slos["ws_reconnect_recovery_p95_le_5000ms"] = bool(
            reconnect_gates["ws_reconnect_recovery_p95_le_5000ms"]
        )
        slos["reconnect_unexpected_ws_denial_eq_0"] = bool(reconnect_gates["unexpected_ws_denial_eq_0"])
        slos["reconnect_send_errors_eq_0"] = bool(reconnect_gates["send_errors_eq_0"])
        slos["reconnect_objective"] = bool(reconnect_gates["pass"])

    return {
        "api_base": args.api_base,
        "chat_api_base": str(getattr(args, "chat_api_base", "") or args.api_base),
        "virtual_users": int(args.virtual_users),
        "duration_sec": int(args.duration_sec),
        "think_time_sec": float(args.think_time_sec),
        "enable_writes": bool(args.enable_writes),
        "mark_read_incoming": bool(getattr(args, "mark_read_incoming", False)),
        "scenario_profile": scenario_profile,
        "slo_profile": slo_profile,
        "mail_mode": "hub_cache_only",
        "mail_external_calls": 0,
        "conversation_id": str(args.conversation_id or ""),
        "scenario_loops": int(stats.scenario_loops),
        "request_count": request_count,
        "error_count": error_count,
        "error_rate": error_rate,
        "ws": {
            "connects": int(stats.ws_connects),
            "disconnects": int(stats.ws_disconnects),
            "reconnects": int(stats.ws_reconnects),
            "connect_denied_total": dict(stats.ws_connect_denied_total),
            "connect_recovered_total": dict(stats.ws_connect_recovered_total),
            "unexpected_disconnect_total": dict(stats.unexpected_disconnect_total),
            "teardown_disconnects": int(stats.teardown_disconnects),
            "reconnect_attempts": reconnect_attempts,
            "reconnect_successes": reconnect_successes,
            "reconnect_success_rate": reconnect_success_rate,
        },
        "send_error_total": dict(stats.send_error_total),
        "delivery": {
            "registered": int(stats.delivery_registered),
            "eligible": int(delivery_eligible),
            "observed": int(stats.delivery_observed),
            "cancelled": int(stats.delivery_cancelled),
            "missing": int(delivery_missing),
            "success_rate": (
                float(stats.delivery_observed) / float(delivery_eligible)
                if delivery_eligible > 0
                else 1.0
            ),
        },
        "read_throttle_total": dict(stats.read_throttle_total),
        "steady_gates": steady_gates,
        "stampede_gates": stampede_gates,
        "reconnect_gates": reconnect_gates,
        "timings": timing_summary,
        "rss": rss_summary,
        "slos": slos,
        "error_samples": list(stats.error_samples),
        "error_by_stage": dict(stats.error_by_stage),
        "teardown": {
            "error_count": int(stats.teardown_error_count),
            "error_by_stage": dict(stats.teardown_error_by_stage),
            "error_samples": list(stats.teardown_error_samples),
        },
        "slow_samples": list(stats.slow_samples),
        "slow_threshold_ms": float(stats.slow_threshold_ms),
        "server_metrics": None,
        "chat_health": None,
        "diagnosis": None,
        "elapsed_sec": elapsed_sec,
    }


def print_report(report: dict[str, Any]) -> None:
    timings = report["timings"]
    print("")
    print("Hub+Chat session load test summary")
    print(f"  api_base={report['api_base']}")
    print(f"  virtual_users={report['virtual_users']}")
    print(f"  duration_sec={report['duration_sec']}")
    print(f"  enable_writes={report['enable_writes']}")
    print(f"  scenario_loops={report['scenario_loops']}")
    print(f"  request_count={report['request_count']}")
    print(f"  error_count={report['error_count']}")
    print(f"  error_rate={report['error_rate'] * 100.0:.2f}%")
    teardown = report.get("teardown") or {}
    if int(teardown.get("error_count") or 0) > 0:
        print(
            f"  teardown_errors={teardown.get('error_count')} "
            f"(harness-only, excluded from request SLO)"
        )
    ws = report["ws"]
    print(
        f"  ws connects={ws.get('connects')} disconnects={ws.get('disconnects')} "
        f"reconnects={ws.get('reconnects')}"
    )
    print("")
    print("Latency")
    for name in (
        "login",
        "hub_dashboard",
        "hub_tasks",
        "hub_task_projects",
        "hub_task_create",
        "hub_unread_counts",
        "hub_notifications_poll",
        "chat_conversations",
        "chat_thread_bootstrap",
        "chat_messages",
        "ws_connect",
        "ws_subscribe_inbox",
        "ws_subscribe_conversation",
        "ws_send_message",
        "ws_send_message_group",
        "ws_send_message_dm",
        "ws_delivery_event",
        "ws_delivery_event_group",
        "ws_delivery_event_dm",
        "ws_mark_read",
        "ws_ping",
        "http_mark_read",
        "chat_file_upload",
        "chat_file_preview",
        "chat_file_preview_pdf",
        "ws_reconnect_recovery",
    ):
        entry = timings.get(name) or {}
        if int(entry.get("count") or 0) == 0 and name in {
            "ws_send_message",
            "ws_send_message_group",
            "ws_send_message_dm",
            "ws_delivery_event",
            "ws_delivery_event_group",
            "ws_delivery_event_dm",
            "ws_mark_read",
            "http_mark_read",
            "hub_task_create",
            "hub_task_projects",
            "chat_file_upload",
            "chat_file_preview",
            "chat_file_preview_pdf",
            "ws_reconnect_recovery",
        }:
            continue
        print(
            f"  {name}: count={entry.get('count', 0)}"
            f" mean={human_ms(entry.get('mean_ms'))}"
            f" p50={human_ms(entry.get('p50_ms'))}"
            f" p95={human_ms(entry.get('p95_ms'))}"
            f" p99={human_ms(entry.get('p99_ms'))}"
            f" max={human_ms(entry.get('max_ms'))}"
        )
    delivery = report.get("delivery") or {}
    if report.get("enable_writes"):
        print(
            "  delivery"
            f" registered={delivery.get('registered', 0)}"
            f" observed={delivery.get('observed', 0)}"
            f" missing={delivery.get('missing', 0)}"
            f" cancelled={delivery.get('cancelled', 0)}"
            f" success_rate={float(delivery.get('success_rate', 0.0)) * 100.0:.2f}%"
        )
    if report.get("read_throttle_total"):
        print("")
        print(f"Read throttles (429/503): {report.get('read_throttle_total')}")
    if report.get("scenario_profile") == "stampede" and report.get("stampede_gates"):
        print("")
        print("Stampede objective")
        for key, value in (report.get("stampede_gates") or {}).items():
            if key == "pass":
                print(f"  pass={'PASS' if value else 'FAIL'}")
            else:
                print(f"  {key}={value}")
    if report.get("scenario_profile") == "reconnect" and report.get("reconnect_gates"):
        print("")
        print("Reconnect objective")
        for key, value in (report.get("reconnect_gates") or {}).items():
            if key == "pass":
                print(f"  pass={'PASS' if value else 'FAIL'}")
            else:
                print(f"  {key}={value}")
    print("")
    rss = report["rss"]
    if int(rss.get("samples") or 0) > 0:
        print(
            "RSS"
            f" min={rss.get('min_mb', 0):.1f} MB"
            f" max={rss.get('max_mb', 0):.1f} MB"
            f" growth={rss.get('growth_mb', 0):.1f} MB"
        )
    else:
        print("RSS  not collected")
    print("")
    print("SLO")
    for key, value in report["slos"].items():
        print(f"  {key}={'PASS' if value else 'FAIL'}")
    diagnosis = report.get("diagnosis") or {}
    if diagnosis:
        print("")
        print("Diagnosis (куда смотреть)")
        failed = diagnosis.get("failed_slos") or []
        print(f"  failed_slos={failed or ['none']}")
        print("  client bottlenecks:")
        for item in (diagnosis.get("client_bottlenecks") or [])[:5]:
            print(
                f"    - {item.get('stage')}: p95={item.get('p95_ms')}ms "
                f"mean={item.get('mean_ms')}ms count={item.get('count')}"
            )
        errors = diagnosis.get("error_by_stage") or []
        if errors:
            print("  errors by stage:")
            for item in errors[:8]:
                print(f"    - {item.get('stage')}: {item.get('count')}")
        hotspots = diagnosis.get("server_hotspots") or []
        if hotspots:
            print("  server hotspots:")
            for item in hotspots[:5]:
                print(
                    f"    - {item.get('severity')} {item.get('method')} {item.get('path')} "
                    f"p95={item.get('p95_ms')} reason={item.get('reason')}"
                )
        print("  likely causes:")
        for item in (diagnosis.get("likely_causes") or [])[:6]:
            print(f"    - {item}")
        print("  next:")
        for item in (diagnosis.get("where_to_look") or [])[:4]:
            print(f"    - {item}")
    if report["error_samples"]:
        print("")
        print("Error samples")
        for item in report["error_samples"]:
            print(f"  {item}")
    teardown = report.get("teardown") or {}
    if teardown.get("error_samples"):
        print("")
        print("Harness teardown samples (excluded from request SLO)")
        for item in teardown.get("error_samples") or []:
            print(f"  {item}")
    slow_samples = report.get("slow_samples") or []
    if slow_samples:
        print("")
        print(f"Slow samples (>= {report.get('slow_threshold_ms')} ms), first 10")
        for sample in slow_samples[:10]:
            print(
                f"  t+{sample.get('at_mono')}s {sample.get('stage')} "
                f"{sample.get('elapsed_ms')}ms user={sample.get('username')} "
                f"cid={sample.get('correlation_id')}"
            )


def save_report(report: dict[str, Any], path: str, *, diagnosis_md: str = "") -> None:
    if not str(path or "").strip():
        return
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved report to {target}")
    md_path_text = str(diagnosis_md or "").strip()
    if not md_path_text:
        md_path_text = str(target) + ".diagnosis.md"
    md_target = Path(md_path_text).expanduser().resolve()
    diagnosis = report.get("diagnosis") or build_diagnosis(report)
    md_target.parent.mkdir(parents=True, exist_ok=True)
    md_target.write_text(render_diagnosis_markdown(report, diagnosis), encoding="utf-8")
    print(f"Saved diagnosis to {md_target}")


def apply_scenario_profile(args: argparse.Namespace) -> argparse.Namespace:
    """Deterministic profiles for E_STEADY / STAMPEDE / RECONNECT / HOT_CONVERSATION."""
    profile = str(getattr(args, "scenario_profile", "") or "").strip().lower()
    if not profile:
        return args
    if profile == "steady":
        args.light_hub = True
        args.skip_hub = True
        args.once_reads = True
        args.enable_writes = True
        args.steady_state_gates = True
        args.force_reconnect_every_sec = 0.0
        if float(getattr(args, "warmup_sec", 0.0) or 0.0) <= 0:
            args.warmup_sec = 15.0
        if float(getattr(args, "cooldown_sec", 0.0) or 0.0) <= 0:
            args.cooldown_sec = 5.0
        if str(getattr(args, "write_targets", "") or "") in {"", "both"}:
            args.write_targets = "dm"
    elif profile == "stampede":
        args.light_hub = True
        args.skip_hub = True
        args.once_reads = False
        args.skip_conversations = False
        args.skip_bootstrap = False
        args.skip_messages = False
        args.enable_writes = True
        args.force_reconnect_every_sec = 0.0
        if float(getattr(args, "warmup_sec", 0.0) or 0.0) <= 0:
            args.warmup_sec = 10.0
        if float(getattr(args, "cooldown_sec", 0.0) or 0.0) <= 0:
            args.cooldown_sec = 5.0
    elif profile == "reconnect":
        args.light_hub = True
        args.skip_hub = True
        args.once_reads = True
        args.enable_writes = True
        if float(getattr(args, "force_reconnect_every_sec", 0.0) or 0.0) <= 0:
            args.force_reconnect_every_sec = 20.0
        if float(getattr(args, "warmup_sec", 0.0) or 0.0) <= 0:
            args.warmup_sec = 10.0
        if float(getattr(args, "cooldown_sec", 0.0) or 0.0) <= 0:
            args.cooldown_sec = 5.0
    elif profile == "hot_conversation":
        args.light_hub = True
        args.skip_hub = True
        args.once_reads = True
        args.enable_writes = True
        args.write_targets = "group"
        # hot_conversation_id must be supplied by caller / meta
    return args


async def async_main(args: argparse.Namespace) -> int:
    if websockets is None:
        raise SystemExit("Missing dependency: websockets (comes with uvicorn[standard])")

    credentials = load_credentials(args)
    ssl_context = build_ssl_context(bool(args.insecure))
    verify: ssl.SSLContext | bool = True if ssl_context is None else ssl_context
    stats = RunStats(slow_threshold_ms=float(args.slow_sample_ms or 1000.0))
    delivery_tracker = DeliveryTracker(stats)
    stop_event = asyncio.Event()
    warmup_sec = max(0.0, float(getattr(args, "warmup_sec", 0.0) or 0.0))
    cooldown_sec = max(0.0, float(getattr(args, "cooldown_sec", 0.0) or 0.0))
    measure_sec = max(1.0, float(args.duration_sec))
    total_sec = warmup_sec + measure_sec + cooldown_sec
    started = time.monotonic()
    measure_at = started + warmup_sec
    cooldown_at = measure_at + measure_sec
    stop_at = started + total_sec
    await stats.set_phase("warmup" if warmup_sec > 0 else "measurement")
    main_api_base = str(args.api_base).rstrip("/")
    chat_api_base = str(getattr(args, "chat_api_base", "") or "").strip().rstrip("/") or main_api_base
    metrics_bases = list(dict.fromkeys([main_api_base, chat_api_base]))

    if bool(args.capture_server_metrics):
        for metrics_base in metrics_bases:
            reset_payload = await fetch_json_url(
                system_metrics_url(metrics_base, reset=True),
                method="POST",
                verify=verify,
            )
            print(
                f"server metrics reset [{metrics_base}]: "
                + (
                    "ok"
                    if reset_payload
                    and reset_payload.get("ok") is not False
                    and reset_payload.get("status_code") is None
                    else str(reset_payload)
                )
            )

    rss_pid = int(args.rss_pid or 0)
    if rss_pid <= 0 and bool(args.auto_rss):
        detected = detect_listening_pid(api_port_from_base(chat_api_base, default=8002))
        if detected:
            rss_pid = int(detected)
            print(f"auto-rss: using backend pid={rss_pid}")
        else:
            print("auto-rss: backend pid not detected")

    rss_task = None
    if rss_pid > 0:
        rss_task = asyncio.create_task(
            rss_sampler(
                pid=rss_pid,
                stats=stats,
                stop_event=stop_event,
                sample_sec=float(args.rss_sample_sec),
            )
        )

    workers: list[asyncio.Task] = []
    for index in range(int(args.virtual_users)):
        credential = credentials[index % len(credentials)]
        workers.append(
            asyncio.create_task(
                vu_worker(
                    worker_id=index,
                    credential=credential,
                    args=args,
                    stats=stats,
                    delivery_tracker=delivery_tracker,
                    stop_at=stop_at,
                    ssl_context=ssl_context,
                )
            )
        )
        if args.stagger_ms > 0:
            await asyncio.sleep(float(args.stagger_ms) / 1000.0)

    progress_interval = max(5, int(args.progress_sec or 30))
    while any(not worker.done() for worker in workers):
        now = time.monotonic()
        if stats.phase == "warmup" and now >= measure_at:
            await stats.set_phase("measurement")
        if stats.phase == "measurement" and now >= cooldown_at and cooldown_sec > 0:
            await stats.set_phase("cooldown")
        remaining = stop_at - now
        if remaining <= 0:
            break
        await asyncio.sleep(min(progress_interval, max(1.0, remaining)))
        async with stats.lock:
            print(
                f"progress elapsed={time.monotonic() - stats.started_at:.0f}s"
                f" phase={stats.phase}"
                f" loops={stats.scenario_loops}"
                f" requests={stats.request_count}"
                f" errors={stats.error_count}"
                f" ws_connects={stats.ws_connects}"
                f" ws_reconnects={stats.ws_reconnects}"
                f" slow_samples={len(stats.slow_samples)}"
            )

    early_failures = await settle_worker_tasks(
        workers,
        stats,
        graceful_timeout_sec=worker_teardown_timeout_sec(args),
        cancel_timeout_sec=max(1.0, float(args.ws_close_timeout_sec or 3.0)),
    )
    if early_failures:
        print("")
        print("Worker exceptions")
        for item in early_failures[:30]:
            print(f"  {item}")
    await delivery_tracker.finalize()
    await stats.set_phase("teardown")
    stop_event.set()
    if rss_task is not None:
        try:
            await asyncio.wait_for(rss_task, timeout=2.0)
        except Exception:
            rss_task.cancel()

    stats.finished_at = time.monotonic()
    report = build_report(stats, args)

    server_metrics = None
    main_server_metrics = None
    chat_health = None
    if bool(args.capture_server_metrics):
        server_metrics = await fetch_json_url(
            system_metrics_url(chat_api_base) + "?limit=80&sort_by=p95_ms",
            verify=verify,
        )
        if main_api_base != chat_api_base:
            main_server_metrics = await fetch_json_url(
                system_metrics_url(main_api_base) + "?limit=80&sort_by=p95_ms",
                verify=verify,
            )
        report["server_metrics"] = server_metrics
        report["main_server_metrics"] = main_server_metrics
    # chat/health needs auth; reuse first VU credential quickly
    try:
        first = credentials[0]
        async with httpx.AsyncClient(
            base_url=main_api_base,
            verify=verify,
            headers={"X-Auth-Client": "mobile", "X-Forwarded-For": client_ip_for_worker(str(args.client_ip), 0)},
        ) as probe:
            login_payload, _login_ms = await request_json(
                probe,
                method="POST",
                url="/auth/login",
                timeout_sec=min(30.0, float(args.request_timeout_sec)),
                payload={"username": first.username, "password": first.password},
            )
            token = ""
            if isinstance(login_payload, dict):
                token = str(
                    login_payload.get("access_token")
                    or login_payload.get("token")
                    or ((login_payload.get("tokens") or {}) if isinstance(login_payload.get("tokens"), dict) else {}).get(
                        "access_token"
                    )
                    or ""
                ).strip()
            if token:
                health_payload = await fetch_json_url(
                    f"{chat_api_base}/chat/health",
                    timeout_sec=min(20.0, float(args.request_timeout_sec)),
                    verify=verify,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "X-Forwarded-For": client_ip_for_worker(str(args.client_ip), 0),
                    },
                )
                if isinstance(health_payload, dict):
                    chat_health = health_payload
                    chat_health.setdefault("ok", True)
    except Exception as exc:
        chat_health = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    report["chat_health"] = chat_health
    report["diagnosis"] = build_diagnosis(report, server_metrics=server_metrics, chat_health=chat_health)

    print_report(report)
    save_report(report, args.report_json, diagnosis_md=str(args.diagnosis_md or ""))
    return 0


def main() -> int:
    args = apply_scenario_profile(parse_args())
    apply_meta_file(args)
    return asyncio.run(async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
