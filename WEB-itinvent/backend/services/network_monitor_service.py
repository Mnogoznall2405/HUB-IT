"""Monitoring orchestration; one background owner and one probe per target."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import text

from backend.appdb.db import get_app_engine
from backend.services.network_monitor_calculations import timestamp
from backend.services.network_monitor_probe import NetworkMonitorProbe
from backend.services.network_monitor_store import MonitoringStore

logger = logging.getLogger(__name__)
_local_owner = threading.Lock()


def background_enabled():
    return os.getenv("MONITORING_BACKGROUND_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}


@contextmanager
def monitoring_lease(database_url, scope):
    """Session advisory lock on an autocommit connection; no long transaction."""
    engine = get_app_engine(database_url)
    if engine.dialect.name != "postgresql":
        if scope == "owner" and not _local_owner.acquire(blocking=False):
            yield None
            return
        try:
            yield lambda: True
        finally:
            if scope == "owner":
                _local_owner.release()
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


class NetworkMonitorService:
    def __init__(self, store=None, probe=None):
        self.store = store or MonitoringStore()
        self.probe = probe or NetworkMonitorProbe()
        self.clock = lambda: datetime.now(timezone.utc)
        self._locks = {}
        self._task = None
        self._stopping = asyncio.Event()

    def catalog(self):
        # Existing network registry, not a second equipment catalog or SQL Server.
        from backend.services.network_service import network_service
        with network_service._lock, network_service._connect() as connection:
            rows = connection.execute("SELECT d.id,d.device_code,d.model,d.mgmt_ip,b.name AS branch_name FROM network_devices d JOIN network_branches b ON b.id=d.branch_id ORDER BY b.name,d.device_code").fetchall()
            return [{"id": int(r["id"]), "name": r["device_code"], "model": r["model"], "address": r["mgmt_ip"], "branch_name": r["branch_name"]} for r in rows]

    def save_target(self, payload, target_id=None):
        if payload["network_device_id"] not in {row["id"] for row in self.catalog()}:
            raise ValueError("Выберите устройство существующего сетевого реестра")
        saved = self.store.save_target(payload, target_id)
        return self.store.detail(saved["id"])

    def overview(self):
        self.store.ready()
        return {"targets": self.store.overview_targets(self.clock()), "worker": {"enabled": background_enabled(), **self.store.worker_state()},
                "checked_at": self.clock().isoformat()}

    async def collect(self, target_id, *, full=True):
        lock = self._locks.setdefault(target_id, asyncio.Lock())
        if lock.locked():
            raise MonitoringBusy("Опрос этого устройства уже выполняется")
        async with lock:
            lease = monitoring_lease(self.store.database_url, "target:" + target_id)
            guard = await asyncio.to_thread(lease.__enter__)
            try:
                if guard is None:
                    raise MonitoringBusy("Опрос этого устройства уже выполняется")
                target = await asyncio.to_thread(self.store.detail, target_id)
                if not target["enabled"]:
                    raise ValueError("Мониторинг устройства приостановлен")
                community = await asyncio.to_thread(self.store.credential, target["profile_id"])
                now = self.clock()
                result = await self.probe.read(target, community, full=full)
                if not await asyncio.to_thread(guard):
                    raise MonitoringBusy("Владение опросом утрачено; результат не записан")
                await asyncio.to_thread(self.store.record, target, result, now)
                return await asyncio.to_thread(self.store.detail, target_id)
            finally:
                await asyncio.to_thread(lease.__exit__, None, None, None)

    async def start(self):
        if not background_enabled() or self._task is not None:
            return
        await asyncio.to_thread(self.store.ready)
        self._stopping = asyncio.Event()
        self._task = asyncio.create_task(self._loop(), name="network-monitoring")

    async def stop(self):
        self._stopping.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self):
        while not self._stopping.is_set():
            lease = monitoring_lease(self.store.database_url, "owner")
            entered = False
            try:
                guard = await asyncio.to_thread(lease.__enter__)
                entered = True
                if guard is not None:
                    await self._owned_loop(guard)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("monitoring_cycle_failed error_type=%s", type(exc).__name__)
            finally:
                if entered:
                    await asyncio.to_thread(lease.__exit__, None, None, None)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=30)
            except TimeoutError:
                pass

    async def _owned_loop(self, guard):
        semaphore = asyncio.Semaphore(4)
        last_full, backoff = {}, {}
        last_retention = time.monotonic()
        while not self._stopping.is_set() and await asyncio.to_thread(guard):
            started = time.monotonic()
            targets = await asyncio.to_thread(self.store.targets)

            async def poll(target):
                target_id = target["id"]
                if not target["enabled"] or backoff.get(target_id, 0) > time.monotonic():
                    return
                async with semaphore:
                    collected_at = time.monotonic()
                    full = collected_at - last_full.get(target_id, 0) >= 59
                    try:
                        result = await self.collect(target_id, full=full)
                        if full:
                            last_full[target_id] = collected_at
                        if result["current"].get("status") == "offline":
                            backoff[target_id] = time.monotonic() + min(300, 30 * result["current"].get("failures", 1))
                    except MonitoringBusy:
                        pass
                    except LookupError:
                        pass  # Removed after this cycle loaded the target list.
                    except Exception as exc:
                        logger.warning("monitoring_target_failed target_id=%s error_type=%s", target_id, type(exc).__name__)

            await asyncio.gather(*(poll(target) for target in targets))
            await asyncio.to_thread(self.store.heartbeat, time.monotonic() - started)
            if time.monotonic() - last_retention >= 3600 and await asyncio.to_thread(guard):
                apply = os.getenv("MONITORING_RETENTION_APPLY", "0").strip().lower() in {"1", "true", "yes", "on"}
                # The owner lease serializes cleanup; each bounded batch commits separately.
                for _ in range(100 if apply else 1):
                    report = await asyncio.to_thread(self.store.retention, self.clock(), apply=apply)
                    logger.info("monitoring_retention dry_run=%s raw_eligible=%s raw_without_rollups=%s aggregates_eligible=%s", report["dry_run"], report["raw_eligible"], report["raw_without_rollups"], report["aggregates_eligible"])
                    if not apply or self._stopping.is_set() or not (report["raw_eligible"] or report["aggregates_eligible"]) or time.monotonic() - started > 20:
                        break
                    if not await asyncio.to_thread(guard):
                        break
                last_retention = time.monotonic()
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=max(1, 30 - (time.monotonic() - started)))
            except TimeoutError:
                pass


network_monitor_service = NetworkMonitorService()
