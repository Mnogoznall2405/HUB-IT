"""Run B/E with one subsystem disabled at a time; compare lag / ACK / mark_read.

Flags are hot-reloaded from tmp/chat-profile-flags.json (no pool/SQL changes).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEBUG_LOG = PROJECT_ROOT / "debug-20cb37.log"
FLAGS_FILE = PROJECT_ROOT / "tmp" / "chat-profile-flags.json"
RESTART_CHAT = PROJECT_ROOT / "scripts" / "pm2" / "restart-chat.ps1"
NODE_BIN = PROJECT_ROOT / "tools" / "node-v24.14.0-win-x64-full"

VARIANTS: list[tuple[str, dict[str, object]]] = [
    ("baseline", {}),
    ("audit_off", {"CHAT_AUDIT_ENABLED": False}),
    ("hub_clear_off", {"CHAT_HUB_CLEAR_AFTER_MARK_READ_ENABLED": False}),
    ("inbox_meta_off", {"CHAT_INBOX_META_AFTER_SEND_ENABLED": False}),
    ("delivery_state_off", {"CHAT_DELIVERY_STATE_AFTER_SEND_ENABLED": False}),
    ("outbox_poll_off", {"CHAT_EVENT_OUTBOX_POLL_ENABLED": False}),
    ("presence_off", {"CHAT_PRESENCE_SIDEFX_ENABLED": False}),
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


def write_flags(overlay: dict[str, object]) -> None:
    FLAGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "CHAT_PROFILE_STACK_ENABLED": True,
        **overlay,
    }
    FLAGS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"flags -> {FLAGS_FILE}: {payload}", flush=True)


def clear_flags() -> None:
    if FLAGS_FILE.exists():
        FLAGS_FILE.write_text("{}", encoding="utf-8")


def aggregate_log() -> dict:
    by_stage: dict[str, list[float]] = defaultdict(list)
    stacks: list[dict] = []
    service_parts: dict[str, list[float]] = defaultdict(list)
    if not DEBUG_LOG.exists():
        return {"stages": {}, "stacks": [], "service_parts": {}}
    for line in DEBUG_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        data = row.get("data") or {}
        stage = str(data.get("stage") or "").strip()
        if stage == "event_loop_lag_stack":
            stacks.append(
                {
                    "lag_ms": data.get("elapsed_ms"),
                    "top_file": data.get("top_file"),
                    "top_func": data.get("top_func"),
                    "top_line": data.get("top_line"),
                }
            )
        if stage == "mark_read_service":
            for key in (
                "db_checkout_ms",
                "membership_ms",
                "load_ms",
                "update_ms",
                "flush_ms",
                "commit_ms",
                "invalidate_ms",
                "unaccounted_ms",
            ):
                if key in data:
                    service_parts[key].append(float(data[key]))
        if stage and "elapsed_ms" in data:
            by_stage[stage].append(float(data["elapsed_ms"]))
    stages = {}
    for stage, vals in sorted(by_stage.items()):
        stages[stage] = {
            "n": len(vals),
            "p50": _pct(vals, 50),
            "p95": _pct(vals, 95),
            "p99": _pct(vals, 99),
            "max": max(vals) if vals else None,
        }
    parts = {
        key: {"n": len(vals), "p50": _pct(vals, 50), "p95": _pct(vals, 95), "max": max(vals) if vals else None}
        for key, vals in service_parts.items()
    }
    return {"stages": stages, "stacks": stacks[:20], "service_parts": parts}


def restart_chat_once() -> None:
    import os

    env = os.environ.copy()
    if NODE_BIN.exists():
        env["PATH"] = str(NODE_BIN) + os.pathsep + env.get("PATH", "")
    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(RESTART_CHAT)],
        cwd=str(PROJECT_ROOT),
        env=env,
        check=False,
    )
    time.sleep(5)


def run_scenario(name: str, only: str, out_dir: Path, api_base: str, chat_api_base: str, duration: int) -> dict:
    if DEBUG_LOG.exists():
        try:
            DEBUG_LOG.unlink()
        except OSError:
            try:
                DEBUG_LOG.write_text("", encoding="utf-8")
            except OSError:
                pass
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "run_chat_realistic_scenarios.py"),
        "--only",
        only,
        "--out-dir",
        str(out_dir / name),
        "--api-base",
        api_base,
        "--chat-api-base",
        chat_api_base,
        "--duration-sec",
        str(duration),
    ]
    proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), check=False)
    stages = aggregate_log()
    summary_name = "summary-E_chat_hub_mark_read.json" if only == "E" else "summary-B_distributed_10chats.json"
    summary_path = out_dir / name / summary_name
    client_summary = {}
    if summary_path.exists():
        client_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    result = {
        "variant": name,
        "exit_code": proc.returncode,
        "client": client_summary.get("client") if isinstance(client_summary, dict) else {},
        "total_until_ack": client_summary.get("total_until_ack"),
        "event_loop_lag": (stages.get("stages") or {}).get("event_loop_lag"),
        "mark_read": (stages.get("stages") or {}).get("mark_read"),
        "mark_read_service": (stages.get("stages") or {}).get("mark_read_service"),
        "mark_read_http_breakdown": (stages.get("stages") or {}).get("mark_read_http_breakdown"),
        "executor_job": (stages.get("stages") or {}).get("executor_job"),
        "service_parts": stages.get("service_parts"),
        "stacks_top": (stages.get("stacks") or [])[:5],
    }
    (out_dir / f"profile-{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tmp/chat-subsystem-profile")
    parser.add_argument("--api-base", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--chat-api-base", default="http://127.0.0.1:8002/api/v1")
    parser.add_argument("--duration-sec", type=int, default=55)
    parser.add_argument("--only", default="E", help="B or E")
    parser.add_argument("--variants", default="", help="Comma list; empty = all")
    parser.add_argument("--restart-once", action="store_true", help="Restart chat once before matrix")
    args = parser.parse_args()

    out_dir = PROJECT_ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    selected = {x.strip() for x in str(args.variants or "").split(",") if x.strip()}
    variants = [v for v in VARIANTS if not selected or v[0] in selected]

    if args.restart_once:
        restart_chat_once()

    results = []
    try:
        for name, overlay in variants:
            print(f"\n=== VARIANT {name} overlay={overlay} ===", flush=True)
            write_flags(overlay)
            time.sleep(1)
            results.append(
                run_scenario(
                    name,
                    args.only.upper(),
                    out_dir,
                    args.api_base,
                    args.chat_api_base,
                    args.duration_sec,
                )
            )
    finally:
        clear_flags()

    final = {"results": results}
    (out_dir / "profile-final.json").write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nDONE", out_dir, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
