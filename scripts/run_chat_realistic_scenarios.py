"""Run realistic chat load scenarios A–D and aggregate send-audit metrics."""
from __future__ import annotations

import argparse
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
NODE_BIN = PROJECT_ROOT / "tools" / "node-v24.14.0-win-x64-full"


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


def aggregate_log() -> dict[str, dict]:
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
        if not stage or "elapsed_ms" not in data:
            continue
        by_stage[stage].append(float(data["elapsed_ms"]))
    out = {}
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


def run_one(name: str, cmd: list[str], out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    report = out_dir / f"{name}.json"
    if DEBUG_LOG.exists():
        try:
            DEBUG_LOG.unlink()
        except OSError:
            # Windows: audit writer may still hold the file briefly.
            try:
                DEBUG_LOG.write_text("", encoding="utf-8")
            except OSError:
                pass
    print(f"\n=== SCENARIO {name} ===", flush=True)
    full_cmd = cmd + ["--report-json", str(report)]
    started = time.perf_counter()
    proc = subprocess.run(full_cmd, cwd=str(PROJECT_ROOT), check=False)
    elapsed = time.perf_counter() - started
    stages = aggregate_log()
    client = {}
    if report.exists():
        payload = json.loads(report.read_text(encoding="utf-8"))
        timings = payload.get("timings") or {}
        send = timings.get("ws_send_message") or {}
        mark_read = timings.get("http_mark_read") or {}
        client = {
            "send_n": send.get("count"),
            "send_p50": send.get("p50_ms"),
            "send_p95": send.get("p95_ms"),
            "send_p99": send.get("p99_ms"),
            "send_max": send.get("max_ms"),
            "mark_read_n": mark_read.get("count"),
            "mark_read_p50": mark_read.get("p50_ms"),
            "mark_read_p95": mark_read.get("p95_ms"),
            "mark_read_p99": mark_read.get("p99_ms"),
            "mark_read_max": mark_read.get("max_ms"),
            "errors": payload.get("error_count"),
            "error_rate": payload.get("error_rate"),
            "elapsed_sec": payload.get("elapsed_sec"),
        }
        n = float(send.get("count") or 0)
        client["msgs_per_sec"] = round(n / max(float(client["elapsed_sec"] or 1), 1.0), 2)
    summary = {
        "scenario": name,
        "exit_code": proc.returncode,
        "wall_sec": round(elapsed, 1),
        "client": client,
        "total_until_ack": stages.get("total_until_ack") or {},
        "sequence": stages.get("sequence") or {},
        "write_pool_wait": stages.get("write_pool_wait") or {},
        "db_pool_acquired": stages.get("db_pool_acquired") or {},
        "event_loop_lag": stages.get("event_loop_lag") or {},
        "websocket_broadcast_total": stages.get("websocket_broadcast_total") or {},
        "mark_read_service": stages.get("mark_read") or stages.get("ws_mark_read") or {},
    }
    (out_dir / f"summary-{name}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return summary


def base_cmd(
    *,
    api_base: str,
    chat_api_base: str,
    users: str,
    meta: str,
    vu: int,
    duration: int,
    think: float,
    light_hub: bool,
    enable_writes: bool,
    write_targets: str,
    conversation_ids: str,
    skip_hub: bool = False,
    skip_conversations: bool = False,
    skip_bootstrap: bool = False,
    skip_messages: bool = False,
    chat_read_api_base: str = "",
    scenario_profile: str = "",
    steady_state_gates: bool = False,
    once_reads: bool = False,
    hot_conversation_id: str = "",
    force_reconnect_every_sec: float = 0.0,
    warmup_sec: float = 0.0,
    cooldown_sec: float = 0.0,
) -> list[str]:
    try:
        vu_override = int(str(os.getenv("CHAT_LOADTEST_VU", "") or "").strip() or "0")
    except Exception:
        vu_override = 0
    effective_vu = vu_override if vu_override > 0 else int(vu)
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "loadtest_hub_chat_sessions.py"),
        "--api-base",
        api_base,
        "--users-file",
        users,
        "--meta-file",
        meta,
        "--virtual-users",
        str(effective_vu),
        "--duration-sec",
        str(duration),
        "--think-time-sec",
        str(think),
        "--stagger-ms",
        "80",
        "--write-targets",
        write_targets,
    ]
    if chat_api_base:
        cmd.extend(["--chat-api-base", chat_api_base])
    if chat_read_api_base:
        cmd.extend(["--chat-read-api-base", chat_read_api_base])
    if conversation_ids:
        cmd.extend(["--conversation-ids", conversation_ids])
    if light_hub:
        cmd.append("--light-hub")
    if skip_hub:
        cmd.append("--skip-hub")
    if skip_conversations:
        cmd.append("--skip-conversations")
    if skip_bootstrap:
        cmd.append("--skip-bootstrap")
    if skip_messages:
        cmd.append("--skip-messages")
    if enable_writes:
        cmd.append("--enable-writes")
    if scenario_profile:
        cmd.extend(["--scenario-profile", str(scenario_profile)])
    if steady_state_gates:
        cmd.append("--steady-state-gates")
    if once_reads:
        cmd.append("--once-reads")
    if hot_conversation_id:
        cmd.extend(["--hot-conversation-id", str(hot_conversation_id)])
    if force_reconnect_every_sec and float(force_reconnect_every_sec) > 0:
        cmd.extend(["--force-reconnect-every-sec", str(force_reconnect_every_sec)])
    if warmup_sec and float(warmup_sec) > 0:
        cmd.extend(["--warmup-sec", str(warmup_sec)])
    if cooldown_sec and float(cooldown_sec) > 0:
        cmd.extend(["--cooldown-sec", str(cooldown_sec)])
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tmp/realistic-scenarios")
    parser.add_argument("--api-base", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--chat-api-base", default="")
    parser.add_argument("--chat-read-api-base", default="", help="Optional Chat Read API for split diag")
    parser.add_argument("--users-file", default="tmp/hub-chat-load-users.json")
    parser.add_argument("--meta-file", default="tmp/hub-chat-load-meta.json")
    parser.add_argument("--sharded-meta", default="tmp/hub-chat-load-meta-sharded.json")
    parser.add_argument("--duration-sec", type=int, default=75)
    parser.add_argument("--only", default="", help="Comma list: A,B,C,D,E,E1,E2,E3,E4,E5")
    args = parser.parse_args()

    out_dir = PROJECT_ROOT / args.out_dir
    users = str(PROJECT_ROOT / args.users_file)
    meta = str(PROJECT_ROOT / args.meta_file)
    sharded = PROJECT_ROOT / args.sharded_meta
    only = {x.strip().upper() for x in str(args.only or "").split(",") if x.strip()} or {"A", "B", "C", "D"}

    conversation_ids = ""
    if sharded.exists():
        payload = json.loads(sharded.read_text(encoding="utf-8"))
        ids = payload.get("group_conversation_ids") or []
        if isinstance(ids, list) and ids:
            conversation_ids = ",".join(str(x) for x in ids)
            meta_b = str(sharded)
        else:
            meta_b = meta
    else:
        meta_b = meta

    results = []
    if "A" in only:
        results.append(
            run_one(
                "A_hot_chat_50vu",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="group",
                    conversation_ids="",
                ),
                out_dir,
            )
        )
    if "B" in only:
        results.append(
            run_one(
                "B_distributed_10chats",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="group",
                    conversation_ids=conversation_ids,
                ),
                out_dir,
            )
        )
    if "C" in only:
        results.append(
            run_one(
                "C_corporate_100vu",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b if conversation_ids else meta,
                    vu=100,
                    duration=args.duration_sec,
                    think=3.0,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="both",
                    conversation_ids=conversation_ids,
                ),
                out_dir,
            )
        )
    if "D" in only:
        results.append(
            run_one(
                "D_chat_plus_hub",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=False,
                    enable_writes=True,
                    write_targets="group",
                    conversation_ids="",
                ),
                out_dir,
            )
        )
    if "E" in only or "MARK_READ" in only or "E5" in only:
        # Legacy mixed hub+chat scenario (not clean ACK SLO).
        results.append(
            run_one(
                "E_chat_hub_mark_read",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=False,
                    enable_writes=True,
                    write_targets="group",
                    conversation_ids="",
                ),
                out_dir,
            )
        )

    if "E_STEADY" in only or "STEADY" in only:
        results.append(
            run_one(
                "E_STEADY",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b,
                    vu=100,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="dm",
                    conversation_ids=conversation_ids,
                    scenario_profile="steady",
                    steady_state_gates=True,
                    once_reads=True,
                    warmup_sec=15.0,
                    cooldown_sec=5.0,
                ),
                out_dir,
            )
        )

    if "E_STAMPEDE" in only or "STAMPEDE" in only:
        results.append(
            run_one(
                "E_STAMPEDE",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b,
                    vu=100,
                    duration=args.duration_sec,
                    think=0.8,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="dm",
                    conversation_ids=conversation_ids,
                    scenario_profile="stampede",
                    warmup_sec=10.0,
                    cooldown_sec=5.0,
                ),
                out_dir,
            )
        )

    if "E_RECONNECT" in only or "RECONNECT" in only:
        results.append(
            run_one(
                "E_RECONNECT",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.0,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="dm",
                    conversation_ids=conversation_ids,
                    scenario_profile="reconnect",
                    force_reconnect_every_sec=20.0,
                    once_reads=True,
                    warmup_sec=10.0,
                    cooldown_sec=5.0,
                ),
                out_dir,
            )
        )

    if "E_HOT_CONVERSATION" in only or "HOT" in only:
        hot_id = ""
        if conversation_ids:
            hot_id = conversation_ids.split(",")[0].strip()
        results.append(
            run_one(
                "E_HOT_CONVERSATION",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta_b,
                    vu=40,
                    duration=args.duration_sec,
                    think=0.5,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="dm",
                    conversation_ids=conversation_ids,
                    scenario_profile="hot_conversation",
                    hot_conversation_id=hot_id,
                    once_reads=True,
                    warmup_sec=10.0,
                    cooldown_sec=5.0,
                ),
                out_dir,
            )
        )

    # Diagnostic HTTP-isolation slices (E1–E4). E5 == full E above.
    e_slices = {
        "E1": dict(skip_hub=True, skip_conversations=True, skip_bootstrap=True, skip_messages=True),
        "E2": dict(skip_hub=True, skip_conversations=False, skip_bootstrap=True, skip_messages=True),
        "E3": dict(skip_hub=True, skip_conversations=True, skip_bootstrap=True, skip_messages=False),
        "E4": dict(skip_hub=True, skip_conversations=True, skip_bootstrap=False, skip_messages=True),
    }
    for key, flags in e_slices.items():
        if key not in only:
            continue
        results.append(
            run_one(
                f"{key}_http_isolation",
                base_cmd(
                    api_base=args.api_base,
                    chat_api_base=args.chat_api_base,
                    users=users,
                    meta=meta,
                    vu=50,
                    duration=args.duration_sec,
                    think=1.5,
                    light_hub=True,
                    enable_writes=True,
                    write_targets="group",
                    conversation_ids="",
                    chat_read_api_base=str(getattr(args, "chat_read_api_base", "") or ""),
                    **flags,
                ),
                out_dir,
            )
        )

    final = {"results": results}
    (out_dir / "scenarios-final.json").write_text(
        json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\nDONE", out_dir, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
