# -*- coding: utf-8 -*-
"""A10 sign-off §3 — unified final benchmark artifact.

Merges per-config real_run_fin_*.json files into one JSON with:
  * env provenance (code_sha, model, provider, flags, corpus/seed sha256)
    verified to be IDENTICAL across configs where required;
  * per-scenario matrix (outcome/correctness/llm_calls/wall_ms/tokens);
  * per-config totals plus p50/p95 wall_ms computed on correctness-PASS
    scenarios only — wrong answers are never counted as "optimization";
  * F-vs-G pairwise comparison on the shared scenario set.

Usage: python finalize_benchmark.py [--dir <artifacts>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

CONFIGS = [
    ("A", "real_run_fin_A.json", "upstream main (baseline)"),
    ("B", "real_run_fin_a9on.json", "A9 ON (A10 flags OFF)"),
    ("D", "real_run_fin_fastpath.json", "B + READ fast path"),
    ("E", "real_run_fin_directread.json", "D + direct read"),
    ("F", "real_run_fin_planner.json", "E + memory planner opt"),
    ("G", "real_run_fin_all.json", "F + result reuse"),
]


def _pctile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    vals = sorted(values)
    k = (len(vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(vals) - 1)
    return round(vals[lo] + (vals[hi] - vals[lo]) * (k - lo), 1)


def _load(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[finalize] WARN cannot load {path.name}: {exc}", file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(Path(__file__).resolve().parent))
    args = ap.parse_args()
    here = Path(args.dir)

    runs: dict[str, dict] = {}
    for letter, fname, desc in CONFIGS:
        data = _load(here / fname)
        if data is not None:
            runs[letter] = {"file": fname, "desc": desc, "data": data}
    missing = [l for l, _, _ in CONFIGS if l not in runs]
    if missing:
        print(f"[finalize] missing configs: {missing}", file=sys.stderr)

    # --- env consistency -------------------------------------------------
    env_issues = []
    base_env = None
    for letter in ("A", "B", "D", "E", "F", "G"):
        env = (runs.get(letter) or {}).get("data", {}).get("env") or {}
        if base_env is None:
            base_env = env
            continue
        for key in ("provider", "ROUTERAI_MODEL", "OPENROUTER_MODEL",
                    "corpus_sha256", "seed_sha256", "actor"):
            if env.get(key) != base_env.get(key):
                env_issues.append(f"{key}: A={base_env.get(key)} {letter}={env.get(key)}")

    # --- per-config stats --------------------------------------------------
    configs_out: dict[str, dict] = {}
    matrix: dict[str, dict] = {}
    for letter, info in runs.items():
        data = info["data"]
        env = data.get("env") or {}
        scenarios = [s for s in (data.get("scenarios") or []) if isinstance(s, dict)]
        passes = [s for s in scenarios if s.get("correctness") == "PASS"]
        fails = [s for s in scenarios if s.get("correctness") == "FAIL"]
        configs_out[letter] = {
            "desc": info["desc"],
            "file": info["file"],
            "code_sha": env.get("code_sha"),
            "model": env.get("ROUTERAI_MODEL") or env.get("OPENROUTER_MODEL"),
            "provider": env.get("provider"),
            "flags": env.get("flags"),
            "corpus_sha256": env.get("corpus_sha256"),
            "seed_sha256": env.get("seed_sha256"),
            "scenarios": len(scenarios),
            "correctness": (data.get("aggregate") or {}).get("correctness"),
            "llm_calls_total": sum(int(s.get("llm_calls") or 0) for s in scenarios),
            "jev_calls_total": sum(int(s.get("jev_calls") or 0) for s in scenarios),
            "tool_calls_total": sum(len(s.get("tools", {}).get("executed_ids") or []) for s in scenarios),
            "tokens_in_total": sum(int((s.get("tokens") or {}).get("llm_in") or 0) for s in scenarios),
            "tokens_out_total": sum(int((s.get("tokens") or {}).get("llm_out") or 0) for s in scenarios),
            "wall_ms_total": sum(int(s.get("wall_ms") or 0) for s in scenarios),
            "pass_only": {
                "n": len(passes),
                "wall_ms_p50": _pctile([s["wall_ms"] for s in passes], 0.50),
                "wall_ms_p95": _pctile([s["wall_ms"] for s in passes], 0.95),
                "llm_calls_p50": _pctile([s["llm_calls"] for s in passes], 0.50),
                "llm_calls_p95": _pctile([s["llm_calls"] for s in passes], 0.95),
                "tokens_in_p50": _pctile([(s.get("tokens") or {}).get("llm_in") or 0 for s in passes], 0.50),
                "tokens_in_p95": _pctile([(s.get("tokens") or {}).get("llm_in") or 0 for s in passes], 0.95),
            },
            "fail_scenarios": [s.get("id") for s in fails],
        }
        for s in scenarios:
            row = matrix.setdefault(s.get("id") or "?", {})
            row[letter] = {
                "correctness": s.get("correctness"),
                "outcome": s.get("outcome"),
                "llm_calls": s.get("llm_calls"),
                "wall_ms": s.get("wall_ms"),
                "tokens_in": (s.get("tokens") or {}).get("llm_in"),
                "tools": (s.get("tools") or {}).get("executed_ids"),
                "expect_failures": (s.get("expect") or {}).get("failures"),
            }

    # --- F vs G pairwise (same scenario set) --------------------------------
    f_vs_g = None
    if "F" in runs and "G" in runs:
        f_ids = {s.get("id") for s in runs["F"]["data"].get("scenarios") or []}
        g_ids = {s.get("id") for s in runs["G"]["data"].get("scenarios") or []}
        shared = sorted(f_ids & g_ids)
        f_by = {s.get("id"): s for s in runs["F"]["data"]["scenarios"]}
        g_by = {s.get("id"): s for s in runs["G"]["data"]["scenarios"]}
        f_vs_g = {
            "shared_scenarios": shared,
            "f_only": sorted(f_ids - g_ids),
            "g_only": sorted(g_ids - f_ids),
            "per_scenario": {
                sid: {
                    "F": {"llm_calls": f_by[sid].get("llm_calls"),
                          "tokens_in": (f_by[sid].get("tokens") or {}).get("llm_in"),
                          "wall_ms": f_by[sid].get("wall_ms"),
                          "correctness": f_by[sid].get("correctness")},
                    "G": {"llm_calls": g_by[sid].get("llm_calls"),
                          "tokens_in": (g_by[sid].get("tokens") or {}).get("llm_in"),
                          "wall_ms": g_by[sid].get("wall_ms"),
                          "correctness": g_by[sid].get("correctness")},
                } for sid in shared
            },
            "reuse_wins": [
                sid for sid in shared
                if (g_by[sid].get("llm_calls") or 0) < (f_by[sid].get("llm_calls") or 0)
            ],
        }

    out = {
        "title": "A9/A10 final benchmark — unified artifact",
        "env_consistency_issues": env_issues,
        "configs": configs_out,
        "scenario_matrix": matrix,
        "f_vs_g": f_vs_g,
        "note": "pass_only percentiles exclude FAIL/NO_CHECK so wrong answers are never counted as optimization.",
    }
    out_path = here / "final_benchmark.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "wrote": str(out_path),
        "env_issues": env_issues,
        "per_config": {l: {"pass": (c.get("correctness") or {}).get("PASS"),
                           "fail": (c.get("correctness") or {}).get("FAIL"),
                           "llm": c["llm_calls_total"],
                           "tok_in": c["tokens_in_total"],
                           "wall_s": round(c["wall_ms_total"] / 1000)}
                       for l, c in configs_out.items()},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
