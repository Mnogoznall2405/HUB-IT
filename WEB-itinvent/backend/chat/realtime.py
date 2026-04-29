"""Realtime websocket transport helpers for chat."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Optional
from uuid import uuid4

from fastapi import WebSocket

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
_TYPING_STARTED_THROTTLE_SEC = max(1.0, float(str(os.getenv("CHAT_TYPING_STARTED_THROTTLE_SEC", "2") or "2").strip() or "2"))
_TYPING_STATE_TTL_SEC = max(2.0, float(str(os.getenv("CHAT_TYPING_STATE_TTL_SEC", "5") or "5").strip() or "5"))
_PRESENCE_TOUCH_THROTTLE_SEC = max(1.0, float(str(os.getenv("CHAT_PRESENCE_TOUCH_THROTTLE_SEC", "15") or "15").strip() or "15"))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _presence_hash_key(user_id: int) -> str:
    return f"{_PRESENCE_HASH_PREFIX}:{int(user_id)}"


def _ts_now() -> float:
    return time.time()


@dataclass
class ChatRealtimeConnection:
    id: str
    user_id: int
    websocket: WebSocket
    inbox_subscribed: bool = False
    conversation_ids: set[str] = field(default_factory=set)
    presence_watch_user_ids: set[int] = field(default_factory=set)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    queue_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    outbound_queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=_OUTBOUND_QUEUE_SIZE))
    pending_volatile_keys: set[str] = field(default_factory=set)
    sender_task: asyncio.Task | None = None
    last_presence_touch_at: float = 0.0


class ChatRealtimeRedisBus:
    def __init__(self, manager: "ChatRealtimeManager") -> None:
        self._manager = manager
        self._listener_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._pub_client = None
        self._sub_client = None
        self._pubsub = None
        self._sync_client = None
        self._pubsub_subscribed = False

    @property
    def node_id(self) -> str:
        return _CHAT_REALTIME_NODE_ID

    @property
    def configured(self) -> bool:
        return bool(str(config.redis.url or "").strip())

    @property
    def redis_available(self) -> bool:
        return self._pub_client is not None and self._sub_client is not None

    @property
    def pubsub_subscribed(self) -> bool:
        return bool(self._pubsub_subscribed)

    async def start(self) -> None:
        if self._listener_task and not self._listener_task.done():
            return
        redis_url = str(config.redis.url or "").strip()
        if not redis_url or redis_asyncio is None:
            return
        try:
            password = str(config.redis.password or "").strip() or None
            self._pub_client = redis_asyncio.Redis.from_url(
                redis_url,
                password=password,
                decode_responses=True,
                socket_timeout=2,
                socket_connect_timeout=2,
            )
            self._sub_client = redis_asyncio.Redis.from_url(
                redis_url,
                password=password,
                decode_responses=True,
                socket_timeout=2,
                socket_connect_timeout=2,
            )
            await self._pub_client.ping()
            await self._sub_client.ping()
            self._pubsub = self._sub_client.pubsub(ignore_subscribe_messages=True)
            await self._pubsub.subscribe(_CHAT_REALTIME_CHANNEL)
            self._pubsub_subscribed = True
            self._stop_event = asyncio.Event()
            self._listener_task = asyncio.create_task(self._run_listener(), name="chat-redis-pubsub")
        except Exception as exc:  # pragma: no cover - runtime dependent
            logger.warning("chat.realtime.redis unavailable, using local-only realtime: %s", exc)
            self._pubsub_subscribed = False
            await self.stop()

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        self._listener_task = None
        self._pubsub_subscribed = False
        if self._pubsub is not None:
            try:
                await self._pubsub.close()
            except Exception:
                pass
        self._pubsub = None
        if self._pub_client is not None:
            try:
                await self._pub_client.close()
            except Exception:
                pass
        self._pub_client = None
        if self._sub_client is not None:
            try:
                await self._sub_client.close()
            except Exception:
                pass
        self._sub_client = None
        self._stop_event = None

    async def publish(self, payload: dict) -> bool:
        if self._pub_client is None:
            return False
        try:
            await self._pub_client.publish(_CHAT_REALTIME_CHANNEL, json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            logger.exception("chat.realtime.redis publish failed")
            return False

    async def _run_listener(self) -> None:
        while True:
            try:
                if self._pubsub is None:
                    return
                message = await self._pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is not None:
                    raw_data = message.get("data")
                    if raw_data:
                        payload = json.loads(str(raw_data))
                        if _normalize_text(payload.get("origin_node_id")) != self.node_id:
                            await self._manager.handle_distributed_event(payload)
                if self._stop_event is not None and self._stop_event.is_set():
                    return
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("chat.realtime.redis listener failed")
                await asyncio.sleep(1.0)

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
        self._redis_bus = ChatRealtimeRedisBus(self)

    @property
    def node_id(self) -> str:
        return self._redis_bus.node_id

    async def start(self) -> None:
        await self._redis_bus.start()

    async def stop(self) -> None:
        await self._redis_bus.stop()

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

    async def connect(self, websocket: WebSocket, *, user_id: int) -> tuple[str, bool]:
        await websocket.accept()
        connection_id = str(uuid4())
        normalized_user_id = int(user_id)
        connection = ChatRealtimeConnection(
            id=connection_id,
            user_id=normalized_user_id,
            websocket=websocket,
            last_presence_touch_at=_ts_now(),
        )
        connection.sender_task = asyncio.create_task(
            self._run_connection_sender(connection),
            name=f"chat-ws-sender:{connection_id}",
        )
        with self._lock:
            self._connections[connection_id] = connection
            existing = self._user_connection_ids.setdefault(normalized_user_id, set())
            first_connection = len(existing) == 0
            existing.add(connection_id)
        asyncio.create_task(
            asyncio.to_thread(
                self._redis_bus.record_presence_sync,
                user_id=normalized_user_id,
                connection_id=connection_id,
            ),
            name=f"chat-presence-connect:{connection_id}",
        )
        return connection_id, first_connection

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
            user_ids = self._user_connection_ids.get(int(connection.user_id), set())
            user_ids.discard(normalized_connection_id)
            last_connection = len(user_ids) == 0
            if last_connection:
                self._user_connection_ids.pop(int(connection.user_id), None)
                self._last_seen_by_user_id[int(connection.user_id)] = _utc_now()
        if connection.sender_task is not None:
            connection.sender_task.cancel()
        asyncio.create_task(
            asyncio.to_thread(
                self._redis_bus.clear_presence_sync,
                user_id=int(connection.user_id),
                connection_id=normalized_connection_id,
            ),
            name=f"chat-presence-disconnect:{normalized_connection_id}",
        )
        return {
            "user_id": int(connection.user_id),
            "last_connection": last_connection,
        }

    def touch_presence(self, connection_id: str) -> bool:
        now_ts = _ts_now()
        with self._lock:
            connection = self._connections.get(str(connection_id or "").strip())
            if connection is not None and (now_ts - float(connection.last_presence_touch_at or 0.0)) < _PRESENCE_TOUCH_THROTTLE_SEC:
                return False
            if connection is not None:
                connection.last_presence_touch_at = now_ts
        if connection is None:
            return False
        asyncio.create_task(
            asyncio.to_thread(
                self._redis_bus.record_presence_sync,
                user_id=int(connection.user_id),
                connection_id=connection.id,
            ),
            name=f"chat-presence-touch:{connection.id}",
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

    def get_last_seen(self, user_id: int) -> Optional[datetime]:
        with self._lock:
            return self._last_seen_by_user_id.get(int(user_id))

    def get_presence_snapshot(self, user_ids: Optional[list[int] | set[int] | tuple[int, ...]] = None) -> dict[int, datetime]:
        normalized_user_ids = {int(item) for item in list(user_ids or []) if int(item) > 0}
        snapshot: dict[int, datetime] = self._redis_bus.load_presence_snapshot(normalized_user_ids)
        with self._lock:
            for connection in self._connections.values():
                if normalized_user_ids and int(connection.user_id) not in normalized_user_ids:
                    continue
                snapshot[int(connection.user_id)] = _utc_now()
        return snapshot

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
            self.disconnect(normalized_connection_id)

    async def send_command_ok(
        self,
        connection_id: str,
        *,
        request_id: Optional[str] = None,
        payload: Optional[dict] = None,
        conversation_id: Optional[str] = None,
    ) -> None:
        await self.send_to_connection(
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
        await self.send_to_connection(
            connection_id,
            event_type="chat.error",
            payload={
                "detail": str(detail or "").strip() or "Chat websocket error",
                "code": str(code or "bad_request").strip() or "bad_request",
            },
            conversation_id=conversation_id,
            request_id=request_id,
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
        await self._publish_targeted_event(
            distribution="inbox",
            target_user_ids=[int(user_id)],
            event_type=event_type,
            payload=payload,
            conversation_id=conversation_id,
            request_id=request_id,
            distribute=distribute,
        )

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
        await self._broadcast_local(
            target_connections=target_connections,
            envelope=envelope,
            durable=not self._is_volatile_event(event_type),
            volatile_key=self._volatile_event_key(event_type=event_type, payload=payload),
        )
        if distribute and self._redis_bus.redis_available:
            await self._redis_bus.publish(
                {
                    "origin_node_id": self.node_id,
                    "distribution": "global",
                    "event_type": str(event_type or "").strip(),
                    "payload": payload or {},
                    "request_id": request_id,
                }
            )

    async def handle_distributed_event(self, event: dict) -> None:
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
        if distribute and self._redis_bus.redis_available:
            await self._redis_bus.publish(
                {
                    "origin_node_id": self.node_id,
                    "distribution": distribution,
                    "target_user_ids": [int(item) for item in list(target_user_ids or []) if int(item) > 0],
                    "watched_user_id": int(watched_user_id or 0),
                    "event_type": str(event_type or "").strip(),
                    "payload": payload or {},
                    "conversation_id": _normalize_text(conversation_id) or None,
                    "request_id": request_id,
                }
            )

    @staticmethod
    def _is_volatile_event(event_type: str) -> bool:
        normalized_event_type = _normalize_text(event_type)
        return normalized_event_type.startswith("chat.typing.") or normalized_event_type == "chat.presence.updated"

    @staticmethod
    def _volatile_event_key(
        *,
        event_type: str,
        conversation_id: Optional[str] = None,
        payload: Optional[dict] = None,
        watched_user_id: int = 0,
    ) -> Optional[str]:
        normalized_event_type = _normalize_text(event_type)
        if normalized_event_type.startswith("chat.typing."):
            return f"{normalized_event_type}:{_normalize_text(conversation_id)}:{int((payload or {}).get('user_id', 0) or 0)}"
        if normalized_event_type == "chat.presence.updated":
            target_user_id = int(watched_user_id or 0 or int((payload or {}).get("user_id", 0) or 0))
            return f"chat.presence.updated:{target_user_id}"
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
        enqueue_results = await asyncio.gather(
            *(
                self._enqueue_envelope(
                    connection,
                    envelope,
                    durable=durable,
                    volatile_key=volatile_key,
                )
                for connection in target_connections
            ),
            return_exceptions=True,
        )
        failed_connection_ids: list[str] = []
        for connection, result in zip(target_connections, enqueue_results):
            if result is True:
                continue
            failed_connection_ids.append(connection.id)
        for connection_id in failed_connection_ids:
            self._slow_consumer_disconnects += 1
            self.disconnect(connection_id)

    async def _enqueue_envelope(
        self,
        connection: ChatRealtimeConnection,
        envelope: dict,
        *,
        durable: bool,
        volatile_key: Optional[str] = None,
    ) -> bool:
        try:
            async with connection.queue_lock:
                if not durable and volatile_key:
                    if volatile_key in connection.pending_volatile_keys:
                        return True
                    if connection.outbound_queue.full():
                        return True
                    connection.pending_volatile_keys.add(volatile_key)
                else:
                    if connection.outbound_queue.full():
                        return False
                connection.outbound_queue.put_nowait((dict(envelope), volatile_key))
            return True
        except asyncio.QueueFull:
            return False
        except Exception:
            return False

    async def _run_connection_sender(self, connection: ChatRealtimeConnection) -> None:
        while True:
            volatile_key = None
            try:
                envelope, volatile_key = await connection.outbound_queue.get()
                async with connection.send_lock:
                    await connection.websocket.send_json(envelope)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.info(
                    "Chat websocket send failed: user_id=%s connection_id=%s event_type=%s error=%s",
                    int(connection.user_id),
                    connection.id,
                    str((envelope or {}).get("type") or "").strip() if isinstance(envelope, dict) else "-",
                    exc.__class__.__name__,
                )
                self.disconnect(connection.id)
                return
            finally:
                if volatile_key:
                    try:
                        async with connection.queue_lock:
                            connection.pending_volatile_keys.discard(str(volatile_key))
                    except Exception:
                        connection.pending_volatile_keys.discard(str(volatile_key))

    def get_metrics(self) -> dict[str, int | bool | str]:
        with self._lock:
            outbound_queue_depth = sum(
                int(connection.outbound_queue.qsize())
                for connection in self._connections.values()
            )
            presence_watch_count = sum(len(connection.presence_watch_user_ids) for connection in self._connections.values())
            local_connection_count = len(self._connections)
            ws_rate_limited_count = int(self._ws_rate_limited_count)
            ws_rate_limited_connections = len(self._ws_rate_limited_connection_ids)
        return {
            "realtime_node_id": self.node_id,
            "redis_available": bool(self._redis_bus.redis_available),
            "redis_configured": bool(self._redis_bus.configured),
            "pubsub_subscribed": bool(self._redis_bus.pubsub_subscribed),
            "outbound_queue_depth": int(outbound_queue_depth),
            "presence_watch_count": int(presence_watch_count),
            "slow_consumer_disconnects": int(self._slow_consumer_disconnects),
            "local_connection_count": int(local_connection_count),
            "ws_rate_limited_count": int(ws_rate_limited_count),
            "ws_rate_limited_connections": int(ws_rate_limited_connections),
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
