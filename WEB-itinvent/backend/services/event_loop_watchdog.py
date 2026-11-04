"""Watchdog that reports where the asyncio event loop is blocked.

The loop refreshes a heartbeat every ``_BEAT_INTERVAL_SEC``. A daemon thread checks the
heartbeat and, when the loop has not run for ``threshold_ms``, logs the stack of the loop
thread once per stall.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
import traceback

logger = logging.getLogger(__name__)

_BEAT_INTERVAL_SEC = 0.25
_CHECK_INTERVAL_SEC = 0.25
_MAX_STACK_FRAMES = 25


class EventLoopWatchdog:
    def __init__(self, *, threshold_ms: float = 1000.0) -> None:
        self._threshold_sec = max(0.2, float(threshold_ms) / 1000.0)
        self._last_beat = time.monotonic()
        self._loop_thread_id: int | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._beat_task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._thread is not None:
            return
        self._loop_thread_id = threading.get_ident()
        self._last_beat = time.monotonic()
        self._stop.clear()
        self._beat_task = asyncio.create_task(self._beat(), name="event-loop-watchdog-beat")
        self._thread = threading.Thread(target=self._watch, name="event-loop-watchdog", daemon=True)
        self._thread.start()

    async def stop(self) -> None:
        self._stop.set()
        task, self._beat_task = self._beat_task, None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._thread = None

    async def _beat(self) -> None:
        while True:
            self._last_beat = time.monotonic()
            await asyncio.sleep(_BEAT_INTERVAL_SEC)

    def _watch(self) -> None:
        reported_beat = 0.0
        while not self._stop.wait(_CHECK_INTERVAL_SEC):
            beat = self._last_beat
            stalled_sec = time.monotonic() - beat
            if stalled_sec >= self._threshold_sec and beat != reported_beat:
                reported_beat = beat
                self._report_stall(stalled_sec)

    def _report_stall(self, stalled_sec: float) -> None:
        frame = sys._current_frames().get(self._loop_thread_id or 0)
        stack = "".join(traceback.format_stack(frame, limit=_MAX_STACK_FRAMES)) if frame else "<no frame>"
        logger.warning(
            "event_loop.blocked stalled_ms=%.0f threshold_ms=%.0f stack:\n%s",
            stalled_sec * 1000.0,
            self._threshold_sec * 1000.0,
            stack,
        )
