"""Sweep CHAT_WRITE_WORKERS values under identical chat send load."""
from __future__ import annotations

import json
import os
import statistics
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEBUG_LOG = PROJECT_ROOT / "debug-20cb37.log"
REPORT_DIR = PROJECT_ROOT / "tmp" / "worker-sweep"
NODE_BIN = PROJECT_ROOT / "tools" / "node-v24.14.0-win-x64-full"
WORKERS = [8, 12, 16, 24, 48]
DURATION_SEC = 75
VIRTUAL_USERS = 50


def _pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * (p / 100.0)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return float(ordered[low] * (1.0 - frac) + ordered[high] * frac)


def _aggregate_log() -> dict[str, dict[str, float | int | None]]:
    by_stage: dict[str, list[float]] = defaultdict(list)
    if not DEBUG_LOG.exists():
        return {}
    for line in DEBUG_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        data = row.get("data") or {}
        stage = str(data.get("stage") or "").strip()
        if not stage:
            continue
        if "elapsed_ms" not in data:
            continue
        by_stage[stage].append(float(data["elapsed_ms"]))
    out: dict[str, dict[str, float | int | None]] = {}
    for stage, vals in sorted(by_stage.items()):
        out[stage] = {
            "n": len(vals),
            "p50": _pct(vals, 50),
            "p95": _pct(vals, 95),
            "p99": _pct(vals, 99),
            "max": max(vals) if vals else None,
            "mean": statistics.fmean(vals) if vals else None,
        }
    return out


def _restart_backend(workers: int) -> None:
    import re
    import urllib.request

    env = os.environ.copy()
    if NODE_BIN.exists():
        env["PATH"] = str(NODE_BIN) + os.pathsep + env.get("PATH", "")
    env["CHAT_WRITE_WORKERS"] = str(workers)

    eco = PROJECT_ROOT / "scripts" / "pm2" / "ecosystem.backend.config.js"
    text = eco.read_text(encoding="utf-8")
    if "CHAT_WRITE_WORKERS" in text:
        text2 = re.sub(r"CHAT_WRITE_WORKERS:\s*'\d+'", f"CHAT_WRITE_WORKERS: '{workers}'", text)
    else:
        anchor = "CHAT_WS_SEND_TIMEOUT_SEC: '5',"
        if anchor not in text:
            anchor = "CHAT_DB_APPLICATION_NAME: 'itinvent-backend-chat',"
        text2 = text.replace(
            anchor,
            anchor + f"\n        CHAT_WRITE_WORKERS: '{workers}',",
        )
    if text2 != text:
        eco.write_text(text2, encoding="utf-8")
    print(f"ecosystem CHAT_WRITE_WORKERS={workers}", flush=True)
    subprocess.run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(PROJECT_ROOT / "scripts" / "pm2" / "restart-backend.ps1"),
        ],
        cwd=str(PROJECT_ROOT),
        env=env,
        check=False,
    )
    for _ in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8001/health", timeout=3) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError("backend health failed after restart")


def _run_loadtest(workers: int) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = REPORT_DIR / f"workers-{workers}.json"
    if DEBUG_LOG.exists():
        DEBUG_LOG.unlink()
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "loadtest_hub_chat_sessions.py"),
        "--api-base",
        "http://127.0.0.1:8001/api/v1",
        "--users-file",
        str(PROJECT_ROOT / "tmp" / "hub-chat-load-users.json"),
        "--meta-file",
        str(PROJECT_ROOT / "tmp" / "hub-chat-load-meta.json"),
        "--virtual-users",
        str(VIRTUAL_USERS),
        "--duration-sec",
        str(DURATION_SEC),
        "--think-time-sec",
        "1.5",
        "--stagger-ms",
        "80",
        "--enable-writes",
        "--write-targets",
        "group",
        "--light-hub",
        "--report-json",
        str(report),
    ]
    started = time.perf_counter()
    proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), check=False)
    elapsed = time.perf_counter() - started
    print(f"loadtest workers={workers} exit={proc.returncode} elapsed={elapsed:.1f}s", flush=True)
    return report


def _summarize(workers: int, report_path: Path) -> dict:
    stages = _aggregate_log()
    client = {}
    if report_path.exists():
        payload = json.loads(report_path.read_text(encoding="utf-8"))
        timings = payload.get("timings") or {}
        send = timings.get("ws_send_message") or {}
        client = {
            "send_n": send.get("count"),
            "send_mean": send.get("mean_ms"),
            "send_p95": send.get("p95_ms"),
            "send_max": send.get("max_ms"),
            "errors": payload.get("error_count"),
            "error_rate": payload.get("error_rate"),
            "elapsed_sec": payload.get("elapsed_sec") or DURATION_SEC,
        }
        send_n = float(send.get("count") or 0)
        elapsed = float(client["elapsed_sec"] or DURATION_SEC)
        client["msgs_per_sec"] = round(send_n / max(elapsed, 1.0), 2)
    def stage(name: str) -> dict:
        return stages.get(name) or {}

    return {
        "workers": workers,
        "client": client,
        "total_until_ack": stage("total_until_ack"),
        "sequence": stage("sequence"),
        "write_pool_wait": stage("write_pool_wait"),
        "db_pool_acquired": stage("db_pool_acquired"),
        "event_loop_lag": stage("event_loop_lag"),
        "websocket_broadcast_total": stage("websocket_broadcast_total"),
    }


def main() -> int:
    results = []
    for workers in WORKERS:
        print(f"\n=== SWEEP workers={workers} ===", flush=True)
        _restart_backend(workers)
        time.sleep(2)
        report = _run_loadtest(workers)
        summary = _summarize(workers, report)
        results.append(summary)
        out = REPORT_DIR / f"summary-workers-{workers}.json"
        out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False), flush=True)

    # Score: minimize ack p95 + loop lag, require zero errors
    def score(item: dict) -> float:
        if float((item.get("client") or {}).get("error_rate") or 0) > 0:
            return 1e12
        ack = float(((item.get("total_until_ack") or {}).get("p95") or 1e9))
        lag = float(((item.get("event_loop_lag") or {}).get("p95") or 1e9))
        wait = float(((item.get("write_pool_wait") or {}).get("p95") or 0))
        return ack + 0.5 * lag + 0.25 * wait

    ranked = sorted(results, key=score)
    best = ranked[0] if ranked else None
    final = {"results": results, "best_workers": (best or {}).get("workers"), "ranked": [r["workers"] for r in ranked]}
    (REPORT_DIR / "sweep-final.json").write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nBEST", final.get("best_workers"), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
