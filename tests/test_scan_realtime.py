from __future__ import annotations

import asyncio

from scan_server.realtime import ScanRealtimeBroker


class _CursorStore:
    def __init__(self) -> None:
        self.calls = 0

    def get_realtime_cursor(self):
        self.calls += 1
        changed = self.calls >= 2
        return {
            "agents": (("online", 1, 10),),
            "tasks": (("queued", 0 if changed else 1, 20 if changed else 10),),
            "jobs": (),
            "incidents": (),
        }


def test_scan_realtime_broker_publishes_changed_sections_only():
    store = _CursorStore()
    broker = ScanRealtimeBroker(store, poll_interval_sec=0.01)

    async def _exercise():
        await broker.start()
        queue = broker.subscribe()
        event = await asyncio.wait_for(queue.get(), timeout=1.0)
        broker.unsubscribe(queue)
        await broker.stop()
        return event

    event = asyncio.run(_exercise())
    assert event["protocol"] == 1
    assert event["sections"] == ["tasks"]
    assert store.calls >= 2


def test_scan_realtime_broker_does_not_poll_without_subscribers():
    store = _CursorStore()
    broker = ScanRealtimeBroker(store, poll_interval_sec=0.01)

    async def _exercise():
        await broker.start()
        await asyncio.sleep(0.05)
        await broker.stop()

    asyncio.run(_exercise())
    assert store.calls == 0


def test_scan_realtime_broker_keeps_subscriber_queue_bounded():
    broker = ScanRealtimeBroker(_CursorStore(), poll_interval_sec=1.0)
    queue = broker.subscribe()
    for _ in range(30):
        broker._publish(["jobs"])
    assert queue.qsize() == 16
