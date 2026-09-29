"""Flood smoke test: N concurrent POST /api/v1/inventory while polling /health."""
import json
import statistics
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8123"
KEY = sys.argv[2] if len(sys.argv) > 2 else "smoke-key"
TOTAL = int(sys.argv[3]) if len(sys.argv) > 3 else 300
WORKERS = int(sys.argv[4]) if len(sys.argv) > 4 else 80


def make_payload(i: int) -> dict:
    return {
        "hostname": f"PC-SMOKE-{i:04d}",
        "system_serial": f"SYS-SMOKE-{i:04d}",
        "mac_address": f"AA-BB-CC-{i % 256:02X}-{(i // 256) % 256:02X}-{(i * 7) % 256:02X}",
        "current_user": "CORP\\smoke",
        "user_login": "CORP\\smoke",
        "ip_primary": "10.99.0.1",
        "ip_list": ["10.99.0.1"],
        "cpu_model": "SmokeCPU",
        "ram_gb": 8,
        "monitors": [{"serial_number": f"MON-SMOKE-{i:04d}"}],
        "storage": [],
        "logical_disks": [],
        "report_type": "full_snapshot",
        "timestamp": 1_800_000_000 + i,
    }


def post(i: int):
    req = urllib.request.Request(
        BASE + "/api/v1/inventory",
        data=json.dumps(make_payload(i)).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": KEY},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, time.monotonic() - t0
    except Exception as exc:
        return f"ERR:{exc}", time.monotonic() - t0


def probe(path: str, timeout: float = 30.0):
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
            return resp.status, time.monotonic() - t0
    except Exception as exc:
        return f"ERR:{exc}", time.monotonic() - t0


def pct(values, q):
    if not values:
        return float("nan")
    return values[min(len(values) - 1, int(len(values) * q))]


base_status, base_lat = probe("/health")
print(f"baseline /health: {base_status} {base_lat * 1000:.0f}ms")

stop_flag = threading.Event()
health_samples = []


def poller():
    while not stop_flag.is_set():
        health_samples.append(probe("/health", timeout=60))
        time.sleep(0.05)


poll_thread = threading.Thread(target=poller, daemon=True)
poll_thread.start()

started = time.monotonic()
with ThreadPoolExecutor(max_workers=WORKERS) as pool:
    results = list(pool.map(post, range(TOTAL)))
total_sec = time.monotonic() - started
stop_flag.set()
poll_thread.join(timeout=5)

ok_lat = sorted(lat for status, lat in results if status == 200)
errors = [status for status, _ in results if status != 200]
h_ok = sorted(lat for status, lat in health_samples if status == 200)
h_err = [status for status, _ in health_samples if status != 200]

print(f"POSTs: {len(ok_lat)}/{len(results)} OK in {total_sec:.1f}s | "
      f"p50={pct(ok_lat, 0.5) * 1000:.0f}ms p95={pct(ok_lat, 0.95) * 1000:.0f}ms "
      f"max={(ok_lat[-1] * 1000 if ok_lat else float('nan')):.0f}ms errors={errors[:5]}")
print(f"/health during flood: {len(h_ok)} OK samples | "
      f"p50={pct(h_ok, 0.5) * 1000:.1f}ms p95={pct(h_ok, 0.95) * 1000:.1f}ms "
      f"max={(h_ok[-1] * 1000 if h_ok else float('nan')):.1f}ms errors={h_err[:5]}")

for path in ("/health", "/health/ready"):
    status, lat = probe(path, timeout=30)
    print(f"{path}: {status} in {lat * 1000:.0f}ms")
