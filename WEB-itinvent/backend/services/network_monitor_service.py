"""Monitoring orchestration; one background owner and one probe per target."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import threading
import time
from contextlib import AsyncExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from weakref import WeakKeyDictionary, WeakValueDictionary

from sqlalchemy import text

from backend.appdb.db import get_app_engine
from backend.services.network_monitor_calculations import timestamp
from backend.services.network_monitor_probe import NetworkMonitorProbe
from backend.services.network_monitor_store import MonitoringStore

logger = logging.getLogger(__name__)
_local_owner = threading.Lock()
_local_leases = WeakValueDictionary()
_local_leases_guard = threading.Lock()


def background_enabled():
    return os.getenv("MONITORING_BACKGROUND_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}


def worker_expected():
    """True when a collector runs: in this process, or in the standalone monitoring worker."""
    external = os.getenv("MONITORING_WORKER_EXTERNAL", "0").strip().lower() in {"1", "true", "yes", "on"}
    return background_enabled() or external


def record_concurrency():
    try:
        return max(1, int(os.getenv("MONITORING_RECORD_CONCURRENCY", "3")))
    except ValueError:
        return 3


def schedule_phase(target_id, interval, target_ids):
    ordered = sorted(target_ids, key=lambda value: hashlib.sha256(str(value).encode()).digest())
    return ordered.index(target_id) * interval / max(1, len(ordered))


@contextmanager
def monitoring_lease(database_url, scope):
    """Session advisory lock on an autocommit connection; no long transaction."""
    engine = get_app_engine(database_url)
    if engine.dialect.name != "postgresql":
        with _local_leases_guard:
            lock = _local_owner if scope == "owner" else _local_leases.setdefault(scope, threading.Lock())
        if not lock.acquire(blocking=False):
            yield None
            return
        try:
            yield lambda: True
        finally:
            lock.release()
        return
    key = int.from_bytes(hashlib.sha256(("hub-monitoring:" + scope).encode()).digest()[:8], "big") & ((1 << 63) - 1)
    connection = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    acquired = False
    try:
        acquired = bool(connection.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}).scalar())
        pid = connection.execute(text("SELECT pg_backend_pid()")).scalar() if acquired else None

        def still_owned():
            return not connection.invalidated and connection.execute(text("SELECT pg_backend_pid()")).scalar() == pid

        yield still_owned if acquired else None
    finally:
        try:
            if acquired and not connection.invalidated:
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
        finally:
            connection.close()


class MonitoringBusy(RuntimeError):
    pass


async def _enter_lease(lease):
    task = asyncio.create_task(asyncio.to_thread(lease.__enter__))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        except Exception:
            pass  # __enter__ failed and the context manager already released its connection.
        else:
            await _exit_lease(lease)
        raise


async def _exit_lease(lease):
    task = asyncio.create_task(asyncio.to_thread(lease.__exit__, None, None, None))
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


class NetworkMonitorService:
    def __init__(self, store=None, probe=None):
        self.store = store or MonitoringStore()
        self.probe = probe or NetworkMonitorProbe()
        self.clock = lambda: datetime.now(timezone.utc)
        self.monotonic = time.monotonic
        self._locks = {}
        self._record_gates = WeakKeyDictionary()
        self._task = None
        self._stopping = asyncio.Event()

    async def _record(self, *args, **kwargs):
        # A stalled database must not let every in-flight probe hold an app-pool connection at once.
        loop = asyncio.get_running_loop()
        gate = self._record_gates.get(loop)
        if gate is None:
            gate = self._record_gates[loop] = asyncio.Semaphore(record_concurrency())
        async with gate:
            return await asyncio.to_thread(self.store.record, *args, **kwargs)

    def catalog(self):
        # Existing network registry, not a second equipment catalog or SQL Server.
        from backend.services.network_service import network_service
        with network_service._lock, network_service._connect() as connection:
            rows = connection.execute("SELECT d.id,d.device_code,d.model,d.mgmt_ip,b.name AS branch_name FROM network_devices d JOIN network_branches b ON b.id=d.branch_id ORDER BY b.name,d.device_code").fetchall()
            return [{"id": int(r["id"]), "name": r["device_code"], "model": r["model"], "address": r["mgmt_ip"], "branch_name": r["branch_name"]} for r in rows]

    def save_target(self, payload, target_id=None):
        card_id = payload.get("network_device_id")
        # A card that is already stored on the target may have left the registry since; only a new link must exist there.
        stored_card = self.store.probe_target(target_id, include_interfaces=False)["network_device_id"] if target_id else None
        if card_id is not None and card_id != stored_card and card_id not in {row["id"] for row in self.catalog()}:
            raise ValueError("Выберите устройство существующего сетевого реестра")
        saved = self.store.save_target(payload, target_id)
        return self.store.detail(saved["id"])

    def overview(self, object_ref=None):
        self.store.ready()
        return {"targets": self.store.overview_targets(self.clock(), object_ref), "worker": {"enabled": worker_expected(), **self.store.worker_state()},
                "checked_at": self.clock().isoformat()}

    async def collect(self, target_id, *, full=True, protocol=None, detail=True, queue_seconds=0, scheduled_at=None):
        entered_at = self.monotonic()
        protocols = (protocol,) if protocol else ("icmp", "snmp")
        locks = [self._locks.setdefault((target_id, kind), asyncio.Lock()) for kind in protocols]
        if any(lock.locked() for lock in locks):
            raise MonitoringBusy("Опрос этого устройства уже выполняется")
        async with AsyncExitStack() as stack:
            for lock in locks:
                await stack.enter_async_context(lock)
            leases, guards = [], []
            try:
                for kind in protocols:
                    lease = monitoring_lease(self.store.database_url, f"target:{target_id}:{kind}")
                    guard = await _enter_lease(lease)
                    leases.append(lease)
                    if guard is None:
                        raise MonitoringBusy("Опрос этого устройства уже выполняется")
                    guards.append(guard)
                target = await asyncio.to_thread(self.store.probe_target, target_id, include_interfaces=protocol != "icmp")
                prepared_at = self.monotonic()
                if not target["enabled"]:
                    raise ValueError("Мониторинг устройства приостановлен")
                now = self.clock()
                started = self.monotonic()
                if protocol == "icmp":
                    result = {"protocol": "icmp", "full": False, "ping": await self.probe.ping(target)}
                else:
                    community = await asyncio.to_thread(self.store.credential, target["profile_id"])
                    if protocol == "snmp":
                        result = {**await self.probe.read_snmp(target, community, full=full), "protocol": "snmp"}
                    else:
                        result = await self.probe.read(target, community, full=full)
                result["timings"] = {"queue_seconds": queue_seconds, "probe_seconds": self.monotonic() - started}
                result["timings"]["prepare_seconds"] = prepared_at - entered_at
                if scheduled_at is not None:
                    result["scheduled_at"] = scheduled_at.isoformat()
                for guard in guards:
                    if not await asyncio.to_thread(guard):
                        raise MonitoringBusy("Владение опросом утрачено; результат не записан")
                recording = asyncio.create_task(self._record(target, result, now, return_current=not detail))
                try:
                    current = await asyncio.shield(recording)
                except asyncio.CancelledError:
                    # A cancelled request/owner must not release its lease before the write commits.
                    await recording
                    raise
                return await asyncio.to_thread(self.store.detail, target_id) if detail else {"id": target_id, "current": current or {}}
            finally:
                for lease in reversed(leases):
                    await _exit_lease(lease)

    async def start(self):
        if not background_enabled() or self._task is not None:
            return
        await asyncio.to_thread(self.store.ready)
        self._stopping = asyncio.Event()
        self._task = asyncio.create_task(self._loop(), name="network-monitoring")

    async def wait(self):
        """Block until the collection loop ends; for the standalone worker process."""
        if self._task is not None:
            await self._task

    async def stop(self):
        self._stopping.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        close = getattr(self.probe, "close", None)
        if close:
            await close()

    async def _loop(self):
        while not self._stopping.is_set():
            lease = monitoring_lease(self.store.database_url, "owner")
            entered = False
            try:
                guard = await _enter_lease(lease)
                entered = True
                if guard is not None:
                    await self._owned_loop(guard)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("monitoring_cycle_failed error_type=%s", type(exc).__name__)
            finally:
                if entered:
                    await _exit_lease(lease)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=30)
            except TimeoutError:
                pass

    async def _owned_loop(self, guard):
        pending, due, full_due, launched = {}, {}, {}, {}
        limits = self.store.collection_limits() if hasattr(self.store, "collection_limits") else {"icmp": 12, "snmp": 4}
        intervals = {"icmp": 10, "snmp": 30}
        epoch = self.clock().timestamp() - self.monotonic()
        targets = []
        reload_at = heartbeat_at = float("-inf")
        retention_at, retention_task = self.monotonic(), None
        try:
            while not self._stopping.is_set() and await asyncio.to_thread(guard):
                started = self.monotonic()
                if started - reload_at >= 5:
                    targets = await asyncio.to_thread(self.store.targets)
                    ids = {t["id"] for t in targets}
                    due = {key: value for key, value in due.items() if key[0] in ids}
                    full_due = {key: value for key, value in full_due.items() if key in ids}
                    for target in targets:
                        for kind in limits:
                            step = intervals[kind]
                            phase = schedule_phase(target["id"], step, ids)
                            due.setdefault((target["id"], kind), started + (phase - (epoch + started) % step) % step)
                    reload_at = started
                for key, task in list(pending.items()):
                    if not task.done():
                        continue
                    del pending[key]
                    try:
                        result = task.result()
                        current = result["current"]
                        if current.get("status") == "offline":
                            maximum = 60 if key[1] == "icmp" else 300
                            due[key] = max(due.get(key, 0), launched[key] + min(maximum, 30 * current.get("failures", 1)))
                    except (MonitoringBusy, LookupError, ValueError):
                        pass
                    except Exception as exc:
                        logger.warning("monitoring_target_failed target_id=%s protocol=%s error_type=%s", key[0], key[1], type(exc).__name__)
                for kind, maximum in limits.items():
                    slots = maximum - sum(key[1] == kind for key in pending)
                    candidates = sorted((t for t in targets if t["enabled"] and (t["id"], kind) not in pending),
                                        key=lambda t: due.get((t["id"], kind), started))
                    for target in candidates:
                        key = (target["id"], kind)
                        deadline = due.setdefault(key, started)
                        if slots <= 0 or deadline > started + 1e-6:
                            break
                        full = kind == "snmp" and full_due.get(key[0], started) <= started + 1e-6
                        # A late probe measures now; it cannot fill a past unobserved window.
                        scheduled = deadline + int(max(0, started - deadline) // intervals[kind]) * intervals[kind]
                        pending[key] = asyncio.create_task(self.collect(key[0], protocol=kind, full=full,
                            detail=False, queue_seconds=max(0, started - deadline),
                            scheduled_at=datetime.fromtimestamp(epoch + scheduled, timezone.utc)), name=f"monitoring-{kind}-{key[0]}")
                        launched[key] = started
                        # Skip missed ticks rather than accumulating a catch-up storm.
                        step = intervals[kind]
                        due[key] = deadline + (int(max(0, started - deadline) // step) + 1) * step
                        if full:
                            full_due[key[0]] = scheduled + 60
                        slots -= 1
                if started - heartbeat_at >= 10:
                    await asyncio.to_thread(self.store.heartbeat, self.monotonic() - started)
                    heartbeat_at = started
                if started - retention_at >= 3600 and (retention_task is None or retention_task.done()):
                    if retention_task is not None:
                        retention_task.result()
                    retention_task = asyncio.create_task(self._retention(guard))
                    retention_at = started
                # A completed probe frees capacity immediately; an idle tick must not
                # add up to a second to every small batch of targets.
                available = [at for key, at in due.items() if key not in pending and at > started]
                delay = min(1, min(available) - started) if available else 1
                sleeper = asyncio.create_task(self._sleep(max(.01, delay)))
                try:
                    await asyncio.wait([sleeper, *pending.values()], return_when=asyncio.FIRST_COMPLETED)
                finally:
                    sleeper.cancel()
                    await asyncio.gather(sleeper, return_exceptions=True)
        finally:
            tasks = list(pending.values()) + ([retention_task] if retention_task is not None else [])
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _sleep(self, seconds):
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except TimeoutError:
            pass

    async def _retention(self, guard):
        apply = os.getenv("MONITORING_RETENTION_APPLY", "0").strip().lower() in {"1", "true", "yes", "on"}
        started = self.monotonic()
        for _ in range(100 if apply else 1):
            if self._stopping.is_set() or not await asyncio.to_thread(guard):
                break
            report = await asyncio.to_thread(self.store.retention, self.clock(), apply=apply)
            logger.info("monitoring_retention dry_run=%s raw_eligible=%s raw_without_rollups=%s aggregates_eligible=%s", report["dry_run"], report["raw_eligible"], report["raw_without_rollups"], report["aggregates_eligible"])
            if not apply or not (report["raw_eligible"] or report["aggregates_eligible"]) or self.monotonic() - started > 20:
                break


network_monitor_service = NetworkMonitorService()
