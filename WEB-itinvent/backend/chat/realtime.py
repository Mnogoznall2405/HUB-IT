"""Realtime websocket transport helpers for chat."""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import os
import random
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Optional
from uuid import uuid4

from fastapi import WebSocket

from backend.chat.utils import normalize_text as _normalize_text
from backend.chat.postgres_realtime import (
    ChatRealtimePostgresBus,
    postgres_database_url_supported,
)
from backend.config import config

try:  # pragma: no cover - import availability depends on runtime package extras
    import redis
    from redis import asyncio as redis_asyncio
except Exception:  # pragma: no cover - runtime dependent
    redis = None
    redis_asyncio = None


logger = logging.getLogger("backend.chat.realtime")

_CHAT_REALTIME_CHANNEL = str(os.getenv("CHAT_REDIS_CHANNEL", "itinvent:chat:events") or "").strip() or "itinvent:chat:events"
_CHAT_REALTIME_NODE_ID = str(os.getenv("CHAT_REALTIME_NODE_ID", "") or "").strip() or str(uuid4())
_PRESENCE_HASH_PREFIX = str(os.getenv("CHAT_PRESENCE_PREFIX", "itinvent:chat:presence:user") or "").strip() or "itinvent:chat:presence:user"
_PRESENCE_TTL_SEC = max(10, int(str(os.getenv("CHAT_PRESENCE_TTL_SEC", "75") or "75").strip() or "75"))
_PRESENCE_MAX_WATCH_USERS = max(1, int(str(os.getenv("CHAT_PRESENCE_WATCH_LIMIT", "50") or "50").strip() or "50"))
_OUTBOUND_QUEUE_SIZE = max(32, int(str(os.getenv("CHAT_WS_OUTBOUND_QUEUE_SIZE", "256") or "256").strip() or "256"))
_OUTBOUND_SEND_TIMEOUT_SEC = max(
    0.5,
    float(str(os.getenv("CHAT_WS_SEND_TIMEOUT_SEC", "5") or "5").strip() or "5"),
)
_CHAT_WS_MAX_CONNECTIONS_PER_USER = max(1, int(str(os.getenv("CHAT_WS_MAX_CONNECTIONS_PER_USER", "4") or "4").strip() or "4"))
_TYPING_STARTED_THROTTLE_SEC = max(1.0, float(str(os.getenv("CHAT_TYPING_STARTED_THROTTLE_SEC", "2") or "2").strip() or "2"))
_TYPING_STATE_TTL_SEC = max(2.0, float(str(os.getenv("CHAT_TYPING_STATE_TTL_SEC", "5") or "5").strip() or "5"))
_PRESENCE_TOUCH_THROTTLE_SEC = max(1.0, float(str(os.getenv("CHAT_PRESENCE_TOUCH_THROTTLE_SEC", "15") or "15").strip() or "15"))
_CHAT_WS_COMMANDS_PER_SEC = max(1, int(str(os.getenv("CHAT_WS_COMMANDS_PER_SEC", "20") or "20").strip() or "20"))
_CHAT_WS_COMMAND_BURST = max(1, int(str(os.getenv("CHAT_WS_COMMAND_BURST", "40") or "40").strip() or "40"))
_CHAT_WS_EVENT_COALESCE = str(os.getenv("CHAT_WS_EVENT_COALESCE", "1") or "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_CHAT_WS_DURABLE_DEDUPE_SIZE = max(
    32,
    min(
        4096,
        int(str(os.getenv("CHAT_WS_DURABLE_DEDUPE_SIZE", "512") or "512").strip() or "512"),
    ),
)
CHAT_WS_RATE_LIMIT_RETRY_AFTER_MS = 1000

# Rolling sender metrics (process-wide).
_SENDER_METRIC_SAMPLES = 256


class ChatWsCommandRateLimiter:
    def __init__(self, *, rate_per_sec: int, burst: int) -> None:
        self.rate_per_sec = max(1.0, float(rate_per_sec))
        self.capacity = max(1.0, float(burst))
        self.tokens = self.capacity
        self.updated_at = time.monotonic()
        self.violations = 0

    def allow(self) -> tuple[bool, int]:
        now = time.monotonic()
        elapsed = max(0.0, now - self.updated_at)
        self.updated_at = now
        self.tokens = min(self.capacity, self.tokens + (elapsed * self.rate_per_sec))
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True, 0
        self.violations += 1
        missing = max(0.0, 1.0 - self.tokens)
        retry_after_ms = max(
            CHAT_WS_RATE_LIMIT_RETRY_AFTER_MS,
            int((missing / self.rate_per_sec) * 1000.0),
        )
        return False, retry_after_ms


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _presence_hash_key(user_id: int) -> str:
    return f"{_PRESENCE_HASH_PREFIX}:{int(user_id)}"


def _ts_now() -> float:
    return time.time()


@dataclass
class ChatRealtimeConnection:
    id: str
    user_id: int
    websocket: WebSocket
    receive_user_events: bool = True
    track_presence: bool = True
    inbox_subscribed: bool = False
    conversation_ids: set[str] = field(default_factory=set)
    presence_watch_user_ids: set[int] = field(default_factory=set)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    queue_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    outbound_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=_OUTBOUND_QUEUE_SIZE))
    pending_volatile_keys: set[str] = field(default_factory=set)
    # Latest payload for coalesced keys (replace-in-place; sender reads at dequeue).
    coalesce_latest: dict[str, str | dict] = field(default_factory=dict)
    sender_task: asyncio.Task | None = None
    last_presence_touch_at: float = 0.0
    queue_full_count: int = 0
    send_timeout_count: int = 0
    coalesced_events: int = 0
    recent_durable_event_keys: OrderedDict[str, None] = field(default_factory=OrderedDict)
    durable_duplicates_suppressed: int = 0


class ChatRealtimeLocalBus:
    """Explicit single-node transport used when no shared relay is selected."""

    transport = "local"

    def __init__(self, *, node_id: str) -> None:
        self.node_id = str(node_id)

    @property
    def configured(self) -> bool:
        return True

    @property
    def available(self) -> bool:
        return True

    @property
    def subscriber_ready(self) -> bool:
        return True

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def publish(self, _payload: dict) -> bool:
        return False


class ChatRealtimeRedisBus:
    transport = "redis"

    def __init__(self, manager: "ChatRealtimeManager") -> None:
        self._manager = manager
        self._listener_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._reconnect_event: asyncio.Event | None = None
        self._pub_client = None
        self._sub_client = None
        self._pubsub = None
        self._sync_client = None
        self._redis_available = False
        self._pubsub_subscribed = False
        self._reconnect_base_sec = max(
            0.01,
            float(str(os.getenv("CHAT_REDIS_RECONNECT_BASE_SEC", "0.5") or "0.5").strip() or "0.5"),
        )
        self._reconnect_max_sec = max(
            self._reconnect_base_sec,
            float(str(os.getenv("CHAT_REDIS_RECONNECT_MAX_SEC", "30") or "30").strip() or "30"),
        )
        self._reconnect_jitter_ratio = min(
            1.0,
            max(
                0.0,
                float(str(os.getenv("CHAT_REDIS_RECONNECT_JITTER_RATIO", "0.5") or "0.5").strip() or "0.5"),
            ),
        )

    @property
    def node_id(self) -> str:
        return _CHAT_REALTIME_NODE_ID

    @property
    def configured(self) -> bool:
        return bool(str(config.redis.url or "").strip())

    @property
    def redis_available(self) -> bool:
        return bool(self._redis_available)

    @property
    def available(self) -> bool:
        return self.redis_available

    @property
    def pubsub_subscribed(self) -> bool:
        return bool(self._pubsub_subscribed)

    @property
    def subscriber_ready(self) -> bool:
        return self.pubsub_subscribed

    async def start(self) -> None:
        if self._listener_task and not self._listener_task.done():
            return
        redis_url = str(config.redis.url or "").strip()
        if not redis_url or redis_asyncio is None:
            self._mark_unavailable()
            await self._close_async_clients()
            return
        self._stop_event = asyncio.Event()
        self._reconnect_event = asyncio.Event()
        self._mark_unavailable()
        self._listener_task = asyncio.create_task(self._run_listener(), name="chat-redis-pubsub")

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._reconnect_event is not None:
            self._reconnect_event.set()
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        self._listener_task = None
        self._mark_unavailable()
        await self._close_async_clients()
        self._stop_event = None
        self._reconnect_event = None

    async def publish(self, payload: dict) -> bool:
        if not self.redis_available or self._pub_client is None:
            return False
        try:
            await self._pub_client.publish(_CHAT_REALTIME_CHANNEL, json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            self._mark_unavailable(request_reconnect=True)
            logger.exception("chat.realtime.redis publish failed")
            return False

    async def _run_listener(self) -> None:
        reconnect_attempt = 0
        try:
            while not self._is_stopping():
                try:
                    await self._connect_async_clients()
                    reconnect_attempt = 0
                    while not self._is_stopping():
                        if self._reconnect_event is not None and self._reconnect_event.is_set():
                            self._reconnect_event.clear()
                            raise ConnectionError("Redis reconnect requested")
                        if self._pubsub is None:
                            raise ConnectionError("Redis pub/sub is not initialized")
                        message = await self._pubsub.get_message(
                            ignore_subscribe_messages=True,
                            timeout=1.0,
                        )
                        if message is None:
                            continue
                        raw_data = message.get("data")
                        if not raw_data:
                            continue
                        try:
                            payload = json.loads(str(raw_data))
                            if _normalize_text(payload.get("origin_node_id")) != self.node_id:
                                await self._manager.handle_distributed_event(payload)
                        except Exception:
                            # A malformed/event-handler payload does not mean Redis itself is down.
                            logger.exception("chat.realtime.redis event handling failed")
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self._mark_unavailable()
                    await self._close_async_clients()
                    if self._is_stopping():
                        return
                    logger.warning(
                        "chat.realtime.redis listener unavailable; reconnecting: %s",
                        exc,
                    )
                    await self._wait_before_reconnect(reconnect_attempt)
                    reconnect_attempt += 1
        finally:
            self._mark_unavailable()
            await self._close_async_clients()

    def _mark_unavailable(self, *, request_reconnect: bool = False) -> None:
        self._redis_available = False
        self._pubsub_subscribed = False
        if request_reconnect and self._reconnect_event is not None:
            self._reconnect_event.set()

    def _is_stopping(self) -> bool:
        return bool(self._stop_event is not None and self._stop_event.is_set())

    async def _connect_async_clients(self) -> None:
        redis_url = str(config.redis.url or "").strip()
        if not redis_url or redis_asyncio is None:
            raise RuntimeError("Redis realtime is not configured")
        await self._close_async_clients()
        password = str(config.redis.password or "").strip() or None
        pub_client = redis_asyncio.Redis.from_url(
            redis_url,
            password=password,
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        sub_client = redis_asyncio.Redis.from_url(
            redis_url,
            password=password,
            decode_responses=True,
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        pubsub = None
        try:
            await pub_client.ping()
            await sub_client.ping()
            pubsub = sub_client.pubsub(ignore_subscribe_messages=True)
            await pubsub.subscribe(_CHAT_REALTIME_CHANNEL)
        except BaseException:
            await self._close_async_resource(pubsub)
            await self._close_async_resource(pub_client)
            await self._close_async_resource(sub_client)
            raise
        self._pub_client = pub_client
        self._sub_client = sub_client
        self._pubsub = pubsub
        if self._reconnect_event is not None:
            self._reconnect_event.clear()
        self._redis_available = True
        self._pubsub_subscribed = True

    async def _close_async_clients(self) -> None:
        pubsub, pub_client, sub_client = self._pubsub, self._pub_client, self._sub_client
        self._pubsub = None
        self._pub_client = None
        self._sub_client = None
        await self._close_async_resource(pubsub)
        await self._close_async_resource(pub_client)
        await self._close_async_resource(sub_client)

    @staticmethod
    async def _close_async_resource(resource) -> None:
        if resource is None:
            return
        try:
            close_method = getattr(resource, "aclose", None) or getattr(resource, "close", None)
            if close_method is not None:
                result = close_method()
                if inspect.isawaitable(result):
                    await result
        except Exception:
            pass

    async def _wait_before_reconnect(self, attempt: int) -> None:
        delay = self._reconnect_delay(attempt)
        if self._stop_event is None:
            return
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass

    def _reconnect_delay(self, attempt: int) -> float:
        exponent = min(max(0, int(attempt)), 16)
        base_delay = min(self._reconnect_max_sec, self._reconnect_base_sec * (2**exponent))
        jitter = random.uniform(0.0, base_delay * self._reconnect_jitter_ratio)
        return min(self._reconnect_max_sec, base_delay + jitter)

    def _get_sync_client(self):
        if self._sync_client is not None:
            return self._sync_client
        redis_url = str(config.redis.url or "").strip()
        if not redis_url or redis is None:
            return None
        try:
            self._sync_client = redis.Redis.from_url(
                redis_url,
                password=(str(config.redis.password or "").strip() or None),
                decode_responses=True,
                socket_timeout=2,
                socket_connect_timeout=2,
            )
            self._sync_client.ping()
            return self._sync_client
        except Exception:
            self._sync_client = None
            return None

    def record_presence_sync(self, *, user_id: int, connection_id: str) -> None:
        client = self._get_sync_client()
        if client is None:
            return
        key = _presence_hash_key(int(user_id))
        now_ts = f"{_ts_now():.6f}"
        try:
            client.hset(key, str(connection_id), now_ts)
            client.expire(key, _PRESENCE_TTL_SEC * 2)
        except Exception:
            logger.exception("chat.realtime.redis record_presence failed")

    def clear_presence_sync(self, *, user_id: int, connection_id: str) -> None:
        client = self._get_sync_client()
        if client is None:
            return
        key = _presence_hash_key(int(user_id))
        try:
            client.hdel(key, str(connection_id))
            if int(client.hlen(key) or 0) <= 0:
                client.delete(key)
        except Exception:
            logger.exception("chat.realtime.redis clear_presence failed")

    def load_presence_snapshot(self, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, datetime]:
        client = self._get_sync_client()
        normalized_user_ids = sorted({int(item) for item in list(user_ids or []) if int(item) > 0})
        if client is None or not normalized_user_ids:
            return {}
        pipeline = client.pipeline()
        for user_id in normalized_user_ids:
            pipeline.hgetall(_presence_hash_key(user_id))
        raw_rows = pipeline.execute()
        now_ts = _ts_now()
        cutoff = now_ts - float(_PRESENCE_TTL_SEC)
        result: dict[int, datetime] = {}
        for user_id, payload in zip(normalized_user_ids, raw_rows):
            if not isinstance(payload, dict):
                continue
            stale_fields: list[str] = []
            newest_ts = 0.0
            for connection_id, raw_ts in payload.items():
                try:
                    parsed_ts = float(raw_ts)
                except Exception:
                    stale_fields.append(str(connection_id))
                    continue
                if parsed_ts < cutoff:
                    stale_fields.append(str(connection_id))
                    continue
                newest_ts = max(newest_ts, parsed_ts)
            if stale_fields:
                try:
                    client.hdel(_presence_hash_key(user_id), *stale_fields)
                except Exception:
                    pass
            if newest_ts > 0:
                result[int(user_id)] = datetime.fromtimestamp(newest_ts, tz=timezone.utc)
        return result


def _chat_postgres_database_url() -> str:
    return str(config.chat.database_url or config.app_db.database_url or "").strip()


def resolve_chat_realtime_transport(requested: str | None = None) -> str:
    """Resolve local/redis/postgres/auto without silently accepting typos."""
    normalized = _normalize_text(
        requested if requested is not None else os.getenv("CHAT_REALTIME_TRANSPORT", "auto"),
        "auto",
    ).lower()
    if normalized not in {"auto", "local", "redis", "postgres"}:
        raise ValueError(
            "CHAT_REALTIME_TRANSPORT must be one of: auto, local, redis, postgres"
        )
    if normalized != "auto":
        return normalized
    if bool(str(config.redis.url or "").strip()) and redis_asyncio is not None:
        return "redis"
    if postgres_database_url_supported(_chat_postgres_database_url()):
        return "postgres"
    return "local"


class ChatRealtimeManager:
    def __init__(self) -> None:
        self._lock = RLock()
        self._connections: dict[str, ChatRealtimeConnection] = {}
        self._user_connection_ids: dict[int, set[str]] = {}
        self._last_seen_by_user_id: dict[int, datetime] = {}
        self._slow_consumer_disconnects = 0
        self._ws_rate_limited_count = 0
        self._ws_rate_limited_connection_ids: set[str] = set()
        self._typing_started_sent_at: dict[tuple[int, str], float] = {}
        self._ws_rate_limiters_by_user: dict[int, ChatWsCommandRateLimiter] = {}
        self._redis_bus = ChatRealtimeRedisBus(self)
        self._realtime_transport = resolve_chat_realtime_transport()
        if self._realtime_transport == "redis":
            self._transport_bus = self._redis_bus
        elif self._realtime_transport == "postgres":
            self._transport_bus = ChatRealtimePostgresBus(
                self,
                database_url=_chat_postgres_database_url(),
                node_id=_CHAT_REALTIME_NODE_ID,
            )
        else:
            self._transport_bus = ChatRealtimeLocalBus(node_id=_CHAT_REALTIME_NODE_ID)
        self._distributed_event_ids: OrderedDict[str, None] = OrderedDict()
        self._distributed_event_dedupe_size = max(
            256,
            int(str(os.getenv("CHAT_REALTIME_DEDUPE_SIZE", "8192") or "8192").strip() or "8192"),
        )
        self._queue_full_count = 0
        self._send_timeout_count = 0
        self._coalesced_events = 0
        self._durable_duplicates_suppressed = 0
        self._queue_wait_ms_samples: list[float] = []
        self._socket_send_ms_samples: list[float] = []
        self._payload_bytes_samples: list[float] = []
        self._outbound_queue_samples: list[float] = []

    def _record_sender_sample(
        self,
        *,
        queue_wait_ms: float | None = None,
        socket_send_ms: float | None = None,
        payload_bytes: int | None = None,
        outbound_queue_size: int | None = None,
    ) -> None:
        def _push(bucket: list[float], value: float) -> None:
            bucket.append(float(value))
            if len(bucket) > _SENDER_METRIC_SAMPLES:
                del bucket[: len(bucket) - _SENDER_METRIC_SAMPLES]

        with self._lock:
            if queue_wait_ms is not None:
                _push(self._queue_wait_ms_samples, queue_wait_ms)
            if socket_send_ms is not None:
                _push(self._socket_send_ms_samples, socket_send_ms)
            if payload_bytes is not None:
                _push(self._payload_bytes_samples, float(payload_bytes))
            if outbound_queue_size is not None:
                _push(self._outbound_queue_samples, float(outbound_queue_size))

    @staticmethod
    def _pct(samples: list[float], p: float) -> float:
        if not samples:
            return 0.0
        ordered = sorted(samples)
        if len(ordered) == 1:
            return float(ordered[0])
        rank = (len(ordered) - 1) * (p / 100.0)
        low = int(rank)
        high = min(low + 1, len(ordered) - 1)
        frac = rank - low
        return float(ordered[low] * (1.0 - frac) + ordered[high] * frac)

    @property
    def node_id(self) -> str:
        return _CHAT_REALTIME_NODE_ID

    async def start(self) -> None:
        await self._transport_bus.start()

    async def stop(self) -> None:
        await self._transport_bus.stop()

    @staticmethod
    def build_envelope(
        *,
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> dict:
        envelope = {
            "type": str(event_type or "").strip(),
            "payload": payload or {},
            "sent_at": _iso(_utc_now()),
        }
        normalized_conversation_id = str(conversation_id or "").strip()
        normalized_request_id = str(request_id or "").strip()
        if normalized_conversation_id:
            envelope["conversation_id"] = normalized_conversation_id
        if normalized_request_id:
            envelope["request_id"] = normalized_request_id
        return envelope

    async def connect(
        self,
        websocket: WebSocket,
        *,
        user_id: int,
        receive_user_events: bool = True,
        track_presence: bool = True,
    ) -> tuple[str, bool]:
        await websocket.accept()
        connection_id = str(uuid4())
        normalized_user_id = int(user_id)
        stale_connection_ids: list[str] = []
        with self._lock:
            if receive_user_events:
                existing = self._user_connection_ids.setdefault(normalized_user_id, set())
            else:
                existing = {
                    item.id
                    for item in self._connections.values()
                    if int(item.user_id) == normalized_user_id
                    and not bool(item.receive_user_events)
                }
            if len(existing) >= _CHAT_WS_MAX_CONNECTIONS_PER_USER:
                overflow = len(existing) - _CHAT_WS_MAX_CONNECTIONS_PER_USER + 1
                stale_connection_ids = list(existing)[:overflow]
        for stale_connection_id in stale_connection_ids:
            await self._evict_connection(stale_connection_id, reason="connection limit exceeded")
        connection = ChatRealtimeConnection(
            id=connection_id,
            user_id=normalized_user_id,
            websocket=websocket,
            receive_user_events=bool(receive_user_events),
            track_presence=bool(track_presence),
            last_presence_touch_at=_ts_now(),
        )
        connection.sender_task = asyncio.create_task(
            self._run_connection_sender(connection),
            name=f"chat-ws-sender:{connection_id}",
        )
        with self._lock:
            self._connections[connection_id] = connection
            if receive_user_events:
                existing = self._user_connection_ids.setdefault(normalized_user_id, set())
                first_connection = len(existing) == 0
                existing.add(connection_id)
            else:
                first_connection = not any(
                    item.id != connection_id
                    and int(item.user_id) == normalized_user_id
                    and not bool(item.receive_user_events)
                    for item in self._connections.values()
                )
        if track_presence:
            self._schedule_presence_record(
                user_id=normalized_user_id,
                connection_id=connection_id,
                reason="connect",
            )
        return connection_id, first_connection

    async def _evict_connection(self, connection_id: str, *, reason: str = "connection replaced") -> None:
        await self.disconnect_connection(
            connection_id,
            close_code=4000,
            close_reason=reason,
        )

    def is_connection_registered(self, connection_id: str) -> bool:
        normalized_connection_id = str(connection_id or "").strip()
        if not normalized_connection_id:
            return False
        with self._lock:
            return normalized_connection_id in self._connections

    def allow_ws_command(self, user_id: int) -> tuple[bool, int, ChatWsCommandRateLimiter]:
        normalized_user_id = int(user_id)
        with self._lock:
            limiter = self._ws_rate_limiters_by_user.get(normalized_user_id)
            if limiter is None:
                limiter = ChatWsCommandRateLimiter(
                    rate_per_sec=_CHAT_WS_COMMANDS_PER_SEC,
                    burst=_CHAT_WS_COMMAND_BURST,
                )
                self._ws_rate_limiters_by_user[normalized_user_id] = limiter
        allowed, retry_after_ms = limiter.allow()
        return allowed, retry_after_ms, limiter

    async def disconnect_connection(
        self,
        connection_id: str,
        *,
        close_code: int = 1000,
        close_reason: str = "",
    ) -> dict:
        normalized_connection_id = str(connection_id or "").strip()
        websocket_to_close = None
        with self._lock:
            connection = self._connections.get(normalized_connection_id)
            if connection is not None:
                websocket_to_close = connection.websocket
        if websocket_to_close is not None:
            try:
                await websocket_to_close.close(
                    code=int(close_code),
                    reason=str(close_reason or "")[:120],
                )
            except Exception:
                pass
        return self.disconnect(normalized_connection_id)

    def disconnect(self, connection_id: str) -> dict:
        normalized_connection_id = str(connection_id or "").strip()
        if not normalized_connection_id:
            return {"user_id": 0, "last_connection": False}
        with self._lock:
            connection = self._connections.pop(normalized_connection_id, None)
            if connection is None:
                return {"user_id": 0, "last_connection": False}
            stale_typing_keys = [
                key
                for key in self._typing_started_sent_at.keys()
                if int(key[0]) == int(connection.user_id)
            ]
            for stale_key in stale_typing_keys:
                self._typing_started_sent_at.pop(stale_key, None)
            if connection.receive_user_events:
                user_ids = self._user_connection_ids.get(int(connection.user_id), set())
                user_ids.discard(normalized_connection_id)
                last_connection = len(user_ids) == 0
                if last_connection:
                    self._user_connection_ids.pop(int(connection.user_id), None)
            else:
                last_connection = False
            if connection.track_presence:
                self._last_seen_by_user_id[int(connection.user_id)] = _utc_now()
            if not any(
                int(item.user_id) == int(connection.user_id)
                for item in self._connections.values()
            ):
                self._ws_rate_limiters_by_user.pop(int(connection.user_id), None)
        if connection.sender_task is not None:
            connection.sender_task.cancel()
        if connection.track_presence:
            self._schedule_presence_clear(
                user_id=int(connection.user_id),
                connection_id=normalized_connection_id,
            )
        return {
            "user_id": int(connection.user_id),
            "last_connection": last_connection,
        }

    def note_user_activity(self, user_id: int, *, at: Optional[datetime] = None) -> None:
        """Record that the user was active (send/typing). last_seen must not lag behind messages."""
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return
        stamp = at if isinstance(at, datetime) else _utc_now()
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        with self._lock:
            previous = self._last_seen_by_user_id.get(normalized_user_id)
            if previous is None or stamp >= previous:
                self._last_seen_by_user_id[normalized_user_id] = stamp

    def touch_presence(self, connection_id: str) -> bool:
        now_ts = _ts_now()
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None and (now_ts - float(connection.last_presence_touch_at or 0.0)) < _PRESENCE_TOUCH_THROTTLE_SEC:
                return False
            if connection is not None:
                connection.last_presence_touch_at = now_ts
                # Keep in-memory last_seen fresh while connected (not only on disconnect).
                self._last_seen_by_user_id[int(connection.user_id)] = _utc_now()
        if connection is None:
            return False
        self._schedule_presence_record(
            user_id=int(connection.user_id),
            connection_id=connection.id,
            reason="touch",
        )
        return True

    def allow_typing_started(self, *, user_id: int, conversation_id: str) -> bool:
        normalized_conversation_id = _normalize_text(conversation_id)
        if int(user_id or 0) <= 0 or not normalized_conversation_id:
            return False
        now_ts = _ts_now()
        key = (int(user_id), normalized_conversation_id)
        with self._lock:
            cutoff = now_ts - (_TYPING_STATE_TTL_SEC * 2)
            stale_keys = [
                item_key
                for item_key, last_sent_at in self._typing_started_sent_at.items()
                if float(last_sent_at) < cutoff
            ]
            for stale_key in stale_keys:
                self._typing_started_sent_at.pop(stale_key, None)
            last_sent_at = float(self._typing_started_sent_at.get(key, 0.0) or 0.0)
            if now_ts - last_sent_at < _TYPING_STARTED_THROTTLE_SEC:
                return False
            self._typing_started_sent_at[key] = now_ts
        return True

    def clear_typing_state(self, *, user_id: int, conversation_id: str) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        if int(user_id or 0) <= 0 or not normalized_conversation_id:
            return
        with self._lock:
            self._typing_started_sent_at.pop((int(user_id), normalized_conversation_id), None)

    def subscribe_inbox(self, connection_id: str) -> None:
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None:
                connection.inbox_subscribed = True

    def unsubscribe_inbox(self, connection_id: str) -> None:
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None:
                connection.inbox_subscribed = False

    def subscribe_conversation(self, connection_id: str, conversation_id: str) -> None:
        normalized_conversation_id = str(conversation_id or "").strip()
        if not normalized_conversation_id:
            return
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None:
                connection.conversation_ids.add(normalized_conversation_id)

    def unsubscribe_conversation(self, connection_id: str, conversation_id: str) -> None:
        normalized_conversation_id = str(conversation_id or "").strip()
        if not normalized_conversation_id:
            return
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None:
                connection.conversation_ids.discard(normalized_conversation_id)

    def watch_presence(self, connection_id: str, user_ids: list[int] | set[int] | tuple[int, ...]) -> list[int]:
        normalized_ids = sorted({
            int(item)
            for item in list(user_ids or [])
            if int(item) > 0
        })[:_PRESENCE_MAX_WATCH_USERS]
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is None:
                return []
            connection.presence_watch_user_ids = set(normalized_ids)
        return normalized_ids

    def snapshot_connected_user_ids(self) -> set[int]:
        with self._lock:
            return {int(user_id) for user_id in self._user_connection_ids.keys()}

    def conversation_room_user_ids(self, *, conversation_id: str) -> set[int]:
        normalized_conversation_id = str(conversation_id or "").strip()
        if not normalized_conversation_id:
            return set()
        with self._lock:
            return {
                int(connection.user_id)
                for connection in self._connections.values()
                if normalized_conversation_id in connection.conversation_ids
                and int(connection.user_id) > 0
            }

    def get_last_seen(self, user_id: int) -> Optional[datetime]:
        with self._lock:
            return self._last_seen_by_user_id.get(int(user_id))

    def get_presence_snapshot(self, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, datetime]:
        normalized_user_ids = {int(item) for item in list(user_ids or []) if int(item) > 0}
        if self._realtime_transport == "postgres":
            snapshot: dict[int, datetime] = self._transport_bus.load_presence_snapshot(normalized_user_ids)
        elif self._realtime_transport == "redis":
            snapshot = self._redis_bus.load_presence_snapshot(normalized_user_ids)
        else:
            snapshot = {}
        with self._lock:
            for connection in self._connections.values():
                if not connection.track_presence:
                    continue
                if normalized_user_ids and int(connection.user_id) not in normalized_user_ids:
                    continue
                snapshot[int(connection.user_id)] = _utc_now()
        return snapshot

    def _schedule_presence_record(self, *, user_id: int, connection_id: str, reason: str) -> None:
        if self._realtime_transport == "redis":
            coroutine = asyncio.to_thread(
                self._redis_bus.record_presence_sync,
                user_id=int(user_id),
                connection_id=str(connection_id),
            )
        elif self._realtime_transport == "postgres" and getattr(self._transport_bus, "started", False):
            coroutine = self._transport_bus.record_presence(
                user_id=int(user_id),
                connection_id=str(connection_id),
            )
        else:
            return
        asyncio.create_task(
            coroutine,
            name=f"chat-presence-{reason}:{connection_id}",
        )

    def _schedule_presence_clear(self, *, user_id: int, connection_id: str) -> None:
        if self._realtime_transport == "redis":
            coroutine = asyncio.to_thread(
                self._redis_bus.clear_presence_sync,
                user_id=int(user_id),
                connection_id=str(connection_id),
            )
        elif self._realtime_transport == "postgres" and getattr(self._transport_bus, "started", False):
            coroutine = self._transport_bus.clear_presence(
                user_id=int(user_id),
                connection_id=str(connection_id),
            )
        else:
            return
        asyncio.create_task(
            coroutine,
            name=f"chat-presence-disconnect:{connection_id}",
        )

    async def send_to_connection(
        self,
        connection_id: str,
        *,
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        normalized_connection_id = str(connection_id or "").strip()
        if not normalized_connection_id:
            return
        with self._lock:
            connection = self._connections.get(normalized_connection_id)
        if connection is None:
            return
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
        )
        durable = not self._is_volatile_event(event_type)
        volatile_key = self._volatile_event_key(
            event_type=event_type,
            conversation_id=conversation_id,
            payload=payload,
        )
        if not await self._enqueue_envelope(connection, envelope, durable=durable, volatile_key=volatile_key):
            self._slow_consumer_disconnects += 1
            await self.disconnect_connection(
                normalized_connection_id,
                close_code=1008,
                close_reason="slow consumer",
            )

    async def send_command_ok(
        self,
        connection_id: str,
        *,
        request_id: Optional[str] = None,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
    ) -> None:
        # Bypass outbound_queue: under chat storms command.ok must not wait behind
        # dozens of message.created frames or send ACK becomes multi-second.
        await self._send_control_to_connection(
            connection_id,
            event_type="chat.command.ok",
            payload=payload or {},
            conversation_id=conversation_id,
            request_id=request_id,
        )

    async def send_error(
        self,
        connection_id: str,
        *,
        detail: str,
        code: str = "bad_request",
        request_id: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> None:
        await self._send_control_to_connection(
            connection_id,
            event_type="chat.error",
            payload={
                "detail": str(detail or "").strip() or "Chat websocket error",
                "code": str(code or "bad_request").strip() or "bad_request",
            },
            conversation_id=conversation_id,
            request_id=request_id,
        )

    async def _send_control_to_connection(
        self,
        connection_id: str,
        *,
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
    ) -> None:
        normalized_connection_id = str(connection_id or "").strip()
        if not normalized_connection_id:
            return
        with self._lock:
            connection = self._connections.get(normalized_connection_id)
        if connection is None:
            return
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
        )
        try:
            async with connection.send_lock:
                await asyncio.wait_for(
                    connection.websocket.send_json(envelope),
                    timeout=_OUTBOUND_SEND_TIMEOUT_SEC,
                )
        except Exception:
            self._slow_consumer_disconnects += 1
            await self.disconnect_connection(
                normalized_connection_id,
                close_code=1011,
                close_reason="control send failed",
            )

    async def publish_inbox_event(
        self,
        *,
        user_id: int,
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> None:
        await self.publish_inbox_events(
            user_ids=[int(user_id)],
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )

    async def publish_inbox_events(
        self,
        *,
        user_ids: list[int],
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> int:
        """One local fan-out + one Redis publish for many inbox subscribers."""
        target_user_ids = [int(item) for item in list(user_ids or []) if int(item) > 0]
        if not target_user_ids:
            return 0
        await self._publish_targeted_event(
            distribution="inbox",
            target_user_ids=target_user_ids,
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )
        return len(set(target_user_ids))

    async def publish_user_event(
        self,
        *,
        user_id: int,
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> None:
        await self.publish_user_events(
            user_ids=[int(user_id)],
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )

    async def publish_user_events(
        self,
        *,
        user_ids: list[int],
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> int:
        """Fan out once to every Chat socket owned by the target users."""
        target_user_ids = [int(item) for item in list(user_ids or []) if int(item) > 0]
        if not target_user_ids:
            return 0
        await self._publish_targeted_event(
            distribution="user",
            target_user_ids=target_user_ids,
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )
        return len(set(target_user_ids))

    async def publish_conversation_event(
        self,
        *,
        user_id: int,
        conversation_id: str,
        event_type: str,
        payload: Optional[dict] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> None:
        await self._publish_targeted_event(
            distribution="conversation",
            target_user_ids=[int(user_id)],
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )

    async def publish_conversation_room_event(
        self,
        *,
        conversation_id: str,
        event_type: str,
        payload: Optional[dict] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
        exclude_user_id: int = 0,
        exclude_connection_id: str = "",
    ) -> int:
        """Broadcast one event to every local connection subscribed to the conversation."""
        normalized_conversation_id = str(conversation_id or "").strip()
        if not normalized_conversation_id:
            return 0
        excluded_user_id = int(exclude_user_id or 0)
        excluded_connection_id = str(exclude_connection_id or "").strip()
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            conversation_id=normalized_conversation_id,
            request_id=request_id,
        )
        durable = not self._is_volatile_event(event_type)
        volatile_key = self._volatile_event_key(
            event_type=event_type,
            conversation_id=normalized_conversation_id,
            payload=payload,
        )
        with self._lock:
            target_connections = [
                connection
                for connection in self._connections.values()
                if normalized_conversation_id in connection.conversation_ids
                and (excluded_user_id <= 0 or int(connection.user_id) != excluded_user_id)
                and (not excluded_connection_id or connection.id != excluded_connection_id)
            ]
        await self._broadcast_local(
            target_connections=target_connections,
            envelope=envelope,
            durable=durable,
            volatile_key=volatile_key,
        )
        if distribute and self._distribution_publish_enabled():
            # Local peers must not wait on shared-transport RTT.
            self._schedule_transport_publish(
                {
                    "origin_node_id": self.node_id,
                    "distribution": "conversation_room",
                    "target_user_ids": [],
                    "watched_user_id": 0,
                    "exclude_user_id": excluded_user_id,
                    "exclude_connection_id": excluded_connection_id,
                    "event_type": str(event_type or "").strip(),
                    "payload": payload or {},
                    "conversation_id": normalized_conversation_id,
                    "request_id": request_id,
                },
                durable=durable,
            )
        return len(target_connections)

    async def publish_presence_event(
        self,
        *,
        user_id: int,
        payload: Optional[dict] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> None:
        await self._publish_targeted_event(
            distribution="presence_watch",
            target_user_ids=[],
            event_type="chat.presence.updated",
            payload=payload,
            request_id=request_id,
            watched_user_id=int(user_id),
            distribute=distribute,
        )

    async def publish_global_event(
        self,
        *,
        event_type: str,
        payload: Optional[dict] = None,
        request_id: Optional[str] = None,
        distribute: bool = True,
    ) -> None:
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            request_id=request_id,
        )
        with self._lock:
            target_connections = list(self._connections.values())
        durable = not self._is_volatile_event(event_type)
        await self._broadcast_local(
            target_connections=target_connections,
            envelope=envelope,
            durable=durable,
            volatile_key=self._volatile_event_key(event_type=event_type, payload=payload),
        )
        if distribute and self._distribution_publish_enabled():
            self._schedule_transport_publish(
                {
                    "origin_node_id": self.node_id,
                    "distribution": "global",
                    "event_type": str(event_type or "").strip(),
                    "payload": payload or {},
                    "request_id": request_id,
                },
                durable=durable,
            )

    async def handle_distributed_event(self, event: dict) -> None:
        distributed_event_id = _normalize_text(event.get("_realtime_event_id"))
        if distributed_event_id and not self._claim_distributed_event_id(distributed_event_id):
            return
        try:
            await self._handle_distributed_event_once(event)
        except BaseException:
            if distributed_event_id:
                with self._lock:
                    self._distributed_event_ids.pop(distributed_event_id, None)
            raise

    def _claim_distributed_event_id(self, event_id: str) -> bool:
        normalized = _normalize_text(event_id)
        if not normalized:
            return True
        with self._lock:
            if normalized in self._distributed_event_ids:
                return False
            self._distributed_event_ids[normalized] = None
            while len(self._distributed_event_ids) > self._distributed_event_dedupe_size:
                self._distributed_event_ids.popitem(last=False)
        return True

    async def _handle_distributed_event_once(self, event: dict) -> None:
        distribution = _normalize_text(event.get("distribution"))
        event_type = _normalize_text(event.get("event_type"))
        payload = event.get("payload")
        if not isinstance(payload, dict):
            payload = {}
        request_id = _normalize_text(event.get("request_id")) or None
        conversation_id = _normalize_text(event.get("conversation_id")) or None
        watched_user_id = int(event.get("watched_user_id", 0) or 0)
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
        )
        durable = not self._is_volatile_event(event_type)
        volatile_key = self._volatile_event_key(
            event_type=event_type,
            conversation_id=conversation_id,
            payload=payload,
            watched_user_id=watched_user_id,
        )
        if distribution == "global":
            with self._lock:
                target_connections = list(self._connections.values())
            await self._broadcast_local(
                target_connections=target_connections,
                envelope=envelope,
                durable=durable,
                volatile_key=volatile_key,
            )
            return
        if distribution == "presence_watch":
            with self._lock:
                target_connections = [
                    connection
                    for connection in self._connections.values()
                    if int(watched_user_id) > 0 and int(watched_user_id) in connection.presence_watch_user_ids
                ]
            await self._broadcast_local(
                target_connections=target_connections,
                envelope=envelope,
                durable=False,
                volatile_key=volatile_key,
            )
            return
        if distribution == "conversation_room":
            excluded_user_id = int(event.get("exclude_user_id") or 0)
            excluded_connection_id = _normalize_text(event.get("exclude_connection_id"))
            with self._lock:
                target_connections = [
                    connection
                    for connection in self._connections.values()
                    if conversation_id and conversation_id in connection.conversation_ids
                    and (excluded_user_id <= 0 or int(connection.user_id) != excluded_user_id)
                    and (not excluded_connection_id or connection.id != excluded_connection_id)
                ]
            await self._broadcast_local(
                target_connections=target_connections,
                envelope=envelope,
                durable=durable,
                volatile_key=volatile_key,
            )
            return
        normalized_user_ids = {
            int(item)
            for item in list(event.get("target_user_ids") or [])
            if int(item) > 0
        }
        target_connections: list[ChatRealtimeConnection] = []
        with self._lock:
            for user_id in normalized_user_ids:
                for connection_id in list(self._user_connection_ids.get(int(user_id), set())):
                    connection = self._connections.get(connection_id)
                    if connection is None:
                        continue
                    if distribution == "inbox" and not connection.inbox_subscribed:
                        continue
                    if distribution == "conversation" and conversation_id and conversation_id not in connection.conversation_ids:
                        continue
                    target_connections.append(connection)
        await self._broadcast_local(
            target_connections=target_connections,
            envelope=envelope,
            durable=durable,
            volatile_key=volatile_key,
        )

    async def _publish_targeted_event(
        self,
        *,
        distribution: str,
        target_user_ids: list[int],
        event_type: str,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
        request_id: Optional[str] = None,
        watched_user_id: int = 0,
        distribute: bool = True,
    ) -> None:
        envelope = self.build_envelope(
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
        )
        durable = not self._is_volatile_event(event_type)
        volatile_key = self._volatile_event_key(
            event_type=event_type,
            conversation_id=conversation_id,
            payload=payload,
            watched_user_id=watched_user_id,
        )
        target_connections: list[ChatRealtimeConnection] = []
        with self._lock:
            if distribution == "presence_watch":
                target_connections = [
                    connection
                    for connection in self._connections.values()
                    if int(watched_user_id) > 0 and int(watched_user_id) in connection.presence_watch_user_ids
                ]
            else:
                normalized_user_ids = {int(item) for item in list(target_user_ids or []) if int(item) > 0}
                for user_id in normalized_user_ids:
                    for connection_id in list(self._user_connection_ids.get(int(user_id), set())):
                        connection = self._connections.get(connection_id)
                        if connection is None:
                            continue
                        if distribution == "inbox" and not connection.inbox_subscribed:
                            continue
                        if distribution == "conversation" and conversation_id and conversation_id not in connection.conversation_ids:
                            continue
                        target_connections.append(connection)
        await self._broadcast_local(
            target_connections=target_connections,
            envelope=envelope,
            durable=durable,
            volatile_key=volatile_key,
        )
        if distribute and self._distribution_publish_enabled():
            self._schedule_transport_publish(
                {
                    "origin_node_id": self.node_id,
                    "distribution": distribution,
                    "target_user_ids": [int(item) for item in list(target_user_ids or []) if int(item) > 0],
                    "watched_user_id": int(watched_user_id or 0),
                    "event_type": str(event_type or "").strip(),
                    "payload": payload or {},
                    "conversation_id": _normalize_text(conversation_id) or None,
                    "request_id": request_id,
                },
                durable=durable,
            )

    def _distribution_publish_enabled(self) -> bool:
        if self._realtime_transport == "local":
            return False
        # PostgreSQL publish can reconnect its dedicated publisher even while
        # LISTEN readiness is temporarily false. Redis preserves old behavior.
        if self._realtime_transport == "postgres":
            return bool(
                self._transport_bus.configured
                and getattr(self._transport_bus, "started", False)
            )
        return bool(self._transport_bus.available)

    def _schedule_transport_publish(self, payload: dict, *, durable: bool) -> None:
        """Publish cross-node without blocking local websocket fan-out."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        async def _run() -> None:
            await self._publish_transport_with_retry(payload, durable=durable)

        def _on_done(finished: asyncio.Task) -> None:
            if finished.cancelled():
                return
            exc = finished.exception()
            if exc is not None:
                logger.error(
                    "chat.realtime.%s async publish failed error=%s",
                    self._realtime_transport,
                    exc.__class__.__name__,
                )

        loop.create_task(
            _run(),
            name=f"chat-{self._realtime_transport}-publish",
        ).add_done_callback(_on_done)

    async def _publish_transport_with_retry(self, payload: dict, *, durable: bool) -> None:
        attempts = 1
        if self._realtime_transport == "postgres" and durable:
            attempts = max(
                1,
                min(5, int(str(os.getenv("CHAT_POSTGRES_PUBLISH_ATTEMPTS", "3") or "3").strip() or "3")),
            )
        base_delay = max(
            0.01,
            float(str(os.getenv("CHAT_POSTGRES_PUBLISH_RETRY_BASE_SEC", "0.1") or "0.1").strip() or "0.1"),
        )
        last_error: BaseException | None = None
        for attempt in range(attempts):
            try:
                if self._realtime_transport == "postgres":
                    published = await self._transport_bus.publish(payload, durable=durable)
                else:
                    published = await self._transport_bus.publish(payload)
                if self._realtime_transport == "postgres" and not published:
                    raise RuntimeError("PostgreSQL realtime relay did not acknowledge event")
                return
            except asyncio.CancelledError:
                raise
            except BaseException as exc:
                last_error = exc
                if attempt + 1 >= attempts:
                    break
                delay = min(2.0, base_delay * (2**attempt))
                delay += random.uniform(0.0, delay * 0.25)
                await asyncio.sleep(delay)
        if last_error is not None:
            raise last_error

    @staticmethod
    def _is_volatile_event(event_type: str) -> bool:
        """True for coalescible / non-durable events (not chat messages / ACK)."""
        if not _CHAT_WS_EVENT_COALESCE:
            normalized = _normalize_text(event_type)
            return (
                normalized.startswith("chat.typing.")
                or normalized == "chat.presence.updated"
                or normalized.startswith("task_canvas.")
                or normalized.startswith("tasks.presence.")
            )
        normalized_event_type = _normalize_text(event_type)
        if normalized_event_type.startswith("chat.typing."):
            return True
        if normalized_event_type == "chat.presence.updated":
            return True
        if normalized_event_type == "chat.conversation.updated":
            return True
        if normalized_event_type == "chat.unread.summary":
            return True
        if normalized_event_type.startswith("task_canvas."):
            return True
        if normalized_event_type.startswith("tasks.presence."):
            return True
        return False

    @staticmethod
    def _volatile_event_key(
        *,
        event_type: str,
        conversation_id: Optional[str] = None,
        payload: Optional[dict] = None,
        watched_user_id: int = 0,
        target_user_id: int = 0,
    ) -> Optional[str]:
        normalized_event_type = _normalize_text(event_type)
        if normalized_event_type.startswith("chat.typing."):
            return f"{normalized_event_type}:{_normalize_text(conversation_id)}:{int((payload or {}).get('user_id', 0) or 0)}"
        if normalized_event_type == "chat.presence.updated":
            uid = int(watched_user_id or 0 or int((payload or {}).get("user_id", 0) or 0))
            return f"presence:{uid}"
        if normalized_event_type == "chat.conversation.updated":
            cid = _normalize_text(conversation_id) or _normalize_text((payload or {}).get("id") or (payload or {}).get("conversation_id"))
            return f"conversation_update:{cid}" if cid else None
        if normalized_event_type == "chat.unread.summary":
            uid = int(target_user_id or 0 or int((payload or {}).get("user_id", 0) or 0))
            return f"inbox_meta:{uid}" if uid > 0 else "inbox_meta:0"
        if normalized_event_type.startswith("task_canvas."):
            connection_id = _normalize_text((payload or {}).get("connection_id"))
            target_connection_id = _normalize_text((payload or {}).get("target_connection_id"))
            suffix = connection_id or target_connection_id or "room"
            return f"{normalized_event_type}:{_normalize_text(conversation_id)}:{suffix}"
        if normalized_event_type.startswith("tasks.presence."):
            connection_id = _normalize_text((payload or {}).get("connection_id"))
            target_connection_id = _normalize_text((payload or {}).get("target_connection_id"))
            task_id = _normalize_text((payload or {}).get("task_id"))
            suffix = connection_id or target_connection_id or "room"
            return f"{normalized_event_type}:{task_id}:{suffix}"
        return None

    async def _broadcast_local(
        self,
        *,
        target_connections: list[ChatRealtimeConnection],
        envelope: dict,
        durable: bool,
        volatile_key: Optional[str],
    ) -> None:
        if not target_connections:
            return
        # Serialize once for the whole fan-out; writers send prebuilt text.
        try:
            encoded_payload = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"), default=str)
        except Exception:
            encoded_payload = None
        event_type = _normalize_text((envelope or {}).get("type"))
        failed_connection_ids: list[str] = []
        for connection in target_connections:
            per_conn_key = volatile_key
            if event_type == "chat.unread.summary":
                per_conn_key = f"inbox_meta:{int(connection.user_id)}"
            ok = self._enqueue_encoded_envelope(
                connection,
                envelope=envelope,
                encoded_payload=encoded_payload,
                durable=durable,
                volatile_key=per_conn_key,
            )
            if ok is True:
                continue
            failed_connection_ids.append(connection.id)
        for connection_id in failed_connection_ids:
            self._slow_consumer_disconnects += 1
            await self.disconnect_connection(
                connection_id,
                close_code=1008,
                close_reason="slow consumer",
            )

    def _enqueue_encoded_envelope(
        self,
        connection: ChatRealtimeConnection,
        *,
        envelope: dict,
        encoded_payload: Optional[str],
        durable: bool,
        volatile_key: Optional[str] = None,
    ) -> bool:
        """Non-blocking enqueue into a per-connection outbound queue (no await / no send).

        Queue item: (payload|None, coalesce_key|None, enqueued_at).
        For coalesced events payload is stored in connection.coalesce_latest and may be
        replaced while a marker sits in the queue — last state wins.
        """
        try:
            body: str | dict = encoded_payload if encoded_payload is not None else dict(envelope)
            payload_bytes = len(body) if isinstance(body, str) else len(json.dumps(body, default=str))
            enqueued_at = time.perf_counter()
            durable_key = self._durable_event_key(envelope) if durable else None
            if durable_key and durable_key in connection.recent_durable_event_keys:
                connection.recent_durable_event_keys.move_to_end(durable_key)
                connection.durable_duplicates_suppressed += 1
                with self._lock:
                    self._durable_duplicates_suppressed += 1
                return True
            if not durable and volatile_key:
                # Replace latest state if a marker is already pending.
                if volatile_key in connection.pending_volatile_keys:
                    connection.coalesce_latest[volatile_key] = body
                    connection.coalesced_events += 1
                    with self._lock:
                        self._coalesced_events += 1
                    return True
                if connection.outbound_queue.full():
                    connection.queue_full_count += 1
                    with self._lock:
                        self._queue_full_count += 1
                    return True
                connection.coalesce_latest[volatile_key] = body
                connection.pending_volatile_keys.add(volatile_key)
                connection.outbound_queue.put_nowait((None, volatile_key, enqueued_at, payload_bytes))
                self._record_sender_sample(outbound_queue_size=connection.outbound_queue.qsize())
                return True
            if connection.outbound_queue.full():
                # Durable/critical events must not silently drop. False → slow-consumer
                # disconnect (fail-loud backpressure), not a quiet skip.
                connection.queue_full_count += 1
                with self._lock:
                    self._queue_full_count += 1
                return False
            connection.outbound_queue.put_nowait((body, None, enqueued_at, payload_bytes))
            if durable_key:
                connection.recent_durable_event_keys[durable_key] = None
                while len(connection.recent_durable_event_keys) > _CHAT_WS_DURABLE_DEDUPE_SIZE:
                    connection.recent_durable_event_keys.popitem(last=False)
            self._record_sender_sample(outbound_queue_size=connection.outbound_queue.qsize(), payload_bytes=payload_bytes)
            return True
        except asyncio.QueueFull:
            connection.queue_full_count += 1
            with self._lock:
                self._queue_full_count += 1
            return False
        except Exception:
            return False

    @staticmethod
    def _durable_event_key(envelope: dict) -> str:
        """Stable per-socket key; transport-specific sent_at/event IDs are ignored."""
        logical = {
            "type": _normalize_text((envelope or {}).get("type")),
            "conversation_id": _normalize_text((envelope or {}).get("conversation_id")),
            "request_id": _normalize_text((envelope or {}).get("request_id")),
            "payload": (envelope or {}).get("payload") or {},
        }
        encoded = json.dumps(
            logical,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
        return hashlib.blake2s(encoded, digest_size=16).hexdigest()

    async def _enqueue_envelope(
        self,
        connection: ChatRealtimeConnection,
        envelope: dict,
        *,
        durable: bool,
        volatile_key: Optional[str] = None,
    ) -> bool:
        try:
            encoded_payload = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"), default=str)
        except Exception:
            encoded_payload = None
        return self._enqueue_encoded_envelope(
            connection,
            envelope=envelope,
            encoded_payload=encoded_payload,
            durable=durable,
            volatile_key=volatile_key,
        )

    async def _run_connection_sender(self, connection: ChatRealtimeConnection) -> None:
        """One sender task per connection; never blocks broadcast (only socket write)."""
        while True:
            coalesce_key = None
            payload = None
            enqueued_at = time.perf_counter()
            payload_bytes = 0
            try:
                item = await connection.outbound_queue.get()
                # Backward compatible: (payload, key) or (payload, key, enqueued_at, bytes)
                if isinstance(item, tuple) and len(item) >= 2:
                    payload, coalesce_key = item[0], item[1]
                    if len(item) >= 3 and item[2] is not None:
                        enqueued_at = float(item[2])
                    if len(item) >= 4 and item[3] is not None:
                        payload_bytes = int(item[3])
                else:
                    payload = item
                if coalesce_key:
                    key = str(coalesce_key)
                    payload = connection.coalesce_latest.pop(key, payload)
                    connection.pending_volatile_keys.discard(key)
                if payload is None:
                    continue
                queue_wait_ms = max(0.0, (time.perf_counter() - enqueued_at) * 1000.0)
                if isinstance(payload, str):
                    payload_bytes = payload_bytes or len(payload)
                send_started = time.perf_counter()
                try:
                    async with connection.send_lock:
                        if isinstance(payload, str):
                            await asyncio.wait_for(
                                connection.websocket.send_text(payload),
                                timeout=_OUTBOUND_SEND_TIMEOUT_SEC,
                            )
                        else:
                            await asyncio.wait_for(
                                connection.websocket.send_json(payload),
                                timeout=_OUTBOUND_SEND_TIMEOUT_SEC,
                            )
                except asyncio.TimeoutError:
                    connection.send_timeout_count += 1
                    with self._lock:
                        self._send_timeout_count += 1
                    raise
                finally:
                    socket_send_ms = max(0.0, (time.perf_counter() - send_started) * 1000.0)
                    self._record_sender_sample(
                        queue_wait_ms=queue_wait_ms,
                        socket_send_ms=socket_send_ms,
                        payload_bytes=payload_bytes,
                        outbound_queue_size=connection.outbound_queue.qsize(),
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                event_type = "-"
                if isinstance(payload, dict):
                    event_type = str(payload.get("type") or "").strip() or "-"
                elif isinstance(payload, str):
                    event_type = "preencoded"
                logger.warning(
                    "Chat websocket send failed: user_id=%s connection_id=%s event_type=%s error=%s",
                    int(connection.user_id),
                    connection.id,
                    event_type,
                    exc.__class__.__name__,
                )
                await self.disconnect_connection(
                    connection.id,
                    close_code=1011,
                    close_reason="send failed",
                )
                return
            finally:
                try:
                    connection.outbound_queue.task_done()
                except Exception:
                    pass

    def get_metrics(self) -> dict[str, int | bool | str | float]:
        with self._lock:
            outbound_queue_depth = sum(
                int(connection.outbound_queue.qsize())
                for connection in self._connections.values()
            )
            presence_watch_count = sum(len(connection.presence_watch_user_ids) for connection in self._connections.values())
            local_connection_count = len(self._connections)
            ws_rate_limited_count = int(self._ws_rate_limited_count)
            ws_rate_limited_connections = len(self._ws_rate_limited_connection_ids)
            queue_wait = list(self._queue_wait_ms_samples)
            socket_send = list(self._socket_send_ms_samples)
            payload_bytes = list(self._payload_bytes_samples)
            outbound_samples = list(self._outbound_queue_samples)
            coalesced = int(self._coalesced_events)
            queue_full = int(self._queue_full_count)
            send_timeouts = int(self._send_timeout_count)
            durable_duplicates_suppressed = int(self._durable_duplicates_suppressed)
        return {
            "realtime_node_id": self.node_id,
            "realtime_transport": self._realtime_transport,
            "realtime_configured": bool(self._transport_bus.configured),
            "realtime_available": bool(self._transport_bus.available),
            "realtime_subscriber_ready": bool(self._transport_bus.subscriber_ready),
            "publish_queue_depth": int(getattr(self._transport_bus, "publish_queue_depth", 0) or 0),
            "publish_queue_capacity": int(getattr(self._transport_bus, "publish_queue_capacity", 0) or 0),
            "publish_volatile_dropped": int(getattr(self._transport_bus, "publish_volatile_dropped", 0) or 0),
            "publish_critical_waiters": int(getattr(self._transport_bus, "publish_critical_waiters", 0) or 0),
            "publish_batches_total": int(getattr(self._transport_bus, "publish_batches_total", 0) or 0),
            "publish_events_total": int(getattr(self._transport_bus, "publish_events_total", 0) or 0),
            "publish_critical_total": int(getattr(self._transport_bus, "publish_critical_total", 0) or 0),
            "publish_background_total": int(getattr(self._transport_bus, "publish_background_total", 0) or 0),
            "publish_volatile_total": int(getattr(self._transport_bus, "publish_volatile_total", 0) or 0),
            "publish_batch_size_latest": int(getattr(self._transport_bus, "publish_batch_size_latest", 0) or 0),
            "publish_batch_size_p95": float(getattr(self._transport_bus, "publish_batch_size_p95", 0.0) or 0.0),
            "publish_batch_size_max": int(getattr(self._transport_bus, "publish_batch_size_max", 0) or 0),
            "publish_queue_wait_ms_critical_latest": float(getattr(self._transport_bus, "publish_queue_wait_ms_critical_latest", 0.0) or 0.0),
            "publish_queue_wait_ms_critical_p95": float(getattr(self._transport_bus, "publish_queue_wait_ms_critical_p95", 0.0) or 0.0),
            "publish_queue_wait_ms_critical_max": float(getattr(self._transport_bus, "publish_queue_wait_ms_critical_max", 0.0) or 0.0),
            "publish_queue_wait_ms_background_latest": float(getattr(self._transport_bus, "publish_queue_wait_ms_background_latest", 0.0) or 0.0),
            "publish_queue_wait_ms_background_p95": float(getattr(self._transport_bus, "publish_queue_wait_ms_background_p95", 0.0) or 0.0),
            "publish_queue_wait_ms_background_max": float(getattr(self._transport_bus, "publish_queue_wait_ms_background_max", 0.0) or 0.0),
            "relay_cursor": int(getattr(self._transport_bus, "relay_cursor", 0) or 0),
            "relay_caught_up": bool(getattr(self._transport_bus, "relay_caught_up", False)),
            "relay_current_batch_size": int(getattr(self._transport_bus, "relay_current_batch_size", 0) or 0),
            "relay_last_batch_size": int(getattr(self._transport_bus, "relay_last_batch_size", 0) or 0),
            "relay_db_dispatch_lag_ms_latest": float(getattr(self._transport_bus, "relay_db_dispatch_lag_ms_latest", 0.0) or 0.0),
            "relay_db_dispatch_lag_ms_p95": float(getattr(self._transport_bus, "relay_db_dispatch_lag_ms_p95", 0.0) or 0.0),
            "relay_db_dispatch_lag_ms_max": float(getattr(self._transport_bus, "relay_db_dispatch_lag_ms_max", 0.0) or 0.0),
            "redis_available": bool(self._redis_bus.redis_available),
            "redis_configured": bool(self._redis_bus.configured),
            "pubsub_subscribed": bool(self._redis_bus.pubsub_subscribed),
            "outbound_queue_depth": int(outbound_queue_depth),
            "outbound_queue_p95": round(self._pct(outbound_samples, 95), 1),
            "outbound_queue_max": int(max(outbound_samples) if outbound_samples else outbound_queue_depth),
            "queue_wait_ms_p95": round(self._pct(queue_wait, 95), 1),
            "socket_send_ms_p95": round(self._pct(socket_send, 95), 1),
            "socket_send_ms_max": round(max(socket_send) if socket_send else 0.0, 1),
            "payload_bytes_p95": round(self._pct(payload_bytes, 95), 1),
            "send_timeout_count": int(send_timeouts),
            "queue_full_count": int(queue_full),
            "coalesced_events": int(coalesced),
            "durable_duplicates_suppressed": durable_duplicates_suppressed,
            "presence_watch_count": int(presence_watch_count),
            "slow_consumer_disconnects": int(self._slow_consumer_disconnects),
            "local_connection_count": int(local_connection_count),
            "ws_rate_limited_count": int(ws_rate_limited_count),
            "ws_rate_limited_connections": int(ws_rate_limited_connections),
            "event_coalesce_enabled": bool(_CHAT_WS_EVENT_COALESCE),
        }

    def record_rate_limited(self, connection_id: str) -> None:
        normalized_connection_id = _normalize_text(connection_id)
        with self._lock:
            self._ws_rate_limited_count += 1
            if normalized_connection_id:
                self._ws_rate_limited_connection_ids.add(normalized_connection_id)


chat_realtime = ChatRealtimeManager()


def get_connected_chat_user_ids() -> set[int]:
    return chat_realtime.snapshot_connected_user_ids()


def get_chat_socket_last_seen(user_id: int) -> Optional[datetime]:
    return chat_realtime.get_last_seen(int(user_id))


def get_chat_presence_snapshot(user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, datetime]:
    return chat_realtime.get_presence_snapshot(user_ids)


def get_chat_realtime_metrics() -> dict[str, int | bool | str]:
    return chat_realtime.get_metrics()
