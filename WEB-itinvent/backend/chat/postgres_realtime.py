"""Durable PostgreSQL LISTEN/NOTIFY transport for multi-node chat realtime.

NOTIFY is only a wake-up signal: the complete event is stored in a relay table.
This keeps notifications comfortably below PostgreSQL's 8 KiB payload limit and
allows a listener to catch up from its in-memory cursor after reconnecting.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.engine import make_url

try:  # pragma: no cover - import availability depends on runtime extras
    import psycopg
    from psycopg import sql
except Exception:  # pragma: no cover - runtime dependent
    psycopg = None
    sql = None


logger = logging.getLogger("backend.chat.postgres_realtime")

_DEFAULT_CHANNEL = "itinvent_chat_events"
_DEFAULT_RELAY_TABLE = "chat_realtime_events"
_CHANNEL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_PUBLISH_STOP = object()
_CRITICAL_EVENT_TYPES = frozenset({"chat.message.created"})


class ChatRealtimePublishBackpressure(RuntimeError):
    """Raised when the bounded durable publisher queue is saturated."""


@dataclass(slots=True)
class _QueuedPublish:
    encoded: str
    retention_sec: int
    future: asyncio.Future
    category: str
    enqueued_at: float


def postgres_database_url_supported(database_url: str | None) -> bool:
    raw = str(database_url or "").strip()
    if not raw or psycopg is None:
        return False
    try:
        return make_url(raw).get_backend_name() == "postgresql"
    except Exception:
        return False


def _psycopg_conninfo(database_url: str) -> str:
    """Convert SQLAlchemy's postgresql+psycopg URL to a libpq URL."""
    parsed = make_url(str(database_url or "").strip())
    if parsed.get_backend_name() != "postgresql":
        raise ValueError("PostgreSQL database URL is required")
    return parsed.set(drivername="postgresql").render_as_string(hide_password=False)


class ChatRealtimePostgresBus:
    """Cross-node relay backed by PostgreSQL and a reconnecting LISTEN socket."""

    transport = "postgres"

    def __init__(
        self,
        manager: Any,
        *,
        database_url: str,
        node_id: str,
        subscriber_enabled: bool = True,
    ) -> None:
        self._manager = manager
        self._database_url = str(database_url or "").strip()
        self._node_id = str(node_id or "").strip()
        self._subscriber_enabled = bool(subscriber_enabled)
        self._listener_task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._reconnect_event: asyncio.Event | None = None
        self._listener_conn = None
        self._publisher_conn = None
        self._presence_conn = None
        self._publisher_lock: asyncio.Lock | None = None
        self._presence_lock: asyncio.Lock | None = None
        self._publish_queue: asyncio.Queue | None = None
        self._publish_worker_task: asyncio.Task | None = None
        self._publish_worker_ready = False
        self._accepting_publishes = False
        self._publish_sequence = 0
        self._volatile_dropped = 0
        self._critical_waiters = 0
        self._publish_batches_total = 0
        self._publish_events_total = 0
        self._publish_category_totals = {"critical": 0, "background": 0, "volatile": 0}
        self._publish_batch_size_samples: list[float] = []
        self._publish_batch_size_latest = 0
        self._publish_queue_wait_ms_samples: dict[str, list[float]] = {
            "critical": [],
            "background": [],
            "volatile": [],
        }
        self._subscriber_ready = False
        self._publisher_ready = False
        self._cursor: int | None = None
        self._relay_caught_up = False
        self._relay_current_batch_size = 0
        self._relay_last_batch_size = 0
        self._relay_db_dispatch_lag_ms_samples: list[float] = []
        self._relay_db_dispatch_lag_ms_latest = 0.0
        self._schema = "public"
        self._channel = (
            str(os.getenv("CHAT_POSTGRES_CHANNEL", _DEFAULT_CHANNEL) or "").strip()
            or _DEFAULT_CHANNEL
        )
        if not _CHANNEL_RE.fullmatch(self._channel):
            raise ValueError(
                "CHAT_POSTGRES_CHANNEL must be a PostgreSQL identifier of at most 63 ASCII characters"
            )
        self._relay_table = _DEFAULT_RELAY_TABLE
        self._poll_sec = max(
            0.05,
            float(str(os.getenv("CHAT_POSTGRES_POLL_SEC", "0.5") or "0.5").strip() or "0.5"),
        )
        self._batch_size = max(
            1,
            min(1000, int(str(os.getenv("CHAT_POSTGRES_RELAY_BATCH_SIZE", "200") or "200").strip() or "200")),
        )
        self._retention_sec = max(
            300,
            int(str(os.getenv("CHAT_POSTGRES_RELAY_RETENTION_SEC", "86400") or "86400").strip() or "86400"),
        )
        self._max_event_bytes = max(
            8192,
            min(
                16 * 1024 * 1024,
                int(str(os.getenv("CHAT_POSTGRES_MAX_EVENT_BYTES", str(4 * 1024 * 1024)) or "").strip() or 4 * 1024 * 1024),
            ),
        )
        self._reconnect_base_sec = max(
            0.01,
            float(str(os.getenv("CHAT_POSTGRES_RECONNECT_BASE_SEC", "0.5") or "0.5").strip() or "0.5"),
        )
        self._reconnect_max_sec = max(
            self._reconnect_base_sec,
            float(str(os.getenv("CHAT_POSTGRES_RECONNECT_MAX_SEC", "30") or "30").strip() or "30"),
        )
        self._reconnect_jitter_ratio = min(
            1.0,
            max(
                0.0,
                float(str(os.getenv("CHAT_POSTGRES_RECONNECT_JITTER_RATIO", "0.5") or "0.5").strip() or "0.5"),
            ),
        )
        self._published_since_cleanup = 0
        self._publish_queue_size = max(
            1,
            min(
                16384,
                int(str(os.getenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "2048") or "2048").strip() or "2048"),
            ),
        )
        self._publish_batch_max = max(
            1,
            min(
                512,
                int(str(os.getenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "64") or "64").strip() or "64"),
            ),
        )
        self._publish_flush_sec = min(
            0.05,
            max(
                0.001,
                float(str(os.getenv("CHAT_POSTGRES_PUBLISH_FLUSH_MS", "3") or "3").strip() or "3") / 1000.0,
            ),
        )
        self._durable_queue_reserve = max(
            1,
            min(
                self._publish_queue_size,
                int(
                    str(
                        os.getenv(
                            "CHAT_POSTGRES_PUBLISH_DURABLE_RESERVE",
                            str(max(1, self._publish_queue_size // 4)),
                        )
                        or max(1, self._publish_queue_size // 4)
                    ).strip()
                    or max(1, self._publish_queue_size // 4)
                ),
            ),
        )
        self._critical_queue_reserve = max(
            1,
            min(
                self._publish_queue_size,
                int(
                    str(
                        os.getenv(
                            "CHAT_POSTGRES_PUBLISH_CRITICAL_RESERVE",
                            str(max(1, self._publish_queue_size // 8)),
                        )
                        or max(1, self._publish_queue_size // 8)
                    ).strip()
                    or max(1, self._publish_queue_size // 8)
                ),
            ),
        )
        self._critical_waiters_max = max(
            1,
            min(
                4096,
                int(
                    str(
                        os.getenv(
                            "CHAT_POSTGRES_PUBLISH_CRITICAL_WAITERS",
                            str(max(32, self._publish_queue_size // 4)),
                        )
                        or max(32, self._publish_queue_size // 4)
                    ).strip()
                    or max(32, self._publish_queue_size // 4)
                ),
            ),
        )
        self._presence_ttl_sec = max(
            10,
            int(str(os.getenv("CHAT_PRESENCE_TTL_SEC", "75") or "75").strip() or "75"),
        )
        self._presence_refresh_sec = max(
            0.5,
            float(str(os.getenv("CHAT_POSTGRES_PRESENCE_REFRESH_SEC", "2") or "2").strip() or "2"),
        )
        self._presence_snapshot: dict[int, datetime] = {}
        self._last_presence_refresh_at = 0.0
        self._delivery_concurrency = max(
            1,
            min(
                64,
                int(
                    str(os.getenv("CHAT_POSTGRES_DELIVERY_CONCURRENCY", "16") or "16").strip()
                    or "16"
                ),
            ),
        )

    @property
    def node_id(self) -> str:
        return self._node_id

    @property
    def configured(self) -> bool:
        return postgres_database_url_supported(self._database_url)

    @property
    def available(self) -> bool:
        worker = self._publish_worker_task
        return bool(
            self._accepting_publishes
            and (self._subscriber_ready or not self._subscriber_enabled)
            and self._publisher_ready
            and self._publish_worker_ready
            and worker is not None
            and not worker.done()
        )

    @property
    def subscriber_ready(self) -> bool:
        return bool(self._subscriber_ready)

    @property
    def started(self) -> bool:
        return (
            self._publisher_lock is not None
            and self._stop_event is not None
            and self._accepting_publishes
        )

    @property
    def publish_queue_depth(self) -> int:
        return int(self._publish_queue.qsize()) if self._publish_queue is not None else 0

    @property
    def publish_queue_capacity(self) -> int:
        return int(self._publish_queue_size)

    @property
    def publish_volatile_dropped(self) -> int:
        return int(self._volatile_dropped)

    @property
    def publish_critical_waiters(self) -> int:
        return int(self._critical_waiters)

    @property
    def publish_batches_total(self) -> int:
        return int(self._publish_batches_total)

    @property
    def publish_events_total(self) -> int:
        return int(self._publish_events_total)

    @property
    def publish_critical_total(self) -> int:
        return int(self._publish_category_totals["critical"])

    @property
    def publish_background_total(self) -> int:
        return int(self._publish_category_totals["background"])

    @property
    def publish_volatile_total(self) -> int:
        return int(self._publish_category_totals["volatile"])

    @property
    def publish_batch_size_latest(self) -> int:
        return int(self._publish_batch_size_latest)

    @property
    def publish_batch_size_p95(self) -> float:
        return round(self._percentile(self._publish_batch_size_samples, 95), 1)

    @property
    def publish_batch_size_max(self) -> int:
        samples = self._publish_batch_size_samples
        return int(max(samples) if samples else 0)

    @property
    def publish_queue_wait_ms_critical_latest(self) -> float:
        return self._publish_queue_wait_metric("critical", "latest")

    @property
    def publish_queue_wait_ms_critical_p95(self) -> float:
        return self._publish_queue_wait_metric("critical", "p95")

    @property
    def publish_queue_wait_ms_critical_max(self) -> float:
        return self._publish_queue_wait_metric("critical", "max")

    @property
    def publish_queue_wait_ms_background_latest(self) -> float:
        return self._publish_queue_wait_metric("background", "latest")

    @property
    def publish_queue_wait_ms_background_p95(self) -> float:
        return self._publish_queue_wait_metric("background", "p95")

    @property
    def publish_queue_wait_ms_background_max(self) -> float:
        return self._publish_queue_wait_metric("background", "max")

    @property
    def relay_cursor(self) -> int:
        return int(self._cursor or 0)

    @property
    def relay_caught_up(self) -> bool:
        return bool(self._relay_caught_up)

    @property
    def relay_current_batch_size(self) -> int:
        return int(self._relay_current_batch_size)

    @property
    def relay_last_batch_size(self) -> int:
        return int(self._relay_last_batch_size)

    @property
    def relay_db_dispatch_lag_ms_latest(self) -> float:
        return round(float(self._relay_db_dispatch_lag_ms_latest), 1)

    @property
    def relay_db_dispatch_lag_ms_p95(self) -> float:
        return round(self._percentile(self._relay_db_dispatch_lag_ms_samples, 95), 1)

    @property
    def relay_db_dispatch_lag_ms_max(self) -> float:
        samples = self._relay_db_dispatch_lag_ms_samples
        return round(max(samples) if samples else 0.0, 1)

    async def start(self) -> None:
        if self._listener_task is not None and not self._listener_task.done():
            return
        if not self.configured:
            self._mark_unavailable()
            await self._close_clients()
            return
        self._stop_event = asyncio.Event()
        self._reconnect_event = asyncio.Event()
        self._publisher_lock = asyncio.Lock()
        self._presence_lock = asyncio.Lock()
        self._publish_queue = asyncio.PriorityQueue(maxsize=self._publish_queue_size)
        self._publish_sequence = 0
        self._critical_waiters = 0
        self._publish_batches_total = 0
        self._publish_events_total = 0
        for category in self._publish_category_totals:
            self._publish_category_totals[category] = 0
            self._publish_queue_wait_ms_samples[category].clear()
        self._publish_batch_size_samples.clear()
        self._publish_batch_size_latest = 0
        self._relay_caught_up = False
        self._relay_current_batch_size = 0
        self._relay_last_batch_size = 0
        self._relay_db_dispatch_lag_ms_samples.clear()
        self._relay_db_dispatch_lag_ms_latest = 0.0
        self._accepting_publishes = True
        self._publish_worker_ready = False
        self._mark_unavailable()
        self._publish_worker_task = asyncio.create_task(
            self._run_publish_worker(),
            name="chat-postgres-publisher",
        )
        if self._subscriber_enabled:
            self._listener_task = asyncio.create_task(
                self._run_listener(),
                name="chat-postgres-listener",
            )

    async def stop(self) -> None:
        self._accepting_publishes = False
        if self._stop_event is not None:
            self._stop_event.set()
        if self._reconnect_event is not None:
            self._reconnect_event.set()
        if self._listener_task is not None:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        self._listener_task = None
        await self._drain_and_stop_publisher()
        await self._clear_node_presence()
        self._mark_unavailable()
        await self._close_clients()
        self._publisher_lock = None
        self._presence_lock = None
        self._publish_queue = None
        self._publish_worker_task = None
        self._publish_worker_ready = False
        self._stop_event = None
        self._reconnect_event = None

    async def publish(self, payload: dict, *, durable: bool = True) -> bool:
        encoded = self._encode_event(payload)
        if self._publisher_lock is None or not self._accepting_publishes:
            raise RuntimeError("PostgreSQL realtime transport is not started")
        critical = bool(
            durable and str(payload.get("event_type") or "").strip() in _CRITICAL_EVENT_TYPES
        )
        return await self._enqueue_publish(
            encoded=encoded,
            retention_sec=int(self._retention_sec if durable else 300),
            durable=bool(durable),
            critical=critical,
        )

    async def _enqueue_publish(
        self,
        *,
        encoded: str,
        retention_sec: int,
        durable: bool,
        critical: bool,
    ) -> bool:
        queue = self._publish_queue
        if queue is None or not self._accepting_publishes:
            raise RuntimeError("PostgreSQL realtime publisher is stopping")
        # Best-effort typing/presence can be coalesced away under pressure;
        # durable messages/read/inbox retain reserved queue capacity.
        volatile_limit = max(0, self._publish_queue_size - self._durable_queue_reserve)
        if not durable and queue.qsize() >= volatile_limit:
            self._volatile_dropped += 1
            return True
        background_durable_limit = max(
            0,
            self._publish_queue_size - self._critical_queue_reserve,
        )
        if durable and not critical and queue.qsize() >= background_durable_limit:
            raise ChatRealtimePublishBackpressure(
                "PostgreSQL realtime background publish queue reached its "
                f"message.created reserve ({self._critical_queue_reserve})"
            )
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        category = "critical" if critical else "background" if durable else "volatile"
        request = _QueuedPublish(
            encoded=encoded,
            retention_sec=int(retention_sec),
            future=future,
            category=category,
            enqueued_at=loop.time(),
        )
        self._publish_sequence += 1
        queue_item = (0 if critical else 1 if durable else 2, self._publish_sequence, request)
        try:
            queue.put_nowait(queue_item)
        except asyncio.QueueFull as exc:
            if not durable:
                future.cancel()
                self._volatile_dropped += 1
                return True
            if critical:
                try:
                    await self._wait_for_critical_queue_slot(queue, queue_item)
                except BaseException:
                    future.cancel()
                    raise
                return bool(await future)
            future.cancel()
            raise ChatRealtimePublishBackpressure(
                f"PostgreSQL realtime publish queue is full ({self._publish_queue_size})"
            ) from exc
        return bool(await future)

    async def _wait_for_critical_queue_slot(self, queue: asyncio.Queue, queue_item: tuple) -> None:
        if self._critical_waiters >= self._critical_waiters_max:
            raise ChatRealtimePublishBackpressure(
                "PostgreSQL realtime message.created waiter limit reached "
                f"({self._critical_waiters_max})"
            )
        stop_event = self._stop_event
        if stop_event is None or stop_event.is_set() or not self._accepting_publishes:
            raise RuntimeError("PostgreSQL realtime publisher is stopping")

        self._critical_waiters += 1
        put_task = asyncio.create_task(queue.put(queue_item))
        stop_task = asyncio.create_task(stop_event.wait())
        try:
            done, _pending = await asyncio.wait(
                {put_task, stop_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if put_task in done:
                await put_task
                return
            put_task.cancel()
            try:
                await put_task
            except asyncio.CancelledError:
                pass
            raise RuntimeError("PostgreSQL realtime publisher stopped before enqueue")
        finally:
            stop_task.cancel()
            try:
                await stop_task
            except asyncio.CancelledError:
                pass
            self._critical_waiters -= 1

    async def _run_publish_worker(self) -> None:
        queue = self._publish_queue
        if queue is None:
            return
        self._publish_worker_ready = True
        try:
            while True:
                _priority, _sequence, item = await queue.get()
                if item is _PUBLISH_STOP:
                    queue.task_done()
                    return
                self._record_publish_queue_wait(item)
                batch: list[_QueuedPublish] = [item]
                stop_after_batch = False
                deadline = asyncio.get_running_loop().time() + self._publish_flush_sec
                while len(batch) < self._publish_batch_max:
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    try:
                        _next_priority, _next_sequence, next_item = await asyncio.wait_for(
                            queue.get(),
                            timeout=remaining,
                        )
                    except asyncio.TimeoutError:
                        break
                    if next_item is _PUBLISH_STOP:
                        queue.task_done()
                        stop_after_batch = True
                        break
                    self._record_publish_queue_wait(next_item)
                    batch.append(next_item)
                await self._complete_publish_batch(batch)
                for _request in batch:
                    queue.task_done()
                if stop_after_batch:
                    return
        except asyncio.CancelledError:
            raise
        finally:
            self._accepting_publishes = False
            self._publish_worker_ready = False
            self._fail_queued_publishes(RuntimeError("PostgreSQL realtime publisher stopped"))

    async def _complete_publish_batch(self, batch: list[_QueuedPublish]) -> None:
        try:
            await self._flush_publish_batch(batch)
        except asyncio.CancelledError:
            for request in batch:
                if not request.future.done():
                    request.future.cancel()
            raise
        except BaseException as exc:
            self._publisher_ready = False
            await self._close_publisher()
            if self._reconnect_event is not None:
                self._reconnect_event.set()
            logger.warning(
                "chat.realtime.postgres publish batch failed count=%s error=%s",
                len(batch),
                exc.__class__.__name__,
            )
            for request in batch:
                if not request.future.done():
                    request.future.set_exception(exc)
            return
        for request in batch:
            if not request.future.done():
                request.future.set_result(True)
        self._publish_batches_total += 1
        self._publish_events_total += len(batch)
        self._publish_batch_size_latest = len(batch)
        self._publish_batch_size_samples.append(float(len(batch)))
        if len(self._publish_batch_size_samples) > 512:
            del self._publish_batch_size_samples[:-512]
        for request in batch:
            self._publish_category_totals[request.category] += 1

    def _record_publish_queue_wait(self, request: _QueuedPublish) -> None:
        wait_ms = max(
            0.0,
            (asyncio.get_running_loop().time() - float(request.enqueued_at)) * 1000.0,
        )
        samples = self._publish_queue_wait_ms_samples[request.category]
        samples.append(wait_ms)
        if len(samples) > 512:
            del samples[:-512]

    def _publish_queue_wait_metric(self, category: str, metric: str) -> float:
        samples = self._publish_queue_wait_ms_samples[category]
        if not samples:
            return 0.0
        if metric == "latest":
            value = samples[-1]
        elif metric == "max":
            value = max(samples)
        else:
            value = self._percentile(samples, 95)
        return round(float(value), 1)

    async def _flush_publish_batch(self, batch: list[_QueuedPublish]) -> None:
        lock = self._publisher_lock
        if lock is None:
            raise RuntimeError("PostgreSQL realtime publisher is stopping")
        rows = [
            (self.node_id, request.encoded, int(request.retention_sec))
            for request in batch
        ]
        async with lock:
            conn = await self._ensure_publisher_unlocked()
            await asyncio.to_thread(self._publish_batch_sync, conn, rows)
            self._published_since_cleanup += len(rows)
            if self._published_since_cleanup >= 256:
                self._published_since_cleanup %= 256
                await asyncio.to_thread(self._cleanup_expired_sync, conn)

    def _publish_batch_sync(self, conn, rows: list[tuple[str, str, int]]) -> None:
        table = self._qualified_relay_table()
        with conn.transaction():
            with conn.cursor() as cursor:
                cursor.execute(
                    sql.SQL(
                        "INSERT INTO {} (origin_node_id, payload_json, expires_at) "
                        "SELECT batch.origin_node_id, batch.payload_json, "
                        "NOW() + (batch.retention_sec * INTERVAL '1 second') "
                        "FROM UNNEST(%s::text[], %s::text[], %s::integer[]) "
                        "WITH ORDINALITY AS batch("
                        "origin_node_id, payload_json, retention_sec, ordinality"
                        ") ORDER BY batch.ordinality"
                    ).format(table),
                    (
                        [str(row[0]) for row in rows],
                        [str(row[1]) for row in rows],
                        [int(row[2]) for row in rows],
                    ),
                )
            conn.execute(
                "SELECT pg_notify(%s, %s)",
                (self._channel, json.dumps({"batch": len(rows)}, separators=(",", ":"))),
            )

    async def _drain_and_stop_publisher(self) -> None:
        queue = self._publish_queue
        worker = self._publish_worker_task
        if queue is None or worker is None:
            return
        if not worker.done():
            self._publish_sequence += 1
            await queue.put((2, self._publish_sequence, _PUBLISH_STOP))
            try:
                await worker
            except asyncio.CancelledError:
                pass
        else:
            try:
                worker.result()
            except (asyncio.CancelledError, Exception):
                pass
            self._fail_queued_publishes(RuntimeError("PostgreSQL realtime publisher unavailable"))

    def _fail_queued_publishes(self, exc: BaseException) -> None:
        queue = self._publish_queue
        if queue is None:
            return
        while True:
            try:
                _priority, _sequence, item = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            try:
                if isinstance(item, _QueuedPublish) and not item.future.done():
                    item.future.set_exception(exc)
            finally:
                queue.task_done()

    async def record_presence(self, *, user_id: int, connection_id: str) -> None:
        normalized_user_id = int(user_id or 0)
        normalized_connection_id = str(connection_id or "").strip()
        if normalized_user_id <= 0 or not normalized_connection_id or not self.started:
            return
        lock = self._presence_lock
        if lock is None:
            return
        try:
            async with lock:
                try:
                    conn = await self._ensure_presence_unlocked()
                    await asyncio.to_thread(
                        self._record_presence_sync,
                        conn,
                        normalized_user_id,
                        normalized_connection_id,
                    )
                except BaseException:
                    await self._close_presence()
                    raise
            self._presence_snapshot[normalized_user_id] = datetime.now(timezone.utc)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "chat.realtime.postgres presence upsert failed error=%s",
                self._current_exception_name(),
            )

    def _record_presence_sync(self, conn, user_id: int, connection_id: str) -> None:
        conn.execute(
            sql.SQL(
                "INSERT INTO {} (node_id, connection_id, user_id, touched_at, expires_at) "
                "VALUES (%s, %s, %s, NOW(), NOW() + (%s * INTERVAL '1 second')) "
                "ON CONFLICT (node_id, connection_id) DO UPDATE SET "
                "user_id = EXCLUDED.user_id, touched_at = EXCLUDED.touched_at, "
                "expires_at = EXCLUDED.expires_at"
            ).format(self._qualified_presence_table()),
            (self.node_id, connection_id, int(user_id), int(self._presence_ttl_sec)),
        )

    async def clear_presence(self, *, user_id: int, connection_id: str) -> None:
        normalized_user_id = int(user_id or 0)
        normalized_connection_id = str(connection_id or "").strip()
        if not normalized_connection_id or not self.started:
            return
        lock = self._presence_lock
        if lock is None:
            return
        try:
            async with lock:
                try:
                    conn = await self._ensure_presence_unlocked()
                    still_online = await asyncio.to_thread(
                        self._clear_presence_sync,
                        conn,
                        normalized_user_id,
                        normalized_connection_id,
                    )
                except BaseException:
                    await self._close_presence()
                    raise
            if not still_online:
                self._presence_snapshot.pop(normalized_user_id, None)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "chat.realtime.postgres presence delete failed error=%s",
                self._current_exception_name(),
            )

    def _clear_presence_sync(self, conn, user_id: int, connection_id: str) -> bool:
        conn.execute(
            sql.SQL("DELETE FROM {} WHERE node_id = %s AND connection_id = %s").format(
                self._qualified_presence_table()
            ),
            (self.node_id, connection_id),
        )
        cursor = conn.execute(
            sql.SQL(
                "SELECT 1 FROM {} WHERE user_id = %s AND expires_at > NOW() LIMIT 1"
            ).format(self._qualified_presence_table()),
            (int(user_id),),
        )
        return cursor.fetchone() is not None

    def load_presence_snapshot(
        self,
        user_ids: list[int] | set[int] | tuple[int, ...] | None = None,
    ) -> dict[int, datetime]:
        normalized = {int(item) for item in list(user_ids or []) if int(item) > 0}
        snapshot = dict(self._presence_snapshot)
        if not normalized:
            return snapshot
        return {user_id: stamp for user_id, stamp in snapshot.items() if user_id in normalized}

    def _encode_event(self, payload: dict) -> str:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
        encoded_bytes = encoded.encode("utf-8")
        if len(encoded_bytes) > self._max_event_bytes:
            raise ValueError(
                f"Chat realtime event exceeds CHAT_POSTGRES_MAX_EVENT_BYTES ({len(encoded_bytes)} bytes)"
            )
        return encoded

    async def _run_listener(self) -> None:
        reconnect_attempt = 0
        try:
            while not self._is_stopping():
                try:
                    await self._connect_listener()
                    reconnect_attempt = 0
                    while not self._is_stopping():
                        if self._reconnect_event is not None and self._reconnect_event.is_set():
                            self._reconnect_event.clear()
                            raise ConnectionError("PostgreSQL realtime reconnect requested")
                        await self._wait_for_notification()
                        await self._drain_relay()
                        await self._refresh_presence_if_due()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self._subscriber_ready = False
                    await self._close_listener()
                    if self._is_stopping():
                        return
                    logger.warning(
                        "chat.realtime.postgres listener unavailable; reconnecting error=%s",
                        self._current_exception_name(),
                    )
                    await self._wait_before_reconnect(reconnect_attempt)
                    reconnect_attempt += 1
        finally:
            self._subscriber_ready = False
            await self._close_listener()

    async def _connect_listener(self) -> None:
        await self._close_listener()
        lock = self._publisher_lock
        if lock is None:
            raise RuntimeError("PostgreSQL realtime transport is stopping")
        async with lock:
            await self._ensure_publisher_unlocked()
        listener = await asyncio.to_thread(
            self._open_connection_sync,
            "itinvent-chat-realtime-listener",
        )
        try:
            if self._cursor is None:
                self._cursor = await asyncio.to_thread(
                    self._load_max_event_id_sync,
                    listener,
                )
            await asyncio.to_thread(
                listener.execute,
                sql.SQL("LISTEN {}").format(sql.Identifier(self._channel)),
            )
        except BaseException:
            await self._close_connection(listener)
            raise
        self._listener_conn = listener
        # Catch relay rows inserted between the initial MAX(id) and LISTEN.
        await self._drain_relay()
        await self._refresh_presence(force=True)
        self._subscriber_ready = True

    def _load_max_event_id_sync(self, conn) -> int:
        cursor = conn.execute(
            sql.SQL("SELECT COALESCE(MAX(id), 0) FROM {}").format(
                self._qualified_relay_table()
            )
        )
        row = cursor.fetchone()
        return int(row[0] or 0)

    async def _wait_for_notification(self) -> None:
        conn = self._listener_conn
        if conn is None or bool(getattr(conn, "closed", False)):
            raise ConnectionError("PostgreSQL LISTEN connection is closed")
        raw_payload = await asyncio.to_thread(self._wait_for_notification_sync, conn)
        if not raw_payload:
            return
        try:
            notification = json.loads(raw_payload)
            event = notification.get("event") if isinstance(notification, dict) else None
            if (
                isinstance(event, dict)
                and str(event.get("origin_node_id") or "").strip() != self.node_id
            ):
                await self._manager.handle_distributed_event(event)
        except Exception:
            logger.warning("chat.realtime.postgres malformed inline notification skipped")

    def _wait_for_notification_sync(self, conn) -> str | None:
        for notification in conn.notifies(timeout=self._poll_sec, stop_after=1):
            return str(getattr(notification, "payload", "") or "")
        return None

    async def _drain_relay(self) -> None:
        conn = self._listener_conn
        if conn is None or bool(getattr(conn, "closed", False)):
            raise ConnectionError("PostgreSQL LISTEN connection is closed")
        self._relay_caught_up = False
        for _batch in range(10):
            rows = await asyncio.to_thread(
                self._fetch_relay_rows_sync,
                conn,
                int(self._cursor or 0),
            )
            if not rows:
                self._relay_current_batch_size = 0
                self._relay_caught_up = True
                return
            self._relay_last_batch_size = len(rows)
            self._relay_current_batch_size = len(rows)
            try:
                await self._deliver_rows(rows)
            finally:
                self._relay_current_batch_size = 0
            if len(rows) < self._batch_size:
                self._relay_caught_up = True
                return

    def _fetch_relay_rows_sync(self, conn, cursor_id: int) -> list[tuple]:
        cursor = conn.execute(
            sql.SQL(
                "SELECT id, origin_node_id, payload_json, created_at FROM {} "
                "WHERE id > %s ORDER BY id ASC LIMIT %s"
            ).format(self._qualified_relay_table()),
            (int(cursor_id), int(self._batch_size)),
        )
        return list(cursor.fetchall())

    async def _deliver_rows(self, rows: list[tuple]) -> None:
        if not rows:
            return
        outcomes: dict[int, Exception | None] = {}
        lanes: dict[str, list[tuple[int, dict, Any]]] = {}
        for row in rows:
            event_id = int(row[0])
            origin_node_id = str(row[1] or "").strip()
            if origin_node_id == self.node_id:
                outcomes[event_id] = None
                continue
            try:
                payload = json.loads(str(row[2] or "{}"))
                if not isinstance(payload, dict):
                    raise ValueError("relay payload must be a JSON object")
                payload.setdefault("_realtime_event_id", f"postgres:{event_id}")
            except Exception:
                # Rows are produced only by this service. A poison row must not
                # permanently block every later realtime event.
                logger.error(
                    "chat.realtime.postgres invalid relay row id=%s; skipped",
                    event_id,
                )
                outcomes[event_id] = None
                continue
            lane = self._delivery_lane(payload)
            created_at = row[3] if len(row) > 3 else None
            lanes.setdefault(lane, []).append((event_id, payload, created_at))

        semaphore = asyncio.Semaphore(self._delivery_concurrency)

        async def _deliver_lane(items: list[tuple[int, dict, Any]]) -> None:
            async with semaphore:
                for event_id, payload, created_at in items:
                    try:
                        self._record_relay_db_dispatch_lag(created_at)
                        await self._manager.handle_distributed_event(payload)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        outcomes[event_id] = exc
                        # Do not overtake the failed event inside one conversation.
                        return
                    outcomes[event_id] = None

        if lanes:
            await asyncio.gather(*[_deliver_lane(items) for items in lanes.values()])

        first_error: Exception | None = None
        for row in rows:
            event_id = int(row[0])
            if event_id not in outcomes:
                break
            outcome = outcomes[event_id]
            if outcome is not None:
                first_error = outcome
                break
            self._cursor = event_id
        if first_error is not None:
            raise first_error

    def _record_relay_db_dispatch_lag(self, created_at: Any) -> None:
        if not isinstance(created_at, datetime):
            return
        normalized = created_at
        if normalized.tzinfo is None:
            normalized = normalized.replace(tzinfo=timezone.utc)
        lag_ms = max(
            0.0,
            (datetime.now(timezone.utc) - normalized.astimezone(timezone.utc)).total_seconds()
            * 1000.0,
        )
        self._relay_db_dispatch_lag_ms_latest = lag_ms
        self._relay_db_dispatch_lag_ms_samples.append(lag_ms)
        if len(self._relay_db_dispatch_lag_ms_samples) > 512:
            del self._relay_db_dispatch_lag_ms_samples[:-512]

    @staticmethod
    def _percentile(samples: list[float], percentile: int) -> float:
        if not samples:
            return 0.0
        ordered = sorted(float(item) for item in samples)
        rank = (len(ordered) - 1) * min(100, max(0, int(percentile))) / 100.0
        lower = int(rank)
        upper = min(len(ordered) - 1, lower + 1)
        if lower == upper:
            return ordered[lower]
        fraction = rank - lower
        return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction

    @staticmethod
    def _delivery_lane(payload: dict) -> str:
        nested = payload.get("payload")
        nested_payload = nested if isinstance(nested, dict) else {}
        conversation_id = str(
            payload.get("conversation_id")
            or nested_payload.get("conversation_id")
            or ""
        ).strip()
        if conversation_id:
            return f"conversation:{conversation_id}"
        raw_target_user_ids = payload.get("target_user_ids")
        target_user_ids = {
            int(item)
            for item in list(raw_target_user_ids or [])
            if str(item or "").strip() and int(item) > 0
        }
        direct_target_user_id = int(
            payload.get("target_user_id")
            or nested_payload.get("target_user_id")
            or 0
        )
        if direct_target_user_id > 0:
            target_user_ids.add(direct_target_user_id)
        if len(target_user_ids) == 1:
            return f"user:{next(iter(target_user_ids))}"
        watched_user_id = int(
            payload.get("watched_user_id")
            or nested_payload.get("watched_user_id")
            or 0
        )
        if watched_user_id > 0:
            return f"user:{watched_user_id}"
        # Truly global or multi-target events share one lane so their original
        # relay order remains deterministic.
        return "global"

    async def _ensure_publisher_unlocked(self):
        conn = self._publisher_conn
        if conn is not None and not bool(getattr(conn, "closed", False)):
            return conn
        conn = await asyncio.to_thread(
            self._open_connection_sync,
            "itinvent-chat-realtime-publisher",
        )
        try:
            await asyncio.to_thread(self._ensure_relay_table_sync, conn)
        except BaseException:
            await self._close_connection(conn)
            raise
        self._publisher_conn = conn
        self._publisher_ready = True
        return conn

    async def _ensure_presence_unlocked(self):
        conn = self._presence_conn
        if conn is not None and not bool(getattr(conn, "closed", False)):
            return conn
        conn = await asyncio.to_thread(
            self._open_connection_sync,
            "itinvent-chat-realtime-presence",
        )
        try:
            await asyncio.to_thread(self._ensure_relay_table_sync, conn)
        except BaseException:
            await self._close_connection(conn)
            raise
        self._presence_conn = conn
        return conn

    def _open_connection_sync(self, application_name: str):
        if psycopg is None:
            raise RuntimeError("psycopg is unavailable")
        return psycopg.Connection.connect(
            _psycopg_conninfo(self._database_url),
            autocommit=True,
            connect_timeout=max(1, int(os.getenv("CHAT_POSTGRES_CONNECT_TIMEOUT_SEC", "3") or 3)),
            application_name=application_name,
        )

    def _ensure_relay_table_sync(self, conn) -> None:
        schema_cursor = conn.execute(
            "SELECT CASE WHEN to_regclass('chat.chat_conversations') IS NOT NULL "
            "THEN 'chat' ELSE COALESCE(current_schema(), 'public') END"
        )
        schema_row = schema_cursor.fetchone()
        self._schema = str(schema_row[0] or "public").strip() or "public"
        table = self._qualified_relay_table()
        conn.execute(
            sql.SQL(
                "CREATE TABLE IF NOT EXISTS {} ("
                "id BIGSERIAL PRIMARY KEY, "
                "origin_node_id VARCHAR(128) NOT NULL, "
                "payload_json TEXT NOT NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
                "expires_at TIMESTAMPTZ NOT NULL)"
            ).format(table)
        )
        conn.execute(
            sql.SQL(
                "CREATE TABLE IF NOT EXISTS {} ("
                "node_id VARCHAR(128) NOT NULL, "
                "connection_id VARCHAR(64) NOT NULL, "
                "user_id INTEGER NOT NULL, "
                "touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
                "expires_at TIMESTAMPTZ NOT NULL, "
                "PRIMARY KEY (node_id, connection_id))"
            ).format(self._qualified_presence_table())
        )
        conn.execute(
            sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} (user_id, expires_at)").format(
                sql.Identifier("ix_chat_realtime_presence_user_expires"),
                self._qualified_presence_table(),
            )
        )
        conn.execute(
            sql.SQL("CREATE INDEX IF NOT EXISTS {} ON {} (expires_at)").format(
                sql.Identifier(f"ix_{self._relay_table}_expires_at"),
                table,
            )
        )

    def _cleanup_expired_sync(self, conn) -> None:
        try:
            conn.execute(
                sql.SQL(
                    "DELETE FROM {} WHERE id IN ("
                    "SELECT id FROM {} WHERE expires_at < NOW() ORDER BY id ASC LIMIT 1000)"
                ).format(self._qualified_relay_table(), self._qualified_relay_table())
            )
            conn.execute(
                sql.SQL("DELETE FROM {} WHERE expires_at < NOW()").format(
                    self._qualified_presence_table()
                )
            )
        except Exception:
            logger.warning(
                "chat.realtime.postgres relay cleanup failed error=%s",
                self._current_exception_name(),
            )

    def _qualified_relay_table(self):
        if sql is None:
            raise RuntimeError("psycopg SQL helpers are unavailable")
        return sql.Identifier(self._schema, self._relay_table)

    def _qualified_presence_table(self):
        if sql is None:
            raise RuntimeError("psycopg SQL helpers are unavailable")
        return sql.Identifier(self._schema, "chat_realtime_presence")

    async def _refresh_presence_if_due(self) -> None:
        now = asyncio.get_running_loop().time()
        if now - self._last_presence_refresh_at < self._presence_refresh_sec:
            return
        await self._refresh_presence(force=False)

    async def _refresh_presence(self, *, force: bool) -> None:
        conn = self._listener_conn
        if conn is None or bool(getattr(conn, "closed", False)):
            return
        now = asyncio.get_running_loop().time()
        if not force and now - self._last_presence_refresh_at < self._presence_refresh_sec:
            return
        rows = await asyncio.to_thread(
            self._load_presence_rows_sync,
            conn,
        )
        snapshot: dict[int, datetime] = {}
        for user_id, touched_at in rows:
            if isinstance(touched_at, datetime):
                if touched_at.tzinfo is None:
                    touched_at = touched_at.replace(tzinfo=timezone.utc)
                snapshot[int(user_id)] = touched_at.astimezone(timezone.utc)
        self._presence_snapshot = snapshot
        self._last_presence_refresh_at = now

    def _load_presence_rows_sync(self, conn) -> list[tuple]:
        cursor = conn.execute(
            sql.SQL(
                "SELECT user_id, MAX(touched_at) FROM {} "
                "WHERE expires_at > NOW() GROUP BY user_id"
            ).format(self._qualified_presence_table())
        )
        return list(cursor.fetchall())

    async def _clear_node_presence(self) -> None:
        lock = self._presence_lock
        if lock is None or self._presence_conn is None:
            self._presence_snapshot.clear()
            return
        try:
            async with lock:
                conn = await self._ensure_presence_unlocked()
                await asyncio.to_thread(
                    self._clear_node_presence_sync,
                    conn,
                )
        except Exception:
            logger.warning(
                "chat.realtime.postgres node presence cleanup failed error=%s",
                self._current_exception_name(),
            )
        finally:
            self._presence_snapshot.clear()

    def _clear_node_presence_sync(self, conn) -> None:
        conn.execute(
            sql.SQL("DELETE FROM {} WHERE node_id = %s").format(
                self._qualified_presence_table()
            ),
            (self.node_id,),
        )

    def _mark_unavailable(self) -> None:
        self._subscriber_ready = False
        self._publisher_ready = False

    def _is_stopping(self) -> bool:
        return bool(self._stop_event is not None and self._stop_event.is_set())

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

    async def _close_clients(self) -> None:
        await self._close_listener()
        await self._close_publisher()
        await self._close_presence()

    async def _close_listener(self) -> None:
        conn, self._listener_conn = self._listener_conn, None
        await self._close_connection(conn)

    async def _close_publisher(self) -> None:
        conn, self._publisher_conn = self._publisher_conn, None
        await self._close_connection(conn)

    async def _close_presence(self) -> None:
        conn, self._presence_conn = self._presence_conn, None
        await self._close_connection(conn)

    @staticmethod
    async def _close_connection(conn) -> None:
        if conn is None:
            return
        try:
            await asyncio.to_thread(conn.close)
        except Exception:
            pass

    @staticmethod
    def _current_exception_name() -> str:
        import sys

        exc = sys.exc_info()[1]
        return exc.__class__.__name__ if exc is not None else "UnknownError"
