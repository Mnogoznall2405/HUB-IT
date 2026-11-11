"""Opt-in full versus incremental latency HTTP benchmark on fixture SQLite only."""
import json
import os
import time
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import insert

from backend.appdb.monitoring_models import MonitoringSample
from test_e2e_monitoring import create_target, environment


@pytest.mark.skipif(os.getenv("MONITORING_LATENCY_BENCHMARK") != "1", reason="Explicit isolated benchmark only")
def test_latency_full_day_and_incremental_tail(environment):
    client, svc, _, now, _ = environment
    target = create_target(client)
    samples = []
    for i in range(1440):
        minute = now[0] - timedelta(minutes=1439 - i)
        slots = {str(second): {"observed_at": (minute + timedelta(seconds=second)).isoformat(), "latency_ms": 7 + i % 5}
                 for second in range(0, 60, 10)}
        samples.append({"id": str(uuid4()), "target_id": target["id"], "interface_id": "", "observed_at": minute,
                        "values": {"latency_ms": 9, "_icmp_10s": slots}})
    with svc.store.session() as session:
        session.execute(insert(MonitoringSample), samples)
    report = {"database": "fixture SQLite", "auth": "admin override; production auth cost excluded", "cases": []}
    for mode in ("full", "tail"):
        for run in range(3):
            durations, lengths, encoded = [], set(), set()
            params = {"hours": 24}
            if mode == "tail":
                params["after"] = (now[0] - timedelta(seconds=60)).isoformat()
            for _ in range(30):
                started = time.perf_counter()
                response = client.get(f"/api/v1/monitoring/targets/{target['id']}/latency-history", params=params)
                durations.append((time.perf_counter() - started) * 1000)
                assert response.status_code == 200
                assert len(response.json()["points"]) == (8641 if mode == "full" else 7)
                lengths.add(len(response.content))
                encoded.add(int(response.headers["content-length"]))
            ordered = sorted(durations)
            report["cases"].append({"mode": mode, "run": run + 1, "requests": len(durations),
                "p50_ms": ordered[14], "p95_ms": ordered[28], "p99_ms": ordered[29],
                "json_bytes": sorted(lengths), "gzip_bytes": sorted(encoded)})
    folder = Path(__file__).resolve().parents[1] / "output/monitoring-latency-10s-20261021"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "http-benchmark.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
