"""Run E (and optional B) 5× per variant; report median lag/ACK/mark_read/sender metrics.

Variants (hot flags via tmp/chat-profile-flags.json + process env for access log):
  1. logging_queue          — default after QueueHandler patch
  2. access_log_off         — CHAT_UVICORN_ACCESS_LOG=0 (requires chat restart)
  3. presence_debounce      — CHAT_PRESENCE_DEFER_CONNECT=1 (default)
  4. ws_coalesce            — CHAT_WS_EVENT_COALESCE=1 (default)

SQL / sequence / pools / uvicorn workers stay frozen.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
FLAGS_FILE = PROJECT_ROOT / "tmp" / "chat-profile-flags.json"
RESTART_CHAT = PROJECT_ROOT / "scripts" / "pm2" / "restart-chat.ps1"
NODE_BIN = PROJECT_ROOT / "tools" / "node-v24.14.0-win-x64-full"
DEBUG_LOG = PROJECT_ROOT / "debug-20cb37.log"

VARIANTS = [
    ("logging_queue", {}, {"CHAT_UVICORN_ACCESS_LOG": "1"}),
    ("access_log_off", {}, {"CHAT_UVICORN_ACCESS_LOG": "0"}),
    (
        "presence_debounce",
        {"CHAT_PRESENCE_SIDEFX_ENABLED": True},
        {
            "CHAT_UVICORN_ACCESS_LOG": "0",
            "CHAT_PRESENCE_DEFER_CONNECT": "1",
            "CHAT_PRESENCE_DEBOUNCE_MS": "300",
            "CHAT_WS_EVENT_COALESCE": "0",
        },
    ),
    (
        "ws_coalesce",
        {"CHAT_PRESENCE_SIDEFX_ENABLED": True},
        {
            "CHAT_UVICORN_ACCESS_LOG": "0",
            "CHAT_PRESENCE_DEFER_CONNECT": "0",
            "CHAT_WS_EVENT_COALESCE": "1",
        },
    ),
    (
        "presence_and_coalesce",
        {"CHAT_PRESENCE_SIDEFX_ENABLED": True},
        {
            "CHAT_UVICORN_ACCESS_LOG": "0",
            "CHAT_PRESENCE_DEFER_CONNECT": "1",
            "CHAT_PRESENCE_DEBOUNCE_MS": "300",
            "CHAT_WS_EVENT_COALESCE": "1",
        },
    ),
]


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


def _median(values: list[float | None]) -> float | None:
    clean = [float(v) for v in values if v is not None]
    if not clean:
        return None
    return float(statistics.median(clean))


def write_flags(overlay: dict) -> None:
    FLAGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"CHAT_PROFILE_STACK_ENABLED": True, **overlay}
    FLAGS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def restart_chat(env_overlay: dict[str, str]) -> None:
    env = os.environ.copy()
    if NODE_BIN.exists():
        env["PATH"] = str(NODE_BIN) + os.pathsep + env.get("PATH", "")
    env.update({k: str(v) for k, v in env_overlay.items()})
    # Persist access-log flag for PM2 child via ecosystem is hard; set in process env
    # and also write a small helper file read by start_chat_server if needed.
    flag_path = PROJECT_ROOT / "tmp" / "chat-runtime-env.json"
    flag_path.write_text(json.dumps(env_overlay, ensure_ascii=False, indent=2), encoding="utf-8")
    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(RESTART_CHAT)],
        cwd=str(PROJECT_ROOT),
        env=env,
        check=False,
    )
    time.sleep(6)


def aggregate_log() -> dict:
    from collections import defaultdict

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
        if stage and "elapsed_ms" in data:
            by_stage[stage].append(float(data["elapsed_ms"]))
    out = {}
    for stage, vals in by_stage.items():
        out[stage] = {
            "n": len(vals),
            "p50": _pct(vals, 50),
            "p95": _pct(vals, 95),
            "p99": _pct(vals, 99),
            "max": max(vals) if vals else None,
        }
    return out


def fetch_sender_metrics(chat_api_base: str) -> dict:
    import urllib.request

    url = chat_api_base.replace("/api/v1", "") + "/health/pools"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return dict(payload.get("realtime_sender") or {})
    except Exception:
        return {}


def run_once(
    *,
    only: str,
    out_dir: Path,
    api_base: str,
    chat_api_base: str,
    duration: int,
    seed: int,
    run_idx: int,
) -> dict:
    if DEBUG_LOG.exists():
        try:
            DEBUG_LOG.unlink()
        except OSError:
            try:
                DEBUG_LOG.write_text("", encoding="utf-8")
            except OSError:
                pass
    run_out = out_dir / f"run{run_idx}"
    run_out.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "run_chat_realistic_scenarios.py"),
        "--only",
        only,
        "--out-dir",
        str(run_out),
        "--api-base",
        api_base,
        "--chat-api-base",
        chat_api_base,
        "--duration-sec",
        str(duration),
    ]
    # Optional seed if supported by runner (ignored if unknown — runner may not have --seed).
    env = os.environ.copy()
    env["CHAT_LOADTEST_SEED"] = str(seed + run_idx)
    proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env, check=False)
    stages = aggregate_log()
    summary_name = "summary-E_chat_hub_mark_read.json" if only == "E" else "summary-B_distributed_10chats.json"
    summary_path = run_out / summary_name
    client_summary = {}
    if summary_path.exists():
        client_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    sender = fetch_sender_metrics(chat_api_base)
    return {
        "exit_code": proc.returncode,
        "client_send_p95": (client_summary.get("client") or {}).get("send_p95"),
        "client_mark_read_p95": (client_summary.get("client") or {}).get("mark_read_p95"),
        "ack_p95": (client_summary.get("total_until_ack") or {}).get("p95"),
        "event_loop_lag": stages.get("event_loop_lag"),
        "mark_read_service": stages.get("mark_read_service"),
        "executor_job": stages.get("executor_job"),
        "sender": sender,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tmp/chat-loop-fixes-bench")
    parser.add_argument("--api-base", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--chat-api-base", default="http://127.0.0.1:8002/api/v1")
    parser.add_argument("--duration-sec", type=int, default=55)
    parser.add_argument("--only", default="E")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--variants", default="", help="Comma list; empty=all")
    parser.add_argument("--skip-restart", action="store_true")
    args = parser.parse_args()

    out_dir = PROJECT_ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    selected = {x.strip() for x in str(args.variants or "").split(",") if x.strip()}
    variants = [v for v in VARIANTS if not selected or v[0] in selected]

    report_rows = []
    for name, flag_overlay, env_overlay in variants:
        print(f"\n===== VARIANT {name} =====", flush=True)
        write_flags(flag_overlay)
        if not args.skip_restart:
            restart_chat(env_overlay)
        else:
            # Still apply hot flags; access log needs restart.
            time.sleep(1)
        runs = []
        for i in range(1, int(args.runs) + 1):
            print(f"--- {name} run {i}/{args.runs} ---", flush=True)
            result = run_once(
                only=args.only.upper(),
                out_dir=out_dir / name,
                api_base=args.api_base,
                chat_api_base=args.chat_api_base,
                duration=int(args.duration_sec),
                seed=int(args.seed),
                run_idx=i,
            )
            runs.append(result)
            print(json.dumps({"variant": name, "run": i, **result}, ensure_ascii=False), flush=True)

        med = {
            "variant": name,
            "runs": int(args.runs),
            "median_lag_p95": _median([(r.get("event_loop_lag") or {}).get("p95") for r in runs]),
            "median_lag_p99": _median([(r.get("event_loop_lag") or {}).get("p99") for r in runs]),
            "median_lag_max": _median([(r.get("event_loop_lag") or {}).get("max") for r in runs]),
            "median_ack_p95": _median([r.get("ack_p95") for r in runs]),
            "median_mark_read_p95": _median([r.get("client_mark_read_p95") for r in runs]),
            "median_socket_send_p95": _median([float((r.get("sender") or {}).get("socket_send_ms_p95") or 0) or None for r in runs]),
            "median_outbound_queue_p95": _median([float((r.get("sender") or {}).get("outbound_queue_p95") or 0) or None for r in runs]),
            "median_coalesced": _median([float((r.get("sender") or {}).get("coalesced_events") or 0) or None for r in runs]),
            "runs_raw": runs,
        }
        (out_dir / f"median-{name}.json").write_text(json.dumps(med, ensure_ascii=False, indent=2), encoding="utf-8")
        report_rows.append(med)
        print("MEDIAN", json.dumps({k: v for k, v in med.items() if k != "runs_raw"}, ensure_ascii=False), flush=True)

    final = {"results": report_rows}
    (out_dir / "bench-final.json").write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Chat loop-fixes bench (median of N runs)",
        "",
        "| Variant | lag p95 | lag p99 | ACK p95 | mark_read p95 | socket_send p95 | outbound q p95 | coalesced |",
        "|---------|--------:|--------:|--------:|--------------:|----------------:|---------------:|----------:|",
    ]
    for row in report_rows:
        lines.append(
            "| {variant} | {median_lag_p95} | {median_lag_p99} | {median_ack_p95} | {median_mark_read_p95} | {median_socket_send_p95} | {median_outbound_queue_p95} | {median_coalesced} |".format(
                variant=row["variant"],
                median_lag_p95=_fmt(row.get("median_lag_p95")),
                median_lag_p99=_fmt(row.get("median_lag_p99")),
                median_ack_p95=_fmt(row.get("median_ack_p95")),
                median_mark_read_p95=_fmt(row.get("median_mark_read_p95")),
                median_socket_send_p95=_fmt(row.get("median_socket_send_p95")),
                median_outbound_queue_p95=_fmt(row.get("median_outbound_queue_p95")),
                median_coalesced=_fmt(row.get("median_coalesced")),
            )
        )
    lines.append("")
    lines.append("Decision: lag p95 < 150–250 → keep architecture; 500+ with realtime/HTTP contention → process split; high lag only on socket_send → backpressure/slow-consumer.")
    (out_dir / "BENCH_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nDONE", out_dir, flush=True)
    return 0


def _fmt(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{float(value):.1f}"


if __name__ == "__main__":
    raise SystemExit(main())
