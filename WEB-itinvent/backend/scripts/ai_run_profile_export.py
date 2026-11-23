#!/usr/bin/env python3
"""Export per-run AI profile metrics from a worker log into JSON.

Parses the correlated A5/A5.1 log lines — ``ai_chat.run.<stage>`` laps,
``ai_jev_routing_cache`` hit/miss, ``ai_run_profile`` and
``ai_run_profile_final`` — keyed by the real ``run_id``, then reports
p50/p95 per stage and per intent mode. Stage laps are reported
individually; wall-clock ``elapsed_ms`` from ``ai_run_profile_final`` is
the authoritative total — nested stages are never summed.

Usage (from WEB-itinvent):

    python -m backend.scripts.ai_run_profile_export --log worker.log --out profile.json
    type worker.log | python -m backend.scripts.ai_run_profile_export --log -
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys

LAP_RE = re.compile(r"ai_chat\.run\.([\w.]+)\s+duration_ms=([\d.]+)(.*)")
KV_RE = re.compile(r"(\w+)=([^\s]+)")
CACHE_RE = re.compile(r"ai_jev_routing_cache\s+(hit|miss)\s+.*run_id=(\S+)")
PROFILE_RE = re.compile(r"ai_run_profile(_final)?\s+(.*)")


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((q / 100.0) * (len(ordered) - 1)))))
    return round(ordered[idx], 1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, help="worker log path or '-' for stdin")
    parser.add_argument("--out", default="", help="optional JSON output path")
    args = parser.parse_args()

    lines = sys.stdin if args.log == "-" else open(args.log, encoding="utf-8", errors="replace")
    runs: dict[str, dict] = {}
    stages: dict[str, list[float]] = {}
    cache = {"hit": 0, "miss": 0}

    for raw in lines:
        line = raw.rstrip("\n")
        m = LAP_RE.search(line)
        if m and "queue_wait" not in m.group(1):
            stage, duration, rest = m.group(1), float(m.group(2)), m.group(3)
            run_id = (KV_RE.search(rest) or [None, "-"])[1] if "run_id=" in rest else "-"
            kv = dict(KV_RE.findall(rest))
            run_id = kv.get("run_id", "-")
            stages.setdefault(stage, []).append(duration)
            runs.setdefault(run_id, {}).setdefault("laps", {})[stage] = duration
            continue
        m = LAP_RE.search(line) if "queue_wait" in line else None
        if m and m.group(1) == "queue_wait":
            kv = dict(KV_RE.findall(m.group(3)))
            rid = kv.get("run_id", "-")
            runs.setdefault(rid, {})["queue_wait_ms"] = float(m.group(2))
            continue
        m = CACHE_RE.search(line)
        if m:
            cache[m.group(1)] += 1
            runs.setdefault(m.group(2), {})["jev_cache"] = m.group(1)
            continue
        m = PROFILE_RE.search(line)
        if m:
            is_final = bool(m.group(1))
            kv = dict(KV_RE.findall(m.group(2)))
            rid = kv.get("run_id", "-")
            entry = runs.setdefault(rid, {})
            key = "final" if is_final else "profile"
            entry[key] = {
                "intent": kv.get("intent"),
                "queue_wait_ms": float(kv.get("queue_wait_ms") or 0),
                "elapsed_ms": float(kv.get("elapsed_ms") or 0),
                "mode_denied": int(kv.get("mode_denied") or 0),
                "prompt_tokens": kv.get("prompt_tokens"),
                "completion_tokens": kv.get("completion_tokens"),
                "total_tokens": kv.get("total_tokens"),
            }

    def stage_summary(vals: list[float]) -> dict:
        return {
            "count": len(vals),
            "p50_ms": _percentile(vals, 50),
            "p95_ms": _percentile(vals, 95),
            "mean_ms": round(statistics.fmean(vals), 1) if vals else None,
        }

    by_stage = {stage: stage_summary(vals) for stage, vals in sorted(stages.items())}
    by_stage["queue_wait"] = stage_summary(
        [r["queue_wait_ms"] for r in runs.values() if "queue_wait_ms" in r]
    )
    by_stage["total_elapsed"] = stage_summary(
        [r["final"]["elapsed_ms"] for r in runs.values() if "final" in r and r["final"]["elapsed_ms"]]
    )

    by_mode: dict[str, dict] = {}
    for run in runs.values():
        final = run.get("final") or {}
        intent = final.get("intent") or "-"
        bucket = by_mode.setdefault(intent, {"count": 0, "elapsed": []})
        bucket["count"] += 1
        if final.get("elapsed_ms"):
            bucket["elapsed"].append(final["elapsed_ms"])
    by_mode = {
        mode: {"count": b["count"], **stage_summary(b["elapsed"])}
        for mode, b in sorted(by_mode.items())
    }

    token_runs = [
        r["final"] for r in runs.values()
        if "final" in r and r["final"].get("total_tokens")
    ]
    report = {
        "runs": len(runs),
        "jev_cache": cache,
        "stages": by_stage,
        "by_intent_mode": by_mode,
        "tokens": {
            "count": len(token_runs),
            "prompt_p50": _percentile([float(r["prompt_tokens"]) for r in token_runs if r.get("prompt_tokens")], 50),
            "completion_p50": _percentile([float(r["completion_tokens"]) for r in token_runs if r.get("completion_tokens")], 50),
            "total_p50": _percentile([float(r["total_tokens"]) for r in token_runs], 50),
            "total_p95": _percentile([float(r["total_tokens"]) for r in token_runs], 95),
        },
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
