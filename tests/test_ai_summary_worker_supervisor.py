"""A8c2/P1: summary upgrades run on an independent supervised executor —
the claim loop, new runs and heartbeat never wait for a summary LLM call."""
import asyncio
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import start_ai_chat_worker as worker


def _service(*, process=None, scan=None):
    return SimpleNamespace(
        process_pending_summary_upgrade=process or (lambda **kw: 0),
        scan_pending_summary_upgrades=scan or (lambda **kw: 0),
    )


def test_summary_does_not_block_claim_loop():
    """A 10s-blocked summary job must not stall claim iterations."""
    gate = threading.Event()
    started = threading.Event()
    calls = []

    def _process(**kw):
        calls.append(1)
        started.set()
        gate.wait(10)
        return 1

    async def _run():
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="t")
        task = asyncio.create_task(
            worker.run_summary_upgrade_supervisor(
                _service(process=_process),
                executor=executor, workers=1, idle_sec=0.01, scan_sec=600,
            )
        )
        try:
            await asyncio.wait_for(asyncio.to_thread(started.wait, 2), 3)
            # Summary job is now blocked inside its own thread. Simulate the
            # claim loop doing real work for 0.5s — it must keep ticking.
            iterations = 0
            deadline = time.monotonic() + 0.5
            while time.monotonic() < deadline:
                await asyncio.to_thread(lambda: None)  # claim+process stand-in
                iterations += 1
            return iterations
        finally:
            gate.set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            executor.shutdown(wait=True)

    iterations = asyncio.run(_run())
    assert iterations >= 20, iterations
    assert len(calls) >= 1


def test_supervisor_bounded_concurrency():
    gate = threading.Event()
    inflight = {"cur": 0, "max": 0}
    lock = threading.Lock()

    def _process(**kw):
        with lock:
            inflight["cur"] += 1
            inflight["max"] = max(inflight["max"], inflight["cur"])
        gate.wait(10)
        with lock:
            inflight["cur"] -= 1
        return 1

    async def _run():
        executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="t")
        task = asyncio.create_task(
            worker.run_summary_upgrade_supervisor(
                _service(process=_process),
                executor=executor, workers=2, idle_sec=0.01, scan_sec=600,
            )
        )
        try:
            await asyncio.sleep(0.4)
        finally:
            gate.set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            executor.shutdown(wait=True)

    asyncio.run(_run())
    assert inflight["max"] == 2  # exactly the worker bound, never more


def test_supervisor_survives_job_errors():
    gate = threading.Event()
    calls = {"n": 0}
    lock = threading.Lock()

    def _process(**kw):
        with lock:
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("transient")
            gate.set()
            return 1

    async def _run():
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="t")
        task = asyncio.create_task(
            worker.run_summary_upgrade_supervisor(
                _service(process=_process),
                executor=executor, workers=1, idle_sec=0.01, scan_sec=600,
            )
        )
        try:
            await asyncio.wait_for(asyncio.to_thread(gate.wait, 5), 6)
            assert not task.done()
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            executor.shutdown(wait=True)

    asyncio.run(_run())
    assert calls["n"] >= 3


def test_supervisor_cancel_is_clean():
    async def _run():
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="t")
        task = asyncio.create_task(
            worker.run_summary_upgrade_supervisor(
                _service(), executor=executor, workers=1, idle_sec=0.05,
                scan_sec=0.05,
            )
        )
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        executor.shutdown(wait=False, cancel_futures=True)

    asyncio.run(asyncio.wait_for(_run(), 5))


def test_env_wiring_flag(monkeypatch):
    """AI_SUMMARY_BACKGROUND_ENABLED=0 disables the background machinery."""
    monkeypatch.setenv("AI_SUMMARY_BACKGROUND_ENABLED", "0")
    assert worker._env_flag("AI_SUMMARY_BACKGROUND_ENABLED", True) is False
    monkeypatch.setenv("AI_SUMMARY_BACKGROUND_ENABLED", "1")
    assert worker._env_flag("AI_SUMMARY_BACKGROUND_ENABLED", True) is True
