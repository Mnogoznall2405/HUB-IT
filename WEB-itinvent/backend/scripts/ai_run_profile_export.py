#!/usr/bin/env python3
"""Export per-run AI profile metrics from a worker log into JSON.

Parses the correlated A5.1 log lines — ``ai_chat.run.<stage>`` laps,
``ai_jev_routing`` / ``ai_jev_routing_cache``, ``ai_run_profile`` and
``ai_run_profile_final`` — keyed by the real ``run_id``.

Report shape::

    {
      "runs": N, "profiles": {"complete": n, "incomplete": n},
      "jev_cache": {"hit": n, "miss": n, "none": n},
      "by_outcome": {"completed": {...}, "failed": {...}, "cancelled": {...}},
      "stages": {stage: {count, rounds, p50_ms, p95_ms, mean_ms}},
      "by_intent_mode": {mode: {count, elapsed p50/p95, "stages": {...}}},
      "by_cache": {"hit": {"jev_ms": {...}, "server_total_ms": {...}}, ...},
      "tokens": {...}
    }

Repeated laps in one run (e.g. ``llm_followup`` per tool round, ``tools``
per round) are aggregated per run first — stages are never double-counted
into a fake total; ``server_total_ms`` from ``ai_run_profile_final`` is the
authoritative total (queue wait + processing, server-side only — NOT client
TTFT).

Usage (from WEB-itinvent):

    python -m backend.scripts.ai_run_profile_export --log worker.log --out profile.json
    type worker.log | python -m backend.scripts.ai_run_profile_export --log -
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import statistics
import sys

LAP_RE = re.compile(r"ai_chat\.run\.([\w.]+)\s+duration_ms=([\d.]+)(.*)")
JEV_RE = re.compile(r"ai_jev_routing(?:\(mode=\w+\))?.*latency_ms=([\d.]+).*run_id=(\S+)")
CACHE_RE = re.compile(r"ai_jev_routing_cache\s+(hit|miss)\s+.*run_id=(\S+)")
PROFILE_RE = re.compile(r"ai_run_profile(_final)?\s+(.*)")
KV_RE = re.compile(r"(\w+)=([^\s]+)")


def _parse_profile_fields(text: str) -> dict[str, str]:
    """Strict ``key=value`` parser for profile lines.

    Values may be Python-formatted lists containing spaces and commas
    (``used_tools=['a', 'b']``). The previous ``\\w+=\\S+`` regex truncated
    such values at the first space and silently dropped every element after
    the first — this parser walks balanced brackets instead. No ``eval``.
    """
    fields: dict[str, str] = {}
    i, n = 0, len(text)
    while i < n:
        m = re.match(r"\s*(\w+)=", text[i:])
        if not m:
            break
        key = m.group(1)
        i += m.end()
        if i < n and text[i] == "[":
            depth, j, quote = 0, i, None
            while j < n:
                ch = text[j]
                if quote:
                    if ch == quote and text[j - 1] != "\\":
                        quote = None
                elif ch in "'\"":
                    quote = ch
                elif ch == "[":
                    depth += 1
                elif ch == "]":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            fields[key] = text[i:j]
            i = j
        else:
            m2 = re.match(r"[^\s]+", text[i:])
            if not m2:
                break
            fields[key] = m2.group(0)
            i += m2.end()
    return fields


def _parse_list(value: object) -> list[str]:
    """Parse a Python-formatted list literal into strings.

    ``ast.literal_eval`` only (never ``eval``). A malformed literal falls
    back to splitting on commas so one bad list cannot hide the rest.
    """
    raw = str(value or "").strip()
    if not raw or raw in ("[]", "-", "None"):
        return []
    if not raw.startswith("["):
        return [raw.strip("'\"")]
    try:
        parsed = ast.literal_eval(raw)
    except (ValueError, SyntaxError, MemoryError, TypeError):
        return [item.strip().strip("'\"") for item in raw.strip("[]").split(",") if item.strip()]
    if isinstance(parsed, (list, tuple, set)):
        return [str(item) for item in parsed]
    return [str(parsed)]


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((q / 100.0) * (len(ordered) - 1)))))
    return round(ordered[idx], 1)


def _summary(values: list[float], rounds: int | None = None) -> dict:
    out = {
        "count": len(values),
        "p50_ms": _percentile(values, 50),
        "p95_ms": _percentile(values, 95),
        "mean_ms": round(statistics.fmean(values), 1) if values else None,
    }
    if rounds is not None:
        out["rounds"] = rounds
    return out


def _f(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--log", required=True, help="worker log path or '-' for stdin")
    parser.add_argument("--out", default="", help="optional JSON output path")
    args = parser.parse_args()

    lines = sys.stdin if args.log == "-" else open(args.log, encoding="utf-8", errors="replace")
    runs: dict[str, dict] = {}
    parse_errors = 0

    def run(rid: str) -> dict:
        return runs.setdefault(rid, {"laps": {}})

    for raw in lines:
        line = raw.rstrip("\n")
        m = LAP_RE.search(line)
        if m:
            stage, duration, rest = m.group(1), float(m.group(2)), m.group(3)
            kv = dict(KV_RE.findall(rest))
            entry = run(kv.get("run_id", "-"))
            if stage == "queue_wait":
                entry["queue_wait_ms"] = duration
            else:
                laps = entry["laps"].setdefault(stage, {"total": 0.0, "count": 0})
                laps["total"] += duration
                laps["count"] += 1
            continue
        m = JEV_RE.search(line)
        if m:
            run(m.group(2))["jev_ms"] = float(m.group(1))
            continue
        m = CACHE_RE.search(line)
        if m:
            run(m.group(2))["jev_cache"] = m.group(1)
            continue
        m = PROFILE_RE.search(line)
        if m:
            try:
                kv = _parse_profile_fields(m.group(2))
            except Exception:  # a damaged line must not stop the whole file
                parse_errors += 1
                continue
            rid = kv.get("run_id", "-")
            if not m.group(1):
                run(rid)["profile"] = kv
                continue
            if len(kv) < 3:
                # A final profile with a lone run_id is a damaged line —
                # count it, never turn it into a phantom completed run.
                parse_errors += 1
                continue
            run(rid)["final"] = {
                "outcome": kv.get("outcome") or "completed",
                "intent": kv.get("intent"),
                "queue_wait_ms": _f(kv.get("queue_wait_ms")),
                "processing_ms": _f(kv.get("processing_ms") or kv.get("elapsed_ms")),
                "server_total_ms": _f(kv.get("server_total_ms") or kv.get("elapsed_ms")),
                "mode_denied": int(_f(kv.get("mode_denied"))),
                "used_tools": _parse_list(kv.get("used_tools")),
                "error_tools": _parse_list(kv.get("error_tools")),
                "meta_calls": int(_f(kv.get("meta_calls"))),
                "prompt_tokens": kv.get("prompt_tokens"),
                "completion_tokens": kv.get("completion_tokens"),
                "total_tokens": kv.get("total_tokens"),
            }

    def finals(pred=lambda r: True):
        return [r["final"] for r in runs.values() if "final" in r and pred(r)]

    # --- stages: per-run totals first (multi-round laps merged, no doubling)
    stages: dict[str, dict] = {}
    all_laps: dict[str, list[float]] = {}
    all_rounds: dict[str, int] = {}
    for entry in runs.values():
        for stage, agg in entry["laps"].items():
            all_laps.setdefault(stage, []).append(agg["total"])
            all_rounds[stage] = all_rounds.get(stage, 0) + agg["count"]
    for stage, vals in sorted(all_laps.items()):
        stages[stage] = _summary(vals, rounds=all_rounds[stage])
    stages["queue_wait"] = _summary([r["queue_wait_ms"] for r in runs.values() if "queue_wait_ms" in r])
    stages["processing"] = _summary([f["processing_ms"] for f in finals() if f["processing_ms"]])
    stages["server_total"] = _summary([f["server_total_ms"] for f in finals() if f["server_total_ms"]])

    # --- per intent mode: totals + per-stage
    by_mode: dict[str, dict] = {}
    for entry in runs.values():
        intent = (entry.get("final") or {}).get("intent") or "-"
        bucket = by_mode.setdefault(intent, {"count": 0, "server_total": [], "laps": {}})
        bucket["count"] += 1
        if (entry.get("final") or {}).get("server_total_ms"):
            bucket["server_total"].append(entry["final"]["server_total_ms"])
        for stage, agg in entry["laps"].items():
            bucket["laps"].setdefault(stage, []).append(agg["total"])
    by_mode = {
        mode: {
            "count": b["count"],
            "server_total": _summary(b["server_total"]),
            "stages": {s: _summary(v) for s, v in sorted(b["laps"].items())},
        }
        for mode, b in sorted(by_mode.items())
    }

    # --- cache hit/miss: JEV decision latency + full server time
    by_cache: dict[str, dict] = {}
    for entry in runs.values():
        flag = entry.get("jev_cache") or "none"
        bucket = by_cache.setdefault(flag, {"jev_ms": [], "server_total_ms": []})
        if entry.get("jev_ms"):
            bucket["jev_ms"].append(entry["jev_ms"])
        final = entry.get("final") or {}
        if final.get("server_total_ms"):
            bucket["server_total_ms"].append(final["server_total_ms"])
    by_cache = {k: {kk: _summary(vv) for kk, vv in b.items()} for k, b in sorted(by_cache.items())}

    # --- outcomes
    by_outcome = {}
    for outcome in ("completed", "failed", "cancelled"):
        sel = [f for f in finals() if f.get("outcome") == outcome]
        by_outcome[outcome] = {
            "count": len(sel),
            "server_total": _summary([f["server_total_ms"] for f in sel if f["server_total_ms"]]),
        }

    token_finals = [f for f in finals() if f.get("total_tokens")]
    used = [t for f in finals() for t in f["used_tools"]]
    errs = [t for f in finals() for t in f["error_tools"]]
    report = {
        "runs": len(runs),
        "profiles": {
            "complete": sum(1 for r in runs.values() if "final" in r),
            "incomplete": sum(1 for r in runs.values() if "final" not in r),
        },
        "parse_errors": parse_errors,
        "jev_cache": {
            "hit": sum(1 for r in runs.values() if r.get("jev_cache") == "hit"),
            "miss": sum(1 for r in runs.values() if r.get("jev_cache") == "miss"),
            "none": sum(1 for r in runs.values() if not r.get("jev_cache")),
        },
        "by_outcome": by_outcome,
        "stages": stages,
        "by_intent_mode": by_mode,
        "by_cache": by_cache,
        "tools": {
            "executed_calls": len(used),
            "error_calls": len(errs),
            "mode_denied_calls": sum(f["mode_denied"] for f in finals()),
            "meta_calls": sum(f["meta_calls"] for f in finals()),
        },
        "tokens": {
            "count": len(token_finals),
            "prompt_p50": _percentile([_f(r["prompt_tokens"]) for r in token_finals if r.get("prompt_tokens")], 50),
            "completion_p50": _percentile([_f(r["completion_tokens"]) for r in token_finals if r.get("completion_tokens")], 50),
            "total_p50": _percentile([_f(r["total_tokens"]) for r in token_finals], 50),
            "total_p95": _percentile([_f(r["total_tokens"]) for r in token_finals], 95),
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
