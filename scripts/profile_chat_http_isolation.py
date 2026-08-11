"""Chat profiling stage: presence/coalesce 5x, E1–E5 isolation, stack rank, optional Read split.

Does NOT change SQL / sequence / pools / uvicorn workers.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
DEBUG_LOG = PROJECT_ROOT / "debug-20cb37.log"
NODE_BIN = PROJECT_ROOT / "tools" / "node-v24.14.0-win-x64-full"
RESTART_CHAT = PROJECT_ROOT / "scripts" / "pm2" / "restart-chat.ps1"
RUNTIME_ENV = PROJECT_ROOT / "tmp" / "chat-runtime-env.json"
FLAGS_FILE = PROJECT_ROOT / "tmp" / "chat-profile-flags.json"


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
    return float(statistics.median(clean)) if clean else None


def _env_with_node(extra: dict | None = None) -> dict:
    env = os.environ.copy()
    if NODE_BIN.exists():
        env["PATH"] = str(NODE_BIN) + os.pathsep + env.get("PATH", "")
    if extra:
        env.update({k: str(v) for k, v in extra.items()})
    return env


def write_runtime(env_overlay: dict) -> None:
    RUNTIME_ENV.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_ENV.write_text(json.dumps(env_overlay, ensure_ascii=False, indent=2), encoding="utf-8")
    FLAGS_FILE.write_text(
        json.dumps({"CHAT_PROFILE_STACK_ENABLED": True}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def restart_chat(env_overlay: dict) -> None:
    write_runtime(env_overlay)
    subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(RESTART_CHAT)],
        cwd=str(PROJECT_ROOT),
        env=_env_with_node(env_overlay),
        check=False,
    )
    time.sleep(6)


def clear_debug_log() -> None:
    if DEBUG_LOG.exists():
        try:
            DEBUG_LOG.unlink()
        except OSError:
            try:
                DEBUG_LOG.write_text("", encoding="utf-8")
            except OSError:
                pass


def aggregate_log() -> dict:
    stages: dict[str, list[float]] = defaultdict(list)
    stacks: list[dict] = []
    read_parts: dict[str, list[float]] = defaultdict(list)
    if not DEBUG_LOG.exists():
        return {"stages": {}, "stacks": [], "read_parts": {}, "stack_rank": []}
    for line in DEBUG_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        data = row.get("data") or {}
        stage = str(data.get("stage") or "").strip()
        if stage == "event_loop_lag_stack":
            stacks.append(data)
        if stage == "http_read_breakdown":
            for key in ("db_ms", "payload_build_ms", "serialization_ms", "json_bytes", "items_count"):
                if key in data:
                    read_parts[f"{data.get('route')}:{key}"].append(float(data[key]))
        if stage and "elapsed_ms" in data:
            stages[stage].append(float(data["elapsed_ms"]))
    rank: Counter = Counter()
    lag_sum: dict[tuple, float] = defaultdict(float)
    for sample in stacks:
        key = (
            str(sample.get("top_file") or "")[-80:],
            str(sample.get("top_func") or ""),
            int(sample.get("top_line") or 0),
        )
        rank[key] += 1
        lag_sum[key] += float(sample.get("elapsed_ms") or 0)
    stack_rank = [
        {
            "count": count,
            "lag_sum_ms": round(lag_sum[key], 1),
            "file": key[0],
            "func": key[1],
            "line": key[2],
        }
        for key, count in rank.most_common(25)
    ]
    stage_stats = {
        name: {
            "n": len(vals),
            "p50": _pct(vals, 50),
            "p95": _pct(vals, 95),
            "p99": _pct(vals, 99),
            "max": max(vals) if vals else None,
        }
        for name, vals in sorted(stages.items())
    }
    return {"stages": stage_stats, "stacks": stacks[:30], "read_parts": read_parts, "stack_rank": stack_rank}


def fetch_json(url: str) -> dict:
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return {}


def run_scenario(
    *,
    only: str,
    out_dir: Path,
    api_base: str,
    chat_api_base: str,
    chat_read_api_base: str,
    duration: int,
    seed: int,
    run_idx: int,
) -> dict:
    clear_debug_log()
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
    if chat_read_api_base:
        cmd.extend(["--chat-read-api-base", chat_read_api_base])
    env = _env_with_node({"CHAT_LOADTEST_SEED": str(seed + run_idx)})
    proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env, check=False)
    agg = aggregate_log()
    # Find summary json
    summary = {}
    for path in run_out.glob("summary-*.json"):
        summary = json.loads(path.read_text(encoding="utf-8"))
        break
    pools = fetch_json(chat_api_base.replace("/api/v1", "") + "/health/pools")
    return {
        "exit_code": proc.returncode,
        "ack_p95": (summary.get("total_until_ack") or {}).get("p95"),
        "mark_read_p95": (summary.get("client") or {}).get("mark_read_p95"),
        "send_p95": (summary.get("client") or {}).get("send_p95"),
        "event_loop_lag": (agg.get("stages") or {}).get("event_loop_lag"),
        "executor_job": (agg.get("stages") or {}).get("executor_job"),
        "http_read_breakdown": (agg.get("stages") or {}).get("http_read_breakdown"),
        "stack_rank": agg.get("stack_rank") or [],
        "read_parts": {
            k: {"n": len(v), "p95": _pct(v, 95), "max": max(v) if v else None}
            for k, v in (agg.get("read_parts") or {}).items()
        },
        "sender": pools.get("realtime_sender") or {},
        "async_logging": pools.get("async_logging") or {},
    }


def median_block(runs: list[dict], name: str) -> dict:
    return {
        "variant": name,
        "runs": len(runs),
        "median_lag_p95": _median([(r.get("event_loop_lag") or {}).get("p95") for r in runs]),
        "median_lag_p99": _median([(r.get("event_loop_lag") or {}).get("p99") for r in runs]),
        "median_ack_p95": _median([r.get("ack_p95") for r in runs]),
        "median_mark_read_p95": _median([r.get("mark_read_p95") for r in runs]),
        "median_send_p95": _median([r.get("send_p95") for r in runs]),
        "median_queue_wait_p95": _median(
            [float((r.get("sender") or {}).get("queue_wait_ms_p95") or 0) or None for r in runs]
        ),
        "median_socket_send_p95": _median(
            [float((r.get("sender") or {}).get("socket_send_ms_p95") or 0) or None for r in runs]
        ),
        "median_coalesced": _median(
            [float((r.get("sender") or {}).get("coalesced_events") or 0) or None for r in runs]
        ),
        "stack_rank_merged": _merge_stack_ranks(runs),
        "runs_raw": runs,
    }


def _merge_stack_ranks(runs: list[dict]) -> list[dict]:
    count: Counter = Counter()
    lag_sum: dict[tuple, float] = defaultdict(float)
    for run in runs:
        for row in run.get("stack_rank") or []:
            key = (row.get("file"), row.get("func"), row.get("line"))
            count[key] += int(row.get("count") or 0)
            lag_sum[key] += float(row.get("lag_sum_ms") or 0)
    return [
        {
            "count": c,
            "lag_sum_ms": round(lag_sum[k], 1),
            "file": k[0],
            "func": k[1],
            "line": k[2],
        }
        for k, c in count.most_common(20)
    ]


def start_read_server() -> subprocess.Popen:
    env = _env_with_node(
        {
            "HUBIT_RUNTIME_ROLE": "chat",
            "CHAT_SURFACE": "read",
            "BACKEND_PORT": "8003",
            "CHAT_EVENT_OUTBOX_POLL_ENABLED": "0",
            "CHAT_UVICORN_ACCESS_LOG": "0",
            "CHAT_PROFILE_SERIALIZATION": "1",
        }
    )
    return subprocess.Popen(
        [sys.executable, str(WEB_ROOT / "start_chat_read_server.py")],
        cwd=str(WEB_ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def stop_proc(proc: subprocess.Popen | None) -> None:
    if proc is None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tmp/chat-http-isolation")
    parser.add_argument("--api-base", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--chat-api-base", default="http://127.0.0.1:8002/api/v1")
    parser.add_argument("--chat-read-api-base", default="http://127.0.0.1:8003/api/v1")
    parser.add_argument("--duration-sec", type=int, default=55)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--phases",
        default="presence,e_slices,split",
        help="Comma: presence,e_slices,split",
    )
    parser.add_argument(
        "--slices",
        default="E1,E2,E3,E4,E5",
        help="Which E slices to run when e_slices phase is enabled (e.g. E4,E5)",
    )
    parser.add_argument("--vu", type=int, default=0, help="Optional VU override via CHAT_LOADTEST_VU (0=default 50)")
    args = parser.parse_args()
    out_dir = PROJECT_ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    phases = {x.strip() for x in str(args.phases).split(",") if x.strip()}
    slice_list = [x.strip().upper() for x in str(args.slices or "").split(",") if x.strip()]
    report: dict = {"results": {}}
    if int(args.vu or 0) > 0:
        os.environ["CHAT_LOADTEST_VU"] = str(int(args.vu))

    # Ensure chat has serialization profiling + stack sampling.
    base_env = {
        "CHAT_UVICORN_ACCESS_LOG": "0",
        "CHAT_PROFILE_SERIALIZATION": "1",
        "CHAT_PRESENCE_DEFER_CONNECT": "1",
        "CHAT_WS_EVENT_COALESCE": "1",
        "CHAT_SURFACE": "full",
    }

    if "presence" in phases:
        presence_variants = [
            ("presence_debounce", {**base_env, "CHAT_WS_EVENT_COALESCE": "0", "CHAT_PRESENCE_DEFER_CONNECT": "1"}),
            ("ws_coalesce", {**base_env, "CHAT_WS_EVENT_COALESCE": "1", "CHAT_PRESENCE_DEFER_CONNECT": "0"}),
            ("presence_and_coalesce", {**base_env, "CHAT_WS_EVENT_COALESCE": "1", "CHAT_PRESENCE_DEFER_CONNECT": "1"}),
        ]
        for name, env_overlay in presence_variants:
            print(f"\n===== {name} =====", flush=True)
            restart_chat(env_overlay)
            runs = []
            for i in range(1, int(args.runs) + 1):
                print(f"--- {name} run {i}/{args.runs} ---", flush=True)
                runs.append(
                    run_scenario(
                        only="E",
                        out_dir=out_dir / name,
                        api_base=args.api_base,
                        chat_api_base=args.chat_api_base,
                        chat_read_api_base="",
                        duration=int(args.duration_sec),
                        seed=int(args.seed),
                        run_idx=i,
                    )
                )
            block = median_block(runs, name)
            report["results"][name] = block
            (out_dir / f"median-{name}.json").write_text(
                json.dumps(block, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(
                "MEDIAN",
                json.dumps({k: v for k, v in block.items() if k not in {"runs_raw", "stack_rank_merged"}}, ensure_ascii=False),
                flush=True,
            )

    if "e_slices" in phases:
        restart_chat(base_env)
        for only in slice_list:
            if only not in {"E1", "E2", "E3", "E4", "E5", "E"}:
                print(f"skip unknown slice {only}", flush=True)
                continue
            name = f"slice_{only}"
            print(f"\n===== {name} =====", flush=True)
            runs = []
            for i in range(1, int(args.runs) + 1):
                print(f"--- {name} run {i}/{args.runs} ---", flush=True)
                runs.append(
                    run_scenario(
                        only=only if only not in {"E5", "E"} else "E",
                        out_dir=out_dir / name,
                        api_base=args.api_base,
                        chat_api_base=args.chat_api_base,
                        chat_read_api_base="",
                        duration=int(args.duration_sec),
                        seed=int(args.seed) + 100,
                        run_idx=i,
                    )
                )
            block = median_block(runs, name)
            report["results"][name] = block
            (out_dir / f"median-{name}.json").write_text(
                json.dumps(block, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(
                "MEDIAN",
                json.dumps({k: v for k, v in block.items() if k not in {"runs_raw", "stack_rank_merged"}}, ensure_ascii=False),
                flush=True,
            )

    if "split" in phases:
        print("\n===== process_split_diag =====", flush=True)
        restart_chat({**base_env, "CHAT_SURFACE": "full"})
        read_proc = start_read_server()
        time.sleep(8)
        try:
            health = fetch_json("http://127.0.0.1:8003/health")
            print("read health", health, flush=True)
            runs_split = []
            runs_control = []
            for i in range(1, int(args.runs) + 1):
                print(f"--- split E run {i}/{args.runs} ---", flush=True)
                runs_split.append(
                    run_scenario(
                        only="E",
                        out_dir=out_dir / "split_realtime_read",
                        api_base=args.api_base,
                        chat_api_base=args.chat_api_base,
                        chat_read_api_base=args.chat_read_api_base,
                        duration=int(args.duration_sec),
                        seed=int(args.seed) + 200,
                        run_idx=i,
                    )
                )
            stop_proc(read_proc)
            read_proc = None
            time.sleep(2)
            for i in range(1, int(args.runs) + 1):
                print(f"--- control full E run {i}/{args.runs} ---", flush=True)
                runs_control.append(
                    run_scenario(
                        only="E",
                        out_dir=out_dir / "split_control_full",
                        api_base=args.api_base,
                        chat_api_base=args.chat_api_base,
                        chat_read_api_base="",
                        duration=int(args.duration_sec),
                        seed=int(args.seed) + 300,
                        run_idx=i,
                    )
                )
            report["results"]["split_realtime_read"] = median_block(runs_split, "split_realtime_read")
            report["results"]["split_control_full"] = median_block(runs_control, "split_control_full")
        finally:
            stop_proc(read_proc)

    (out_dir / "isolation-final.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _write_md(out_dir, report)
    print("\nDONE", out_dir, flush=True)
    return 0


def _fmt(v: float | None) -> str:
    return "-" if v is None else f"{float(v):.1f}"


def _write_md(out_dir: Path, report: dict) -> None:
    lines = [
        "# Chat HTTP isolation / process-split profiling",
        "",
        "## Presence / coalesce (median of N)",
        "",
        "| Variant | lag p95 | lag p99 | ACK p95 | mark_read p95 | queue_wait p95 | socket_send p95 | coalesced |",
        "|---------|--------:|--------:|--------:|--------------:|---------------:|----------------:|----------:|",
    ]
    for key in ("presence_debounce", "ws_coalesce", "presence_and_coalesce"):
        row = (report.get("results") or {}).get(key) or {}
        if not row:
            continue
        lines.append(
            f"| {key} | {_fmt(row.get('median_lag_p95'))} | {_fmt(row.get('median_lag_p99'))} | "
            f"{_fmt(row.get('median_ack_p95'))} | {_fmt(row.get('median_mark_read_p95'))} | "
            f"{_fmt(row.get('median_queue_wait_p95'))} | {_fmt(row.get('median_socket_send_p95'))} | "
            f"{_fmt(row.get('median_coalesced'))} |"
        )
    lines += [
        "",
        "## E1–E5 HTTP isolation",
        "",
        "| Slice | lag p95 | ACK p95 | mark_read p95 | notes |",
        "|-------|--------:|--------:|--------------:|-------|",
    ]
    notes = {
        "slice_E1": "realtime only (WS+send+mark_read)",
        "slice_E2": "+ conversations list",
        "slice_E3": "+ history",
        "slice_E4": "+ bootstrap",
        "slice_E5": "full E",
    }
    for key, note in notes.items():
        row = (report.get("results") or {}).get(key) or {}
        if not row:
            continue
        lines.append(
            f"| {key} | {_fmt(row.get('median_lag_p95'))} | {_fmt(row.get('median_ack_p95'))} | "
            f"{_fmt(row.get('median_mark_read_p95'))} | {note} |"
        )
    lines += ["", "## Process split", ""]
    for key in ("split_realtime_read", "split_control_full"):
        row = (report.get("results") or {}).get(key) or {}
        if not row:
            continue
        lines.append(
            f"- **{key}**: lag p95={_fmt(row.get('median_lag_p95'))}, "
            f"ACK p95={_fmt(row.get('median_ack_p95'))}, "
            f"mark_read p95={_fmt(row.get('median_mark_read_p95'))}"
        )
    lines += ["", "## Top stack samples (merged from last presence/coalesce block if present)", ""]
    for key in ("presence_and_coalesce", "slice_E5", "split_control_full"):
        row = (report.get("results") or {}).get(key) or {}
        ranks = row.get("stack_rank_merged") or []
        if ranks:
            lines.append(f"### From `{key}`")
            for item in ranks[:12]:
                lines.append(
                    f"- n={item.get('count')} lag_sum={item.get('lag_sum_ms')} "
                    f"`{item.get('func')}` @ `{item.get('file')}:{item.get('line')}`"
                )
            break
    lines.append("")
    lines.append(
        "Verdict guide: if E1 lag << E5 and conversations/bootstrap jump lag → HTTP-read/serialization; "
        "if split_realtime_read lag < 250 and ACK drops vs control → process split proven; "
        "else continue hunting sync/CPU on MainThread via stack rank."
    )
    (out_dir / "ISOLATION_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
