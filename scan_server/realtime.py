"""Process-local SSE fan-out backed by a shared Scan database cursor."""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any


logger = logging.getLogger(__name__)


def _env_float(name: str, default: float, *, minimum: float, maximum: float) -> float:
    try:
        return max(minimum, min(maximum, float(str(os.getenv(name, default) or default))))
    except (TypeError, ValueError):
        return default


class ScanRealtimeBroker:
    def __init__(self, store: Any, *, poll_interval_sec: float | None = None) -> None:
        self.store = store
        self.poll_interval_sec = poll_interval_sec or _env_float(
            "SCAN_REALTIME_POLL_INTERVAL_SEC", 2.0, minimum=0.5, maximum=15.0,
        )
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._subscribers: set[asyncio.Queue] = set()
        self._cursor: dict[str, Any] | None = None
        self._sequence = 0

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="scan-realtime-cursor")

    async def stop(self) -> None:
        if self._stop_event is not None:
            self._stop_event.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._stop_event = None
        self._cursor = None
        self._subscribers.clear()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=16)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def _publish(self, sections: list[str]) -> None:
        self._sequence += 1
        event = {
            "protocol": 1,
            "event_id": f"scan-{self._sequence}-{uuid.uuid4().hex[:12]}",
            "occurred_at": int(time.time()),
            "sections": sections,
        }
        for queue in tuple(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def _run(self) -> None:
        while True:
            try:
                if self._subscribers:
                    cursor = await asyncio.to_thread(self.store.get_realtime_cursor)
                    if self._cursor is not None:
                        changed = [
                            section
                            for section in sorted(set(self._cursor) | set(cursor))
                            if self._cursor.get(section) != cursor.get(section)
                        ]
                        if changed:
                            self._publish(changed)
                    self._cursor = cursor
                else:
                    self._cursor = None
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Scan realtime cursor refresh failed", exc_info=True)
            assert self._stop_event is not None
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.poll_interval_sec)
                return
            except asyncio.TimeoutError:
                continue
