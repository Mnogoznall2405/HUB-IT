"""Mixed acceptance bench for chat write-path SLO (default: E_STEADY).

Runs N warm scenarios via run_chat_realistic_scenarios and aggregates:
- ACK / recipient_socket_write p95/p99
- steady-state gates (unexpected_ws_denial / disconnect / send_errors)
- stage histograms from debug-20cb37.log

Release gate (plan):
  each valid run: ack p95 <= 700ms
  at least 2 of 3: ack p95 <= 500ms
  unexpected_ws_denial = 0, unexpected_disconnect = 0, send_errors = 0
"""
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


def _env_with_node(extra: dict | None = None) -> dict:
    env = os.environ.copy()
    if NODE_BIN.exists():
        env["PATH"] = str(NODE_BIN) + os.pathsep + env.get("PATH", "")
    if extra:
        env.update({k: str(v) for k, v in extra.items()})
    return env


def clear_debug_log() -> None:
    if DEBUG_LOG.exists():
        try:
            DEBUG_LOG.write_text("", encoding="utf-8")
        except OSError:
            pass


def aggregate_log() -> dict:
    stages: dict[str, list[float]] = defaultdict(list)
    if not DEBUG_LOG.exists():
        return {"stages": {}}
    for line in DEBUG_LOG.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except Exception:
            continue
        data = row.get("data") or {}
        stage = str(data.get("stage") or "").strip()
        if stage and "elapsed_ms" in data:
            stages[stage].append(float(data["elapsed_ms"]))
    return {
        "stages": {
            name: {
                "n": len(vals),
                "p50": _pct(vals, 50),
                "p95": _pct(vals, 95),
                "p99": _pct(vals, 99),
                "max": max(vals) if vals else None,
            }
            for name, vals in sorted(stages.items())
        }
    }


def _load_scenario_report(run_out: Path, scenario: str = "E_STEADY") -> dict:
    preferred = [
        f"{scenario}.json",
        "E_STEADY.json",
        "E_STAMPEDE.json",
        "E_RECONNECT.json",
        "E_chat_hub_mark_read.json",
    ]
    for name in preferred:
        path = run_out / name
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                return {}
    for path in run_out.glob("*.json"):
        if path.name.endswith(".diagnosis.md"):
            continue
        if path.name in {"write-path-slo.json", "scenarios-final.json", "SUMMARY.json"}:
            continue
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
    return {}


def run_once(
    *,
    out_dir: Path,
    duration: int,
    seed: int,
    run_idx: int,
    scenario: str,
) -> dict:
    clear_debug_log()
    run_out = out_dir / f"run{run_idx}"
    run_out.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "scripts" / "run_chat_realistic_scenarios.py"),
        "--only",
        scenario,
        "--out-dir",
        str(run_out),
        "--api-base",
        "http://127.0.0.1:8001/api/v1",
        "--chat-api-base",
        "http://127.0.0.1:8002/api/v1",
        "--duration-sec",
        str(duration),
    ]
    vu = str(os.getenv("CHAT_LOADTEST_VU", "100") or "100").strip() or "100"
    env = _env_with_node(
        {
            "CHAT_LOADTEST_SEED": str(seed + run_idx),
            "CHAT_LOADTEST_VU": vu,
        }
    )
    proc = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env, check=False)
    agg = aggregate_log()
    stages = agg.get("stages") or {}
    scenario_report = _load_scenario_report(run_out, scenario=scenario)
    steady = scenario_report.get("steady_gates") or {}
    stampede = scenario_report.get("stampede_gates") or {}
    reconnect = scenario_report.get("reconnect_gates") or {}
    harness_invalid = int(proc.returncode or 0) != 0 and not stages.get("total_until_ack")
    lag_stage = stages.get("event_loop_lag") or {}
    result = {
        "exit_code": int(proc.returncode or 0),
        "invalid": bool(harness_invalid),
        "ack_p95": (stages.get("total_until_ack") or {}).get("p95"),
        "ack_p99": (stages.get("total_until_ack") or {}).get("p99"),
        "recipient_socket_write_p95": (stages.get("recipient_socket_write") or {}).get("p95"),
        "recipient_socket_write_p99": (stages.get("recipient_socket_write") or {}).get("p99"),
        "event_loop_lag_p95": lag_stage.get("p95"),
        "db_checkout_wait_p95": (stages.get("db_checkout_wait") or {}).get("p95"),
        "seq_claim_p95": (stages.get("seq_claim") or stages.get("sequence") or stages.get("seq_update_total") or {}).get("p95"),
        "commit_p95": (stages.get("commit") or stages.get("commit_total") or {}).get("p95"),
        "critical_queue_drop_samples": (stages.get("critical_queue_drop") or {}).get("n") or 0,
        "unexpected_ws_denial": int(steady.get("unexpected_ws_denial") or 0),
        "unexpected_disconnect": int(steady.get("unexpected_disconnect") or 0),
        "send_errors": int(steady.get("send_errors") or 0),
        "read_throttles": int(steady.get("read_throttles") or sum((scenario_report.get("read_throttle_total") or {}).values())),
        "steady_gates": steady,
        "stampede_gates": stampede,
        "reconnect_gates": reconnect,
        "stages": stages,
    }
    (run_out / "write-path-slo.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def evaluate_release_gate(runs: list[dict], scenario: str = "E_STEADY") -> dict:
    valid = [r for r in runs if not r.get("invalid")]
    invalid = [r for r in runs if r.get("invalid")]
    ack_p95s = [float(r["ack_p95"]) for r in valid if r.get("ack_p95") is not None]
    ack_p99s = [float(r["ack_p99"]) for r in valid if r.get("ack_p99") is not None]
    lag_p95s = [float(r["event_loop_lag_p95"]) for r in valid if r.get("event_loop_lag_p95") is not None]
    each_le_700 = bool(ack_p95s) and all(v <= 700.0 for v in ack_p95s)
    le_500_count = sum(1 for v in ack_p95s if v <= 500.0)
    at_least_2_le_500 = le_500_count >= min(2, len(ack_p95s)) if ack_p95s else False
    all_le_500 = bool(ack_p95s) and all(v <= 500.0 for v in ack_p95s)
    all_p99_le_1000 = bool(ack_p99s) and all(v <= 1000.0 for v in ack_p99s)
    denial_ok = all(int(r.get("unexpected_ws_denial") or 0) == 0 for r in valid) if valid else False
    disconnect_ok = all(int(r.get("unexpected_disconnect") or 0) == 0 for r in valid) if valid else False
    send_ok = all(int(r.get("send_errors") or 0) == 0 for r in valid) if valid else False
    scenario_u = str(scenario or "E_STEADY").strip().upper()
    if scenario_u in {"E_STAMPEDE", "STAMPEDE"}:
        ack_p99_le_1500 = bool(ack_p99s) and all(v <= 1500.0 for v in ack_p99s)
        lag_ok = (not lag_p95s) or all(v <= 300.0 for v in lag_p95s)
        stampede_pass = (
            bool(valid)
            and each_le_700
            and ack_p99_le_1500
            and disconnect_ok
            and send_ok
            and lag_ok
            and not invalid
        )
        return {
            "valid_runs": len(valid),
            "invalid_runs": len(invalid),
            "scenario": scenario_u,
            "each_ack_p95_le_700": each_le_700,
            "each_ack_p99_le_1500": ack_p99_le_1500,
            "event_loop_lag_p95_le_300": lag_ok,
            "unexpected_disconnect_eq_0": disconnect_ok,
            "send_errors_eq_0": send_ok,
            "read_503_allowed": True,
            "release_gate": stampede_pass,
            "target_stabilization": stampede_pass and lag_ok,
        }
    if scenario_u in {"E_RECONNECT", "RECONNECT"}:
        reconnect_ok = all(bool((r.get("reconnect_gates") or {}).get("pass", False)) for r in valid) if valid else False
        reconnect_pass = bool(valid) and reconnect_ok and denial_ok and send_ok and disconnect_ok and not invalid
        return {
            "valid_runs": len(valid),
            "invalid_runs": len(invalid),
            "scenario": scenario_u,
            "reconnect_objective": reconnect_ok,
            "unexpected_ws_denial_eq_0": denial_ok,
            "unexpected_disconnect_eq_0": disconnect_ok,
            "send_errors_eq_0": send_ok,
            "release_gate": reconnect_pass,
            "target_stabilization": reconnect_pass,
        }
    release_pass = (
        bool(valid)
        and each_le_700
        and at_least_2_le_500
        and denial_ok
        and disconnect_ok
        and send_ok
        and not invalid
    )
    target_pass = release_pass and all_le_500 and all_p99_le_1000
    return {
        "valid_runs": len(valid),
        "invalid_runs": len(invalid),
        "scenario": scenario_u,
        "each_ack_p95_le_700": each_le_700,
        "at_least_2_ack_p95_le_500": at_least_2_le_500,
        "all_ack_p95_le_500": all_le_500,
        "all_ack_p99_le_1000": all_p99_le_1000,
        "unexpected_ws_denial_eq_0": denial_ok,
        "unexpected_disconnect_eq_0": disconnect_ok,
        "send_errors_eq_0": send_ok,
        "release_gate": release_pass,
        "target_stabilization": target_pass,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="tmp/chat-write-path-slo")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--duration-sec", type=int, default=60)
    parser.add_argument("--seed", type=int, default=7700)
    parser.add_argument("--warmup", action="store_true", default=True)
    parser.add_argument(
        "--scenario",
        default="E_STEADY",
        help="Scenario key for run_chat_realistic_scenarios --only (default E_STEADY)",
    )
    args = parser.parse_args()
    out_dir = PROJECT_ROOT / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    scenario = str(args.scenario or "E_STEADY").strip().upper() or "E_STEADY"

    if args.warmup:
        print("=== warmup ===", flush=True)
        run_once(
            out_dir=out_dir / "warmup",
            duration=min(30, int(args.duration_sec)),
            seed=args.seed,
            run_idx=0,
            scenario=scenario,
        )

    runs = []
    for i in range(1, int(args.runs) + 1):
        print(f"=== run {i}/{args.runs} ===", flush=True)
        runs.append(
            run_once(
                out_dir=out_dir,
                duration=int(args.duration_sec),
                seed=int(args.seed),
                run_idx=i,
                scenario=scenario,
            )
        )
        time.sleep(2)

    def med(key: str) -> float | None:
        vals = [r.get(key) for r in runs if r.get(key) is not None and not r.get("invalid")]
        return float(statistics.median(vals)) if vals else None

    def worst(key: str) -> float | None:
        vals = [r.get(key) for r in runs if r.get(key) is not None and not r.get("invalid")]
        return float(max(vals)) if vals else None

    gate = evaluate_release_gate(runs, scenario=scenario)
    summary = {
        "scenario": scenario,
        "runs": len(runs),
        "median_ack_p95": med("ack_p95"),
        "worst_ack_p95": worst("ack_p95"),
        "median_ack_p99": med("ack_p99"),
        "worst_ack_p99": worst("ack_p99"),
        "median_recipient_socket_write_p95": med("recipient_socket_write_p95"),
        "worst_recipient_socket_write_p95": worst("recipient_socket_write_p95"),
        "median_recipient_socket_write_p99": med("recipient_socket_write_p99"),
        "release_gate": gate,
        "slo": {
            "ack_p95_le_500_median": (med("ack_p95") or 1e9) <= 500,
            "ack_p99_le_1000_median": (med("ack_p99") or 1e9) <= 1000,
            "recipient_socket_write_p95_le_500": (med("recipient_socket_write_p95") or 1e9) <= 500,
            "recipient_socket_write_p99_le_1000": (med("recipient_socket_write_p99") or 1e9) <= 1000,
            "release_gate": bool(gate.get("release_gate")),
            "target_stabilization": bool(gate.get("target_stabilization")),
        },
        "runs_raw": runs,
    }
    (out_dir / "SUMMARY.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Chat write-path SLO acceptance",
        "",
        f"Scenario: {scenario}",
        f"Runs: {summary['runs']}",
        f"ACK p95 median/worst: {summary['median_ack_p95']} / {summary['worst_ack_p95']}",
        f"ACK p99 median/worst: {summary['median_ack_p99']} / {summary['worst_ack_p99']}",
        f"recipient_socket_write p95 median/worst: {summary['median_recipient_socket_write_p95']} / {summary['worst_recipient_socket_write_p95']}",
        "",
        "Release gate:",
    ]
    for key, ok in (summary.get("release_gate") or {}).items():
        lines.append(f"- {key}: {ok}")
    lines.append("")
    lines.append("SLO checks:")
    for key, ok in (summary.get("slo") or {}).items():
        lines.append(f"- {key}: {'PASS' if ok else 'FAIL'}")
    (out_dir / "SUMMARY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "runs_raw"}, ensure_ascii=False, indent=2))
    return 0 if gate.get("release_gate") else 2


if __name__ == "__main__":
    raise SystemExit(main())
