from __future__ import annotations

import asyncio
import importlib
import json
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

postgres_module = importlib.import_module("backend.chat.postgres_realtime")
realtime_module = importlib.import_module("backend.chat.realtime")


class _Manager:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def handle_distributed_event(self, payload):
        self.events.append(dict(payload))


def _bus(manager=None) -> postgres_module.ChatRealtimePostgresBus:
    return postgres_module.ChatRealtimePostgresBus(
        manager or _Manager(),
        database_url="postgresql+psycopg://user:password@localhost/chat",
        node_id="node-a",
    )


def test_relay_keeps_large_event_out_of_notify_payload(monkeypatch):
    bus = _bus()
    inserted_batches: list[list[tuple]] = []
    notifications: list[tuple] = []
    operations: list[str] = []

    class _Transaction:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            operations.append("commit")
            return False

    class _Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def execute(self, _query, params):
            operations.append("insert")
            inserted_batches.append(list(params))

    class _Connection:
        def transaction(self):
            return _Transaction()

        def cursor(self):
            return _Cursor()

        def execute(self, _query, params=None):
            if "LOCK TABLE" in str(_query):
                assert "SHARE ROW EXCLUSIVE" in str(_query)
                operations.append("lock")
                return
            operations.append("notify")
            notifications.append(tuple(params or ()))

    event = {
        "origin_node_id": "node-a",
        "distribution": "global",
        "event_type": "chat.message.created",
        "payload": {"body": "я" * 10_000},
    }
    encoded = bus._encode_event(event)

    bus._publish_batch_sync(_Connection(), [(bus.node_id, encoded, 86400)])

    assert len(inserted_batches) == 1
    assert operations == ["lock", "insert", "notify", "commit"]
    assert inserted_batches[0][0] == [bus.node_id]
    assert json.loads(inserted_batches[0][1][0]) == event
    assert len(inserted_batches[0][1][0].encode("utf-8")) > 8_000
    assert inserted_batches[0][2] == [86400]
    assert len(notifications) == 1
    assert json.loads(notifications[0][1]) == {"batch": 1}
    assert len(notifications[0][1].encode("utf-8")) < 8_000


def test_small_volatile_event_uses_bounded_batch_relay(monkeypatch):
    bus = _bus()
    batches: list[list[postgres_module._QueuedPublish]] = []

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    async def _flush(batch):
        batches.append(list(batch))

    monkeypatch.setattr(bus, "_run_listener", _listener)
    monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
    event = {
        "origin_node_id": "node-a",
        "event_type": "chat.typing.started",
        "payload": {"user_id": 7},
    }

    async def _run():
        await bus.start()
        assert await bus.publish(event, durable=False) is True
        await bus.stop()

    asyncio.run(_run())

    assert len(batches) == 1
    assert json.loads(batches[0][0].encoded) == event
    assert batches[0][0].retention_sec == 300


def test_durable_publisher_batches_and_resolves_each_future(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "64")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_FLUSH_MS", "20")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "256")
    bus = _bus()
    batches: list[list[str]] = []

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    async def _flush(batch):
        batches.append([request.encoded for request in batch])

    monkeypatch.setattr(bus, "_run_listener", _listener)
    monkeypatch.setattr(bus, "_flush_publish_batch", _flush)

    async def _run():
        await bus.start()
        results = await asyncio.gather(
            *[
                bus.publish({"event_type": "chat.message.created", "payload": {"n": index}})
                for index in range(130)
            ]
        )
        assert bus.available is True
        await bus.stop()
        return results

    results = asyncio.run(_run())

    assert results == [True] * 130
    assert sum(len(batch) for batch in batches) == 130
    assert all(1 <= len(batch) <= 64 for batch in batches)
    assert len(batches) <= 3


def test_durable_publisher_applies_bounded_queue_backpressure(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "2")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_CRITICAL_RESERVE", "1")
    bus = _bus()

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        flush_started = asyncio.Event()
        release_flush = asyncio.Event()

        async def _flush(_batch):
            flush_started.set()
            await release_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(bus.publish({"event_type": "chat.message.updated", "payload": {"n": 1}}))
        await asyncio.wait_for(flush_started.wait(), timeout=0.2)
        second = asyncio.create_task(bus.publish({"event_type": "chat.message.updated", "payload": {"n": 2}}))
        await asyncio.sleep(0)
        with pytest.raises(postgres_module.ChatRealtimePublishBackpressure):
            await bus.publish({"event_type": "chat.message.updated", "payload": {"n": 3}})
        release_flush.set()
        assert await asyncio.gather(first, second) == [True, True]
        await bus.stop()

    asyncio.run(_run())


def test_background_durable_events_cannot_consume_message_created_reserve(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "4")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_CRITICAL_RESERVE", "1")
    bus = _bus()
    flush_order: list[str] = []

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        first_flush_started = asyncio.Event()
        release_first_flush = asyncio.Event()

        async def _flush(batch):
            event_type = json.loads(batch[0].encoded)["event_type"]
            flush_order.append(event_type)
            if len(flush_order) == 1:
                first_flush_started.set()
                await release_first_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(bus.publish({"event_type": "chat.message.updated"}))
        await asyncio.wait_for(first_flush_started.wait(), timeout=0.2)
        queued_background = [
            asyncio.create_task(bus.publish({"event_type": "chat.message.updated", "n": index}))
            for index in range(3)
        ]
        while bus.publish_queue_depth < 3:
            await asyncio.sleep(0)

        with pytest.raises(postgres_module.ChatRealtimePublishBackpressure):
            await bus.publish({"event_type": "chat.message.updated", "n": 99})

        critical = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "id": "m1"}))
        await asyncio.sleep(0)
        assert bus.publish_queue_depth == 4
        release_first_flush.set()
        assert await asyncio.gather(first, critical, *queued_background) == [True] * 5
        await bus.stop()

    asyncio.run(_run())

    assert flush_order[:2] == ["chat.message.updated", "chat.message.created"]


def test_message_created_waits_for_a_queue_slot_instead_of_being_dropped(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "2")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_CRITICAL_WAITERS", "1")
    bus = _bus()

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        first_flush_started = asyncio.Event()
        release_first_flush = asyncio.Event()

        async def _flush(_batch):
            if not first_flush_started.is_set():
                first_flush_started.set()
                await release_first_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 1}))
        await asyncio.wait_for(first_flush_started.wait(), timeout=0.2)
        second = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 2}))
        third = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 3}))
        while bus.publish_queue_depth < 2:
            await asyncio.sleep(0)

        waiting = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 4}))
        await asyncio.sleep(0.01)
        assert waiting.done() is False
        assert bus.publish_critical_waiters == 1

        release_first_flush.set()
        assert await asyncio.gather(first, second, third, waiting) == [True] * 4
        await bus.stop()

    asyncio.run(_run())


def test_message_created_waiters_are_bounded_and_overflow_fails_loudly(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_CRITICAL_WAITERS", "1")
    bus = _bus()

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        first_flush_started = asyncio.Event()
        release_first_flush = asyncio.Event()

        async def _flush(_batch):
            if not first_flush_started.is_set():
                first_flush_started.set()
                await release_first_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 1}))
        await asyncio.wait_for(first_flush_started.wait(), timeout=0.2)
        queued = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 2}))
        while bus.publish_queue_depth < 1:
            await asyncio.sleep(0)
        waiting = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 3}))
        while bus.publish_critical_waiters < 1:
            await asyncio.sleep(0)

        with pytest.raises(postgres_module.ChatRealtimePublishBackpressure, match="waiter limit"):
            await bus.publish({"event_type": "chat.message.created", "n": 4})

        release_first_flush.set()
        assert await asyncio.gather(first, queued, waiting) == [True] * 3
        await bus.stop()

    asyncio.run(_run())


def test_publisher_metrics_separate_critical_and_background_queue_wait(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "8")
    bus = _bus()

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        first_flush_started = asyncio.Event()
        release_first_flush = asyncio.Event()

        async def _flush(_batch):
            if not first_flush_started.is_set():
                first_flush_started.set()
                await release_first_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(bus.publish({"event_type": "chat.message.updated", "n": 1}))
        await asyncio.wait_for(first_flush_started.wait(), timeout=0.2)
        background = asyncio.create_task(bus.publish({"event_type": "chat.message.updated", "n": 2}))
        critical = asyncio.create_task(bus.publish({"event_type": "chat.message.created", "n": 3}))
        await asyncio.sleep(0.02)
        release_first_flush.set()
        assert await asyncio.gather(first, background, critical) == [True] * 3
        await bus.stop()

    asyncio.run(_run())

    assert bus.publish_batches_total == 3
    assert bus.publish_events_total == 3
    assert bus.publish_critical_total == 1
    assert bus.publish_background_total == 2
    assert bus.publish_queue_wait_ms_critical_p95 >= 10
    assert bus.publish_queue_wait_ms_background_max >= 10


def test_volatile_flood_preserves_capacity_and_priority_for_durable(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_BATCH_MAX", "1")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "8")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_DURABLE_RESERVE", "2")
    bus = _bus()
    flush_order: list[str] = []

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        first_flush_started = asyncio.Event()
        release_first_flush = asyncio.Event()

        async def _flush(batch):
            event_type = json.loads(batch[0].encoded)["event_type"]
            flush_order.append(event_type)
            if len(flush_order) == 1:
                first_flush_started.set()
                await release_first_flush.wait()

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        first = asyncio.create_task(
            bus.publish({"event_type": "chat.typing.started", "payload": {"n": 0}}, durable=False)
        )
        await asyncio.wait_for(first_flush_started.wait(), timeout=0.2)
        queued_volatile = [
            asyncio.create_task(
                bus.publish(
                    {"event_type": "chat.typing.started", "payload": {"n": index}},
                    durable=False,
                )
            )
            for index in range(1, 7)
        ]
        deadline = asyncio.get_running_loop().time() + 0.2
        while bus.publish_queue_depth < 6 and asyncio.get_running_loop().time() < deadline:
            await asyncio.sleep(0)
        assert bus.publish_queue_depth == 6
        assert await bus.publish(
            {"event_type": "chat.typing.started", "payload": {"n": 99}},
            durable=False,
        ) is True
        assert bus.publish_volatile_dropped == 1
        durable = asyncio.create_task(
            bus.publish({"event_type": "chat.message.created", "payload": {"id": "m1"}})
        )
        await asyncio.sleep(0)
        assert bus.publish_queue_depth == 7
        release_first_flush.set()
        assert await asyncio.gather(first, durable, *queued_volatile) == [True] * 8
        await bus.stop()

    asyncio.run(_run())

    assert flush_order[0] == "chat.typing.started"
    assert flush_order[1] == "chat.message.created"
    assert flush_order.count("chat.typing.started") == 7


def test_publish_batch_failure_propagates_and_worker_recovers(monkeypatch):
    bus = _bus()
    calls = 0

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    async def _flush(_batch):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ConnectionError("batch failed")
        bus._publisher_ready = True

    monkeypatch.setattr(bus, "_run_listener", _listener)
    monkeypatch.setattr(bus, "_flush_publish_batch", _flush)

    async def _run():
        await bus.start()
        with pytest.raises(ConnectionError, match="batch failed"):
            await bus.publish({"event_type": "chat.message.created", "payload": {"n": 1}})
        assert await bus.publish({"event_type": "chat.message.created", "payload": {"n": 2}}) is True
        await bus.stop()

    asyncio.run(_run())

    assert calls == 2


def test_stop_drains_accepted_durable_publishes(monkeypatch):
    bus = _bus()
    flushed: list[int] = []

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_run_listener", _listener)

    async def _run():
        flush_started = asyncio.Event()
        release_flush = asyncio.Event()

        async def _flush(batch):
            flush_started.set()
            await release_flush.wait()
            flushed.append(len(batch))

        monkeypatch.setattr(bus, "_flush_publish_batch", _flush)
        await bus.start()
        publishes = [
            asyncio.create_task(
                bus.publish({"event_type": "chat.message.created", "payload": {"n": index}})
            )
            for index in range(10)
        ]
        await asyncio.wait_for(flush_started.wait(), timeout=0.2)
        stop_task = asyncio.create_task(bus.stop())
        await asyncio.sleep(0)
        assert stop_task.done() is False
        release_flush.set()
        assert await asyncio.gather(*publishes) == [True] * 10
        await asyncio.wait_for(stop_task, timeout=0.5)

    asyncio.run(_run())

    assert sum(flushed) == 10


def test_relay_suppresses_self_echo_and_advances_cursor():
    manager = _Manager()
    bus = _bus(manager)

    async def _run():
        await bus._deliver_rows(
            [
                (1, "node-a", json.dumps({"event_type": "self"})),
                (2, "node-b", json.dumps({"event_type": "remote"})),
            ]
        )

    asyncio.run(_run())

    assert manager.events == [
        {"event_type": "remote", "_realtime_event_id": "postgres:2"}
    ]
    assert bus._cursor == 2


def test_relay_adds_stable_event_id_for_node_deduplication():
    manager = _Manager()
    bus = _bus(manager)

    asyncio.run(
        bus._deliver_rows(
            [(42, "node-b", json.dumps({"event_type": "chat.message.created"}))]
        )
    )

    assert manager.events[0]["_realtime_event_id"] == "postgres:42"


def test_relay_does_not_advance_cursor_when_handler_fails():
    class _FailingManager:
        async def handle_distributed_event(self, _payload):
            raise RuntimeError("handler failed")

    bus = _bus(_FailingManager())
    bus._cursor = 4

    with pytest.raises(RuntimeError, match="handler failed"):
        asyncio.run(bus._deliver_rows([(5, "node-b", "{\"event_type\":\"remote\"}")]))

    assert bus._cursor == 4


def test_relay_parallelizes_independent_conversations_but_preserves_each_order():
    class _TrackingManager:
        def __init__(self):
            self.active = 0
            self.max_active = 0
            self.delivered: dict[str, list[int]] = {}

        async def handle_distributed_event(self, payload):
            conversation_id = str(payload["conversation_id"])
            sequence = int(payload["payload"]["sequence"])
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            try:
                if sequence == 1:
                    await asyncio.sleep(0.02)
                self.delivered.setdefault(conversation_id, []).append(sequence)
            finally:
                self.active -= 1

    manager = _TrackingManager()
    bus = _bus(manager)
    rows = [
        (
            1,
            "node-b",
            json.dumps({"conversation_id": "conversation-a", "payload": {"sequence": 1}}),
        ),
        (
            2,
            "node-b",
            json.dumps({"conversation_id": "conversation-b", "payload": {"sequence": 1}}),
        ),
        (
            3,
            "node-b",
            json.dumps({"conversation_id": "conversation-a", "payload": {"sequence": 2}}),
        ),
        (
            4,
            "node-b",
            json.dumps({"conversation_id": "conversation-b", "payload": {"sequence": 2}}),
        ),
    ]

    asyncio.run(bus._deliver_rows(rows))

    assert manager.max_active == 2
    assert manager.delivered == {
        "conversation-a": [1, 2],
        "conversation-b": [1, 2],
    }
    assert bus._cursor == 4


def test_relay_parallelizes_single_user_inbox_lanes_but_preserves_user_order():
    class _TrackingManager:
        def __init__(self):
            self.active = 0
            self.max_active = 0
            self.delivered: dict[int, list[int]] = {}

        async def handle_distributed_event(self, payload):
            user_id = int(payload["target_user_ids"][0])
            sequence = int(payload["payload"]["sequence"])
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            try:
                if sequence == 1:
                    await asyncio.sleep(0.02)
                self.delivered.setdefault(user_id, []).append(sequence)
            finally:
                self.active -= 1

    manager = _TrackingManager()
    bus = _bus(manager)
    rows = [
        (1, "node-b", json.dumps({"distribution": "inbox", "target_user_ids": [7], "payload": {"sequence": 1}})),
        (2, "node-b", json.dumps({"distribution": "inbox", "target_user_ids": [8], "payload": {"sequence": 1}})),
        (3, "node-b", json.dumps({"distribution": "inbox", "target_user_ids": [7], "payload": {"sequence": 2}})),
        (4, "node-b", json.dumps({"distribution": "inbox", "target_user_ids": [8], "payload": {"sequence": 2}})),
    ]

    asyncio.run(bus._deliver_rows(rows))

    assert manager.max_active == 2
    assert manager.delivered == {7: [1, 2], 8: [1, 2]}
    assert bus._cursor == 4


def test_relay_delivery_parallelism_is_bounded(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_DELIVERY_CONCURRENCY", "2")

    class _TrackingManager:
        def __init__(self):
            self.active = 0
            self.max_active = 0

        async def handle_distributed_event(self, _payload):
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            try:
                await asyncio.sleep(0.01)
            finally:
                self.active -= 1

    manager = _TrackingManager()
    bus = _bus(manager)
    rows = [
        (
            event_id,
            "node-b",
            json.dumps({"conversation_id": f"conversation-{event_id}", "payload": {}}),
        )
        for event_id in range(1, 9)
    ]

    asyncio.run(bus._deliver_rows(rows))

    assert manager.max_active == 2
    assert bus._cursor == 8


def test_parallel_relay_failure_advances_only_successful_prefix():
    class _FailingManager:
        def __init__(self):
            self.delivered: list[int] = []

        async def handle_distributed_event(self, payload):
            event_number = int(payload["payload"]["event_number"])
            if event_number == 2:
                raise RuntimeError("conversation-a failed")
            self.delivered.append(event_number)

    manager = _FailingManager()
    bus = _bus(manager)
    rows = [
        (1, "node-b", json.dumps({"conversation_id": "conversation-a", "payload": {"event_number": 1}})),
        (2, "node-b", json.dumps({"conversation_id": "conversation-a", "payload": {"event_number": 2}})),
        (3, "node-b", json.dumps({"conversation_id": "conversation-b", "payload": {"event_number": 3}})),
    ]

    with pytest.raises(RuntimeError, match="conversation-a failed"):
        asyncio.run(bus._deliver_rows(rows))

    assert manager.delivered == [1, 3]
    assert bus._cursor == 1


def test_relay_reads_do_not_compete_for_publisher_lock(monkeypatch):
    bus = _bus()
    listener = type("Listener", (), {"closed": False})()
    bus._listener_conn = listener
    bus._publisher_lock = asyncio.Lock()
    seen_connections: list[object] = []

    def _fetch(conn, _cursor_id):
        seen_connections.append(conn)
        return []

    monkeypatch.setattr(bus, "_fetch_relay_rows_sync", _fetch)

    async def _run():
        await bus._publisher_lock.acquire()
        try:
            await asyncio.wait_for(bus._drain_relay(), timeout=0.2)
        finally:
            bus._publisher_lock.release()

    asyncio.run(_run())

    assert seen_connections == [listener]


def test_relay_metrics_show_cursor_catchup_batch_and_database_dispatch_lag(monkeypatch):
    dispatch_started = asyncio.Event()
    release_dispatch = asyncio.Event()

    class _BlockingManager:
        async def handle_distributed_event(self, _payload):
            dispatch_started.set()
            await release_dispatch.wait()

    bus = _bus(_BlockingManager())
    bus._listener_conn = type("Listener", (), {"closed": False})()
    created_at = postgres_module.datetime.now(postgres_module.timezone.utc) - timedelta(seconds=2)
    fetches = [
        [(7, "node-b", json.dumps({"event_type": "chat.message.created"}), created_at)],
        [],
    ]

    monkeypatch.setattr(bus, "_fetch_relay_rows_sync", lambda *_args: fetches.pop(0))

    async def _run():
        drain = asyncio.create_task(bus._drain_relay())
        await asyncio.wait_for(dispatch_started.wait(), timeout=0.2)
        assert bus.relay_current_batch_size == 1
        assert bus.relay_caught_up is False
        release_dispatch.set()
        await drain

    asyncio.run(_run())

    assert bus.relay_cursor == 7
    assert bus.relay_current_batch_size == 0
    assert bus.relay_last_batch_size == 1
    assert bus.relay_caught_up is True
    assert bus.relay_db_dispatch_lag_ms_latest >= 1900
    assert bus.relay_db_dispatch_lag_ms_p95 >= 1900
    assert bus.relay_db_dispatch_lag_ms_max >= 1900


def test_event_size_cap_fails_loudly(monkeypatch):
    bus = _bus()
    bus._max_event_bytes = 8192

    with pytest.raises(ValueError, match="CHAT_POSTGRES_MAX_EVENT_BYTES"):
        bus._encode_event({"payload": "x" * 9000})


def test_publish_error_does_not_log_database_secret(monkeypatch, caplog):
    bus = _bus()

    async def _listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        await asyncio.Event().wait()

    async def _fail(_batch):
        raise RuntimeError("postgresql://user:super-secret@server/database")

    monkeypatch.setattr(bus, "_run_listener", _listener)
    monkeypatch.setattr(bus, "_flush_publish_batch", _fail)

    async def _run():
        await bus.start()
        with pytest.raises(RuntimeError):
            await bus.publish({"event_type": "chat.message.created"})
        await bus.stop()

    with caplog.at_level(logging.WARNING, logger="backend.chat.postgres_realtime"):
        asyncio.run(_run())

    assert "super-secret" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_postgres_reconnect_delay_uses_backoff_jitter_and_cap(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_BASE_SEC", "1")
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_MAX_SEC", "5")
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_JITTER_RATIO", "0.5")
    monkeypatch.setattr(postgres_module.random, "uniform", lambda _low, high: high)
    bus = _bus()

    assert bus._reconnect_delay(0) == 1.5
    assert bus._reconnect_delay(1) == 3.0
    assert bus._reconnect_delay(2) == 5.0
    assert bus._reconnect_delay(10) == 5.0


def test_transport_selection_supports_explicit_and_auto(monkeypatch):
    monkeypatch.setattr(realtime_module.config.redis, "url", "")
    monkeypatch.setattr(
        realtime_module.config.chat,
        "database_url",
        "postgresql+psycopg://user:password@localhost/chat",
    )

    assert realtime_module.resolve_chat_realtime_transport("local") == "local"
    assert realtime_module.resolve_chat_realtime_transport("redis") == "redis"
    assert realtime_module.resolve_chat_realtime_transport("postgres") == "postgres"
    assert realtime_module.resolve_chat_realtime_transport("auto") == "postgres"
    with pytest.raises(ValueError, match="CHAT_REALTIME_TRANSPORT"):
        realtime_module.resolve_chat_realtime_transport("typo")


def test_manager_exposes_common_transport_metrics(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    manager = realtime_module.ChatRealtimeManager()

    metrics = manager.get_metrics()

    assert metrics["realtime_transport"] == "local"
    assert metrics["realtime_configured"] is True
    assert metrics["realtime_available"] is True
    assert metrics["realtime_subscriber_ready"] is True
    assert metrics["publish_queue_depth"] == 0
    assert metrics["publish_queue_capacity"] == 0
    assert metrics["publish_volatile_dropped"] == 0
    assert metrics["publish_critical_waiters"] == 0


def test_manager_exposes_postgres_publish_queue_metrics(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_QUEUE_SIZE", "8")
    manager = realtime_module.ChatRealtimeManager()
    bus = _bus(manager)
    bus._publish_queue = asyncio.PriorityQueue(maxsize=8)
    bus._publish_queue.put_nowait((1, 1, object()))
    bus._critical_waiters = 2
    manager._transport_bus = bus

    metrics = manager.get_metrics()

    assert metrics["publish_queue_depth"] == 1
    assert metrics["publish_queue_capacity"] == 8
    assert metrics["publish_volatile_dropped"] == 0
    assert metrics["publish_critical_waiters"] == 2


def test_manager_deduplicates_replayed_postgres_event(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    manager = realtime_module.ChatRealtimeManager()
    handled: list[str] = []

    async def _handle_once(event):
        handled.append(event["event_type"])

    monkeypatch.setattr(manager, "_handle_distributed_event_once", _handle_once)
    event = {
        "_realtime_event_id": "postgres:123",
        "event_type": "chat.message.created",
    }

    async def _run():
        await manager.handle_distributed_event(dict(event))
        await manager.handle_distributed_event(dict(event))

    asyncio.run(_run())

    assert handled == ["chat.message.created"]


def test_socket_deduplicates_same_durable_event_from_room_and_inbox(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    manager = realtime_module.ChatRealtimeManager()

    class _Socket:
        pass

    connection = realtime_module.ChatRealtimeConnection(
        id="conn-1",
        user_id=7,
        websocket=_Socket(),
    )
    first = manager.build_envelope(
        event_type="chat.message.created",
        conversation_id="conversation-1",
        payload={"id": "message-1", "body": "same"},
    )
    second = dict(first)
    second["sent_at"] = "2099-01-01T00:00:00+00:00"

    async def _run():
        await manager._broadcast_local(
            target_connections=[connection],
            envelope=first,
            durable=True,
            volatile_key=None,
        )
        await manager._broadcast_local(
            target_connections=[connection],
            envelope=second,
            durable=True,
            volatile_key=None,
        )

    asyncio.run(_run())

    assert connection.outbound_queue.qsize() == 1
    assert connection.durable_duplicates_suppressed == 1
    assert manager.get_metrics()["durable_duplicates_suppressed"] == 1


def test_durable_postgres_publish_retries_bounded(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_ATTEMPTS", "3")
    monkeypatch.setenv("CHAT_POSTGRES_PUBLISH_RETRY_BASE_SEC", "0.01")
    monkeypatch.setattr(realtime_module.random, "uniform", lambda *_args: 0.0)
    manager = realtime_module.ChatRealtimeManager()

    class _FlakyBus:
        def __init__(self):
            self.calls = 0

        async def publish(self, _payload, **_kwargs):
            self.calls += 1
            if self.calls < 3:
                raise ConnectionError("temporary failure")
            return True

    flaky = _FlakyBus()
    manager._realtime_transport = "postgres"
    manager._transport_bus = flaky

    asyncio.run(
        manager._publish_transport_with_retry(
            {"event_type": "chat.message.created"},
            durable=True,
        )
    )

    assert flaky.calls == 3


def test_presence_write_does_not_wait_for_relay_publisher_lock(monkeypatch):
    bus = _bus()
    publisher_conn = object()
    presence_conn = object()
    seen_connections: list[object] = []

    monkeypatch.setattr(
        bus,
        "_record_presence_sync",
        lambda conn, _user_id, _connection_id: seen_connections.append(conn),
    )

    async def _run():
        bus._stop_event = asyncio.Event()
        bus._publisher_lock = asyncio.Lock()
        bus._presence_lock = asyncio.Lock()
        bus._publisher_conn = publisher_conn
        bus._presence_conn = presence_conn
        bus._accepting_publishes = True
        await bus._publisher_lock.acquire()
        try:
            await asyncio.wait_for(
                bus.record_presence(user_id=7, connection_id="conn-7"),
                timeout=0.05,
            )
        finally:
            bus._publisher_lock.release()

    asyncio.run(_run())

    assert seen_connections == [presence_conn]


@pytest.mark.parametrize("schema", ["chat", "public"])
def test_production_relay_schema_check_does_not_execute_ddl(monkeypatch, schema):
    from backend.config import config

    monkeypatch.setattr(config.app, "environment", "production")
    bus = _bus()
    queries = []

    class Connection:
        def execute(self, query, params=None):
            queries.append(str(query))
            if params:
                assert params[0] == schema
            return self

        def fetchone(self):
            return (schema,)

        def fetchall(self):
            return [("chat_realtime_events", col) for col in
                    ("id", "origin_node_id", "payload_json", "created_at", "expires_at")] + [
                    ("chat_realtime_presence", col) for col in
                    ("node_id", "connection_id", "user_id", "touched_at", "expires_at")]

    bus._ensure_relay_table_sync(Connection())
    assert queries and all(query.startswith("SELECT") for query in queries)


def test_production_relay_missing_schema_fails_with_migration_instruction(monkeypatch):
    from backend.config import config

    monkeypatch.setattr(config.app, "environment", "production")
    class Connection:
        def execute(self, query, params=None):
            assert str(query).startswith("SELECT")
            return self

        def fetchone(self):
            return ("chat",)

        def fetchall(self):
            return []

    with pytest.raises(RuntimeError, match="Alembic migrations"):
        _bus()._ensure_relay_table_sync(Connection())


def test_publishers_allocate_ids_only_after_previous_writer_commits():
    """Two distinct bus objects share a database lock, not an asyncio lock."""
    writer_lock = threading.Lock()
    allocated = []
    committed = []
    first_insert = threading.Event()
    second_attempt = threading.Event()
    release_first = threading.Event()

    class Connection:
        def __init__(self, name):
            self.name = name
            self.locked = False
            self.pending = []

        def transaction(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            if exc[0] is None:
                committed.extend(self.pending)
            if self.locked:
                writer_lock.release()

        def execute(self, query, params=None):
            if "LOCK TABLE" in str(query):
                if self.name == "second":
                    second_attempt.set()
                assert writer_lock.acquire(timeout=3)
                self.locked = True

        def cursor(self):
            connection = self
            class Cursor:
                def __enter__(self):
                    return self

                def __exit__(self, *_exc):
                    pass

                def execute(self, _query, _params):
                    allocated.append(len(allocated) + 1)
                    connection.pending.append(allocated[-1])
                    if connection.name == "first":
                        first_insert.set()
                        assert release_first.wait(3)
                    else:
                        second_attempt.set()
            return Cursor()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_bus()._publish_batch_sync, Connection("first"), [("first", "{}", 60)])
        try:
            assert first_insert.wait(3)
            second = pool.submit(_bus()._publish_batch_sync, Connection("second"), [("second", "{}", 60)])
            assert second_attempt.wait(3)
            assert allocated == [1]
            assert committed == []
        finally:
            release_first.set()
        first.result(timeout=3)
        second.result(timeout=3)
    assert committed == [1, 2]


def test_presence_connection_reopens_after_write_failure(monkeypatch):
    bus = _bus()
    successful_connections: list[object] = []

    class _Connection:
        def __init__(self, name):
            self.name = name
            self.closed = False

        def close(self):
            self.closed = True

    failed_conn = _Connection("failed")
    healthy_conn = _Connection("healthy")
    connections = [failed_conn, healthy_conn]

    monkeypatch.setattr(bus, "_open_connection_sync", lambda _name: connections.pop(0))
    monkeypatch.setattr(bus, "_ensure_relay_table_sync", lambda _conn: None)

    def _record(conn, _user_id, _connection_id):
        if conn is failed_conn:
            raise ConnectionError("presence connection failed")
        successful_connections.append(conn)

    monkeypatch.setattr(bus, "_record_presence_sync", _record)

    async def _run():
        bus._stop_event = asyncio.Event()
        bus._publisher_lock = asyncio.Lock()
        bus._presence_lock = asyncio.Lock()
        bus._accepting_publishes = True
        await bus.record_presence(user_id=7, connection_id="conn-7")
        await bus.record_presence(user_id=7, connection_id="conn-7")

    asyncio.run(_run())

    assert failed_conn.closed is True
    assert bus._presence_conn is healthy_conn
    assert successful_connections == [healthy_conn]


def test_close_clients_closes_dedicated_presence_connection():
    bus = _bus()

    class _Connection:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    listener = _Connection()
    publisher = _Connection()
    presence = _Connection()
    bus._listener_conn = listener
    bus._publisher_conn = publisher
    bus._presence_conn = presence

    asyncio.run(bus._close_clients())

    assert listener.closed is True
    assert publisher.closed is True
    assert presence.closed is True
    assert bus._presence_conn is None


def test_postgres_presence_is_used_for_connect_touch_disconnect_and_snapshot(monkeypatch):
    monkeypatch.setenv("CHAT_REALTIME_TRANSPORT", "local")
    manager = realtime_module.ChatRealtimeManager()
    record_calls: list[tuple[int, str]] = []
    clear_calls: list[tuple[int, str]] = []
    recorded = asyncio.Event()
    cleared = asyncio.Event()

    class _PresenceBus:
        started = True

        async def record_presence(self, *, user_id, connection_id):
            record_calls.append((int(user_id), str(connection_id)))
            recorded.set()

        async def clear_presence(self, *, user_id, connection_id):
            clear_calls.append((int(user_id), str(connection_id)))
            cleared.set()

        def load_presence_snapshot(self, _user_ids):
            return {99: postgres_module.datetime.now(postgres_module.timezone.utc)}

    class _Socket:
        async def accept(self):
            return None

        async def close(self, **_kwargs):
            return None

    manager._realtime_transport = "postgres"
    manager._transport_bus = _PresenceBus()

    async def _run():
        connection_id, _first = await manager.connect(_Socket(), user_id=7)
        await asyncio.wait_for(recorded.wait(), timeout=0.2)
        manager.touch_presence(connection_id)
        manager.disconnect(connection_id)
        await asyncio.wait_for(cleared.wait(), timeout=0.2)
        return connection_id

    connection_id = asyncio.run(_run())

    assert record_calls[0] == (7, connection_id)
    assert clear_calls == [(7, connection_id)]
    assert 99 in manager.get_presence_snapshot({99})


def test_listener_reconnects_after_failure(monkeypatch):
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_BASE_SEC", "0.01")
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_MAX_SEC", "0.01")
    monkeypatch.setenv("CHAT_POSTGRES_RECONNECT_JITTER_RATIO", "0")
    bus = _bus()
    reconnected = asyncio.Event()
    calls = 0

    async def _connect_listener():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ConnectionError("first listener failed")
        bus._publisher_ready = True
        bus._subscriber_ready = True
        reconnected.set()

    async def _wait_forever():
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_connect_listener", _connect_listener)
    monkeypatch.setattr(bus, "_wait_for_notification", _wait_forever)
    monkeypatch.setattr(bus, "_drain_relay", lambda: asyncio.sleep(0))
    monkeypatch.setattr(bus, "_refresh_presence_if_due", lambda: asyncio.sleep(0))

    async def _run():
        await bus.start()
        await asyncio.wait_for(reconnected.wait(), timeout=0.3)
        assert bus.available is True
        await bus.stop()

    asyncio.run(_run())

    assert calls == 2


def test_stop_cancels_listener_and_closes_connections(monkeypatch):
    bus = _bus()
    connected = asyncio.Event()

    async def _connect_listener():
        bus._subscriber_ready = True
        bus._publisher_ready = True
        connected.set()

    async def _wait_forever():
        await asyncio.Event().wait()

    monkeypatch.setattr(bus, "_connect_listener", _connect_listener)
    monkeypatch.setattr(bus, "_wait_for_notification", _wait_forever)
    monkeypatch.setattr(bus, "_drain_relay", lambda: asyncio.sleep(0))

    async def _run():
        await bus.start()
        await asyncio.wait_for(connected.wait(), timeout=0.2)
        assert bus.available is True
        await asyncio.wait_for(bus.stop(), timeout=0.2)
        assert bus.available is False
        assert bus.subscriber_ready is False

    asyncio.run(_run())
