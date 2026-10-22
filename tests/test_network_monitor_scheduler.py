"""Virtual time covers stalled probes and owner loss without touching a real network."""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backend.services.network_monitor_service import NetworkMonitorService
from backend.services import network_monitor_service as orchestration


@pytest.mark.asyncio
async def test_completed_probe_starts_next_queued_target_without_waiting_for_idle_tick(monkeypatch):
    # Boundary UI/API tests cannot control the scheduler's idle wait between completed probes.
    targets = [{"id": str(i), "enabled": True} for i in range(29)]
    started = set()
    all_started = asyncio.Event()
    svc = NetworkMonitorService(store=SimpleNamespace(targets=lambda: targets, heartbeat=lambda duration: None), probe=object())
    monkeypatch.setattr(orchestration, "schedule_phase", lambda target_id, interval, target_ids: 0)
    svc.clock = lambda: datetime(2026, 10, 22, tzinfo=timezone.utc)
    svc.monotonic = lambda: 0

    async def offload(function, *args, **kwargs):
        return function(*args, **kwargs)

    async def idle_tick(seconds):
        await asyncio.Event().wait()  # Completion of a probe must wake the queue first.

    async def collect(target_id, *, protocol, **kwargs):
        if protocol == "icmp":
            started.add(target_id)
            if len(started) == len(targets):
                all_started.set()
        return {"current": {"status": "online"}}

    monkeypatch.setattr(asyncio, "to_thread", offload)
    svc._sleep, svc.collect = idle_tick, collect
    task = asyncio.create_task(svc._owned_loop(lambda: True))
    try:
        await asyncio.wait_for(all_started.wait(), timeout=2)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert len(started) == 29


@pytest.mark.asyncio
async def test_29_target_schedule_keeps_icmp_running_while_snmp_is_stalled(monkeypatch):
    now, calls, active = [0.0], [], defaultdict(int)
    targets = [{"id": str(i), "enabled": True} for i in range(29)]
    store = SimpleNamespace(targets=lambda: targets, heartbeat=lambda duration: None)
    svc = NetworkMonitorService(store=store, probe=object())
    svc.monotonic = lambda: now[0]

    async def offload(function, *args, **kwargs):
        return function(*args, **kwargs)

    async def sleep(seconds):
        now[0] += seconds
        if now[0] >= 131:
            svc._stopping.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    async def collect(target_id, *, protocol, full, **kwargs):
        key = (target_id, protocol)
        active[key] += 1
        assert active[key] == 1
        calls.append((target_id, protocol, full, now[0]))
        try:
            if target_id == "0" and protocol == "snmp":
                await asyncio.Event().wait()
            return {"current": {"status": "online"}}
        finally:
            active[key] -= 1

    monkeypatch.setattr(asyncio, "to_thread", offload)
    svc._sleep, svc.collect = sleep, collect
    await svc._owned_loop(lambda: True)
    for target in targets:
        ticks = [at for tid, kind, full, at in calls if tid == target["id"] and kind == "icmp"]
        assert len(ticks) >= 12
        assert max(b - a for a, b in zip(ticks, ticks[1:])) <= 12
        if target["id"] != "0":
            full_ticks = [at for tid, kind, full, at in calls if tid == target["id"] and kind == "snmp" and full]
            assert len(full_ticks) >= 2
            assert max(b - a for a, b in zip(full_ticks, full_ticks[1:])) <= 65
    assert not any(active.values())


@pytest.mark.asyncio
async def test_owner_loss_cancels_pending_work_without_a_catchup_storm(monkeypatch):
    now, calls, cancelled = [0.0], [], []
    svc = NetworkMonitorService(store=SimpleNamespace(targets=lambda: [{"id": "a", "enabled": True}], heartbeat=lambda duration: None), probe=object())
    svc.monotonic = lambda: now[0]
    svc.clock = lambda: datetime(2026, 10, 22, tzinfo=timezone.utc) + timedelta(seconds=now[0])
    monkeypatch.setattr(orchestration, "schedule_phase", lambda target_id, interval, target_ids: 0)

    async def offload(function, *args, **kwargs):
        return function(*args, **kwargs)

    async def sleep(seconds):
        now[0] += 300 if now[0] == 5 else seconds
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    async def collect(target_id, *, protocol, **kwargs):
        calls.append((protocol, now[0]))
        if protocol == "snmp":
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(protocol)
        return {"current": {"status": "online"}}

    monkeypatch.setattr(asyncio, "to_thread", offload)
    svc._sleep, svc.collect = sleep, collect
    await svc._owned_loop(lambda: now[0] < 320)
    assert cancelled == ["snmp"]
    assert len([p for p, at in calls if p == "snmp"]) == 1
    assert 2 <= len([p for p, at in calls if p == "icmp"]) <= 4
    assert all(at < 320 for kind, at in calls)


@pytest.mark.asyncio
async def test_offline_backoff_keeps_fast_recovery_checks_bounded(monkeypatch):
    now, calls = [0.0], []
    svc = NetworkMonitorService(store=SimpleNamespace(targets=lambda: [{"id": "a", "enabled": True}], heartbeat=lambda duration: None), probe=object())
    svc.monotonic = lambda: now[0]

    async def offload(function, *args, **kwargs):
        return function(*args, **kwargs)

    async def sleep(seconds):
        now[0] += seconds
        if now[0] >= 361:
            svc._stopping.set()
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    async def collect(target_id, *, protocol, **kwargs):
        calls.append((protocol, now[0]))
        return {"current": {"status": "offline", "failures": 10}}

    monkeypatch.setattr(asyncio, "to_thread", offload)
    svc._sleep, svc.collect = sleep, collect
    await svc._owned_loop(lambda: True)
    icmp = [at for kind, at in calls if kind == "icmp"]
    snmp = [at for kind, at in calls if kind == "snmp"]
    assert 6 <= len(icmp) <= 7
    assert max(b - a for a, b in zip(icmp, icmp[1:])) <= 60 + 1e-6
    assert len(snmp) == 2 and snmp[1] - snmp[0] == pytest.approx(300)


@pytest.mark.asyncio
async def test_staggered_mixed_targets_keep_every_slot_in_a_full_virtual_hour(monkeypatch):
    # HTTP cannot deterministically advance deadlines while network work remains pending.
    from datetime import datetime, timedelta, timezone
    now, calls = [0.0], defaultdict(list)
    svc = NetworkMonitorService(store=SimpleNamespace(
        targets=lambda: [{'id': str(i), 'enabled': True} for i in range(29)], heartbeat=lambda duration: None), probe=object())
    svc.monotonic = lambda: now[0]
    svc.clock = lambda: datetime(2026, 10, 22, tzinfo=timezone.utc) + timedelta(seconds=now[0])

    async def offload(function, *args, **kwargs):
        return function(*args, **kwargs)

    async def sleeper(seconds):
        now[0] += min(seconds, .25)
        if now[0] >= 3665:
            svc._stopping.set()
        await asyncio.sleep(0)

    async def collect(target_id, *, protocol, scheduled_at, **kwargs):
        at = now[0]
        if protocol == 'icmp':
            calls[target_id].append((at, scheduled_at.timestamp()))
        duration = (5 if int(target_id) % 3 == 0 else 2.06) if protocol == 'icmp' else 8
        while now[0] < at + duration:
            await asyncio.sleep(0)
        return {'current': {'status': 'online'}}

    monkeypatch.setattr(asyncio, 'to_thread', offload)
    svc._sleep, svc.collect = sleeper, collect
    await svc._owned_loop(lambda: True)
    assert set(calls) == {str(i) for i in range(29)}
    for values in calls.values():
        hour = [(at, due) for at, due in values if 60 <= at < 3660]
        assert len({int(at // 10) for at, due in hour}) == 360
        assert len(hour) == 360
        assert max(b[0]-a[0] for a,b in zip(hour,hour[1:])) <= 12


@pytest.mark.asyncio
async def test_cancellation_during_lease_acquisition_releases_late_connection():
    import threading
    from contextlib import contextmanager

    entered, release, closed = threading.Event(), threading.Event(), threading.Event()

    @contextmanager
    def lease():
        entered.set()
        assert release.wait(5)
        try:
            yield lambda: True
        finally:
            closed.set()

    task = asyncio.create_task(orchestration._enter_lease(lease()))
    assert await asyncio.to_thread(entered.wait, 5)
    task.cancel()
    await asyncio.sleep(0)
    assert not closed.is_set()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
