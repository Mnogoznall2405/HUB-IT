"""Opt-in HTTP benchmark on a fixture DB; never connects to production services."""
import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import insert

from backend.appdb.monitoring_models import MonitoringInterface, MonitoringSample, MonitoringTarget
from backend.main import app
from test_e2e_monitoring import create_target, environment


@asynccontextmanager
async def modeled_collector(svc, now):
    if os.getenv("MONITORING_HTTP_COLLECTOR") != "1":
        yield
        return
    started = time.perf_counter()
    initial = now[0]
    svc.clock = lambda: initial + timedelta(seconds=time.perf_counter() - started)
    svc._benchmark_starts = {}

    class Probe:
        async def ping(self, target):
            svc._benchmark_starts.setdefault(target["id"], []).append(time.perf_counter() - started)
            await asyncio.sleep(2)  # OS ping's three spaced packets; no actual network IO.
            return {"status": "online", "sent": 3, "received": 3, "loss_pct": 0, "latency_ms": 1}

        async def read_snmp(self, target, community, *, full=True):
            await asyncio.sleep(0.05)
            return {"snmp_status": "ok", "full": full, "device": {}, "interfaces": []}

    svc.probe = Probe()
    task = asyncio.create_task(svc._owned_loop(lambda: True))
    try:
        yield
    except BaseException:
        raise
    else:
        await asyncio.sleep(max(0, 31 - (time.perf_counter() - started)))
    finally:
        svc._stopping.set()
        await task


@pytest.mark.asyncio
@pytest.mark.skipif(os.getenv("MONITORING_HTTP_BENCHMARK") != "1", reason="Explicit isolated benchmark only")
async def test_monitoring_http_under_parallel_load(environment, caplog):
    client, svc, _, now, _ = environment
    target = create_target(client)
    port_id = str(uuid4())
    current = {"checked_at": now[0].isoformat(), "status": "online", "snmp_status": "ok", "last_success_at": now[0].isoformat()}
    with svc.store.session() as session:
        for i in range(2, 30):
            session.add(MonitoringTarget(id=str(uuid4()), network_device_id=i, name=f"Router {i}", address=f"192.0.2.{i}",
                port=161, profile_id=target["profile_id"], enabled=True, settings={}, current=current))
        for i in range(54):
            session.add(MonitoringInterface(id=port_id if i == 0 else str(uuid4()), target_id=target["id"], name=f"ether{i + 1}", snmp_index=i + 1,
                settings={"role": "wan" if i == 0 else "lan", "history_enabled": True}, current={"oper": 1, "type": 6, "checked_at": now[0].isoformat()}))
        samples = []
        for i in range(1440):
            at = now[0] - timedelta(minutes=1439 - i)
            device = {"cpu_pct": 20 + i % 7, "memory_pct": 45.5, "temperature_c": 30, "storage_pct": 17,
                      "latency_ms": 1 + i % 3 / 3, "loss_pct": 0, "snmp_up": 1, "ping_up": 1}
            port = {"rx_bps": 1e6 + i, "tx_bps": 2e6 + i, "rx_bytes": 7500000, "tx_bytes": 15000000,
                    "rx_seconds": 60, "tx_seconds": 60, "rx_util_pct": 1.5, "tx_util_pct": 2.5,
                    "speed_bps": 1e9, "rx_errors_pps": 0, "tx_errors_pps": 0, "rx_discards_pps": 0, "tx_discards_pps": 0, "oper": 1}
            for iid, values in (("", device), (port_id, port)):
                samples.append({"id": str(uuid4()), "target_id": target["id"], "interface_id": iid, "observed_at": at, "values": values})
        session.execute(insert(MonitoringSample), samples)
    result = {"database": "isolated fixture SQLite", "auth": "existing admin dependency override; auth cost excluded", "targets": 29,
              "central_interfaces": 54, "raw_points_per_series": 1440, "modeled_collector": os.getenv("MONITORING_HTTP_COLLECTOR") == "1", "cases": []}
    transport = httpx.ASGITransport(app=app)
    async with modeled_collector(svc, now), httpx.AsyncClient(transport=transport, base_url="https://testserver") as http:
        for concurrency in (1, 5, 10):
            for run in range(3):
                if os.getenv("MONITORING_HTTP_COLD") == "1":
                    with svc.store._history_lock:
                        svc.store._history_cache.clear()
                semaphore = asyncio.Semaphore(concurrency)
                durations, lag, responses = [], [], []
                stop = asyncio.Event()

                async def monitor():
                    previous = time.perf_counter()
                    while not stop.is_set():
                        await asyncio.sleep(0.01)
                        current_at = time.perf_counter()
                        lag.append(max(0, (current_at - previous - 0.01) * 1000))
                        previous = current_at

                async def fetch(index):
                    async with semaphore:
                        started = time.perf_counter()
                        response = await http.get(f"/api/v1/monitoring/targets/{target['id']}/history", params={"hours": 24, "interface_id": port_id if index % 2 else ""})
                        durations.append((time.perf_counter() - started) * 1000)
                        responses.append(response)

                monitor_task = asyncio.create_task(monitor())
                started = time.perf_counter()
                try:
                    await asyncio.gather(*(fetch(i) for i in range(30)))
                finally:
                    stop.set()
                    await monitor_task
                elapsed = time.perf_counter() - started
                assert all(r.status_code == 200 for r in responses)
                assert all(r.json()["has_data"] and len(r.json()["points"]) == 721 for r in responses)
                ordered = sorted(durations)
                result["cases"].append({"concurrency": concurrency, "run": run + 1, "count": len(durations), "elapsed_seconds": elapsed,
                    "p50_ms": ordered[14], "p95_ms": ordered[28], "p99_ms": ordered[29], "loop_lag_max_ms": max(lag),
                    "response_bytes": sorted({len(r.content) for r in responses}),
                    "server_timing_examples": [r.headers.get("server-timing") for r in responses[:2]]})
    assert not any("monitoring_target_failed" in record.message for record in caplog.records)
    if os.getenv("MONITORING_HTTP_COLLECTOR") == "1":
        intervals = sorted(b - a for points in svc._benchmark_starts.values() for a, b in zip(points, points[1:]))
        result["collector_intervals"] = {"targets": len(svc._benchmark_starts), "count": len(intervals),
            "icmp_p95_seconds": intervals[max(0, int(len(intervals) * 0.95) - 1)], "icmp_max_seconds": max(intervals)}
    folder = Path(__file__).resolve().parents[1] / "output" / "monitoring-performance-20261021"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"http-{os.getenv('MONITORING_BENCHMARK_LABEL', 'run')}.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(path), "cases": [{k: v for k, v in c.items() if k in {"concurrency", "run", "p50_ms", "p95_ms", "p99_ms", "loop_lag_max_ms"}} for c in result["cases"]]}))
