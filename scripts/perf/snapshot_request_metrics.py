"""Save a read-only snapshot of /system/request-metrics/local (loopback) for before/after comparisons.

Usage: python scripts/perf/snapshot_request_metrics.py <label> [--port 8001] [--out documentation/technical/perf]
Compare two snapshots: python scripts/perf/snapshot_request_metrics.py --diff before.json after.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def _fetch(port: int) -> dict:
    url = f"http://127.0.0.1:{port}/api/v1/system/request-metrics/local"
    with urllib.request.urlopen(url, timeout=15) as response:  # loopback only
        return json.loads(response.read().decode("utf-8"))


def _routes(snapshot: dict) -> dict[str, dict]:
    return {f"{r.get('method')} {r.get('path')}": r for r in snapshot.get("routes") or []}


def _diff(before_path: str, after_path: str) -> int:
    before = _routes(json.loads(Path(before_path).read_text(encoding="utf-8")))
    after = _routes(json.loads(Path(after_path).read_text(encoding="utf-8")))
    print(f"{'route':64} {'n':>9} {'p50':>16} {'p95':>18}")
    for key in sorted(set(before) & set(after), key=lambda k: -(before[k].get("p95_ms") or 0)):
        b, a = before[key], after[key]
        print(
            f"{key[:64]:64} {b.get('count', 0):>4}/{a.get('count', 0):<4} "
            f"{b.get('p50_ms', 0):>7.1f}->{a.get('p50_ms', 0):<7.1f} {b.get('p95_ms', 0):>8.1f}->{a.get('p95_ms', 0):<8.1f}"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("label", nargs="?", default="snapshot")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--out", default="documentation/technical/perf")
    parser.add_argument("--diff", nargs=2, metavar=("BEFORE", "AFTER"))
    args = parser.parse_args()
    if args.diff:
        return _diff(*args.diff)
    snapshot = _fetch(args.port)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = out_dir / f"{stamp}-{args.label}.json"
    target.write_text(json.dumps(snapshot, ensure_ascii=False, indent=1), encoding="utf-8")
    print(target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
