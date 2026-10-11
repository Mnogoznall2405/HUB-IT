"""Idle backoff, local wake-up and housekeeping gating of the chat event-outbox dispatcher.

Not covered by the boundary tests: the wake-up crosses threads (enqueue runs in a worker thread,
the dispatcher on the event loop) and the backoff is time-dependent. No database is used.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
for _path in (ROOT, WEB_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from backend.chat.event_outbox_service import ChatEventOutboxService  # noqa: E402


class _CountingService(ChatEventOutboxService):
    """Dispatcher whose poll does no I/O and reports a scripted result."""

    def __init__(self, results=None) -> None:
        super().__init__()
        self.poll_times: list[float] = []
        self._results = list(results or [])

    async def poll_once(self) -> dict[str, int]:  # type: ignore[override]
        self.poll_times.append(time.monotonic())
        if self._results:
            return self._results.pop(0)
        return {"claimed": 0, "recovered": 0}


def _configure(monkeypatch, *, base_ms: int, idle_max_ms: int) -> None:
    monkeypatch.setenv("CHAT_EVENT_OUTBOX_POLL_INTERVAL_MS", str(base_ms))
    monkeypatch.setenv("CHAT_EVENT_OUTBOX_IDLE_MAX_MS", str(idle_max_ms))


def test_idle_dispatcher_backs_off_instead_of_polling_every_base_interval(monkeypatch):
    _configure(monkeypatch, base_ms=50, idle_max_ms=400)

    async def scenario() -> list[float]:
        service = _CountingService()
        await service.start()
        await asyncio.sleep(1.3)
        await service.stop()
        return service.poll_times

    polls = asyncio.run(scenario())

    # Without backoff 1.3 s / 50 ms would be ~26 polls; 50+100+200+400+400... gives well under 12.
    assert 3 <= len(polls) <= 11
    gaps = [b - a for a, b in zip(polls, polls[1:])]
    assert max(gaps) >= 0.3, "the poll interval never grew towards the idle maximum"


def test_enqueue_from_another_thread_wakes_a_backed_off_dispatcher(monkeypatch):
    _configure(monkeypatch, base_ms=50, idle_max_ms=10_000)

    async def scenario() -> tuple[int, float]:
        service = _CountingService()
        await service.start()
        await asyncio.sleep(0.9)  # interval has grown to ~800 ms by now
        polls_before = len(service.poll_times)
        started = time.monotonic()
        await asyncio.to_thread(service._notify_wake)
        deadline = started + 0.5
        while len(service.poll_times) == polls_before and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        woke_after = (service.poll_times[-1] - started) if len(service.poll_times) > polls_before else 9.9
        await service.stop()
        return len(service.poll_times) - polls_before, woke_after

    extra_polls, woke_after = asyncio.run(scenario())

    assert extra_polls >= 1
    assert woke_after < 0.4, f"wake-up took {woke_after:.2f}s, the dispatcher kept sleeping"


def test_claimed_work_keeps_the_base_interval(monkeypatch):
    _configure(monkeypatch, base_ms=50, idle_max_ms=2_000)
    busy = {"claimed": 3, "recovered": 0}

    async def scenario() -> int:
        service = _CountingService(results=[dict(busy) for _ in range(40)])
        await service.start()
        await asyncio.sleep(0.6)
        await service.stop()
        return len(service.poll_times)

    # ~12 polls fit into 0.6 s at 50 ms; a backed-off dispatcher would manage 4-5.
    assert asyncio.run(scenario()) >= 8


def test_housekeeping_is_throttled_but_the_first_poll_runs_it(monkeypatch):
    monkeypatch.setenv("CHAT_EVENT_OUTBOX_ENABLED", "1")
    monkeypatch.setenv("CHAT_EVENT_OUTBOX_MAINTENANCE_SEC", "60")
    service = ChatEventOutboxService()
    calls = {"recover": 0, "repair": 0, "claim": 0}

    def _recover() -> int:
        calls["recover"] += 1
        return 2

    def _repair() -> int:
        calls["repair"] += 1
        return 1

    def _claim(limit=None):
        calls["claim"] += 1
        return []

    monkeypatch.setattr(service, "recover_stale_jobs", _recover)
    monkeypatch.setattr(service, "repair_missing_delivery_state_outbox", _repair)
    monkeypatch.setattr(service, "claim_jobs", _claim)
    monkeypatch.setattr(service, "get_backlog_snapshot", lambda: {"queued": 0, "failed": 0})

    async def scenario() -> list[dict[str, int]]:
        return [await service.poll_once() for _ in range(3)]

    results = asyncio.run(scenario())

    assert calls == {"recover": 1, "repair": 1, "claim": 3}
    assert [item["recovered"] for item in results] == [3, 0, 0]
