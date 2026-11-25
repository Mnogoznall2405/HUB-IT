# -*- coding: utf-8 -*-
"""A10 cycle 2 §7 — real A/B benchmark driver, configurations A–G.

Runs a9_real_run.py over the SAME corpus, same provider, same model for each
flag configuration. Results are written per-config JSON; a summary JSON is
emitted at the end. Pairwise provider-failure retries are handled inside the
harness itself (--provider-retries); this driver only orders the configs and
never substitutes failed calls with zero usage (the harness records
cost_missing_calls instead).

Configs (§7):
  A  upstream main (baseline worktree, no A9/A10 code) — run separately with
     the baseline copy of the harness; this driver covers B–G on one tree.
  B  A9 ON (default flags)
  C  A9 ON + A10 OFF  (identical to B on the merged tree — run once, reused)
  D  B + AI_READ_FAST_PATH_ENABLED=1
  E  D + AI_DIRECT_READ_ENABLED=1
  F  E + AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED=1
  G  F + AI_RUN_RESULT_REUSE_ENABLED=1  (all accepted A10 optimizations)

Usage:
  python ab_driver.py --provider openrouter --corpus bench_seeded_corpus.json \
      --seed --smoke
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "a9_real_run.py"

CONFIGS = [
    ("B", "a9on", []),
    ("D", "fastpath", ["AI_READ_FAST_PATH_ENABLED=1"]),
    ("E", "directread", ["AI_READ_FAST_PATH_ENABLED=1", "AI_DIRECT_READ_ENABLED=1"]),
    ("F", "planner", ["AI_READ_FAST_PATH_ENABLED=1", "AI_DIRECT_READ_ENABLED=1",
                      "AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED=1"]),
    ("G", "all", ["AI_READ_FAST_PATH_ENABLED=1", "AI_DIRECT_READ_ENABLED=1",
                  "AI_MEMORY_PLANNER_OPTIMIZATION_ENABLED=1",
                  "AI_RUN_RESULT_REUSE_ENABLED=1"]),
]
# C == B on the merged A9+A10 tree (A10 flags default OFF); note in summary.


def _parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="openrouter")
    ap.add_argument("--corpus", default="bench_seeded_corpus.json")
    ap.add_argument("--seed", action="store_true")
    ap.add_argument("--smoke", action="store_true", help="first 4 scenarios only")
    ap.add_argument("--provider-retries", type=int, default=2)
    ap.add_argument("--configs", default="BCDEFG")
    return ap.parse_args()


def main() -> int:
    args = _parse_args()
    corpus_path = Path(args.corpus)
    if not corpus_path.is_absolute():
        corpus_path = HERE / args.corpus
    summary: dict[str, dict] = {}
    for letter, label, flags in CONFIGS:
        if letter not in args.configs.upper():
            continue
        out = HERE / f"real_run_c2_{label}.json"
        cmd = [
            sys.executable, "-X", "utf8", str(HARNESS),
            "--label", f"c2_{label}",
            "--provider", args.provider,
            "--corpus", str(corpus_path),
            "--out", str(out),
            "--provider-retries", str(args.provider_retries),
            "--jev", "1", "--a9", "on",
        ]
        for kv in flags:
            cmd += ["--set", kv]
        if args.seed:
            cmd.append("--seed")
        if args.smoke:
            cmd += ["--limit", "4"]
        print(f"[ab_driver] === config {letter} ({label}) -> {out.name}", flush=True)
        proc = subprocess.run(cmd, cwd=str(HERE))
        print(f"[ab_driver] config {letter} exit={proc.returncode}", flush=True)
        try:
            data = json.loads(out.read_text(encoding="utf-8"))
            agg = data.get("aggregate") or {}
            summary[letter] = {
                "label": label,
                "flags": flags,
                "outcomes": agg.get("outcomes"),
                "correctness": agg.get("correctness"),
                "llm_calls_total": agg.get("llm_calls_total"),
                "tokens_in_total": agg.get("tokens_in_total"),
                "exit": proc.returncode,
            }
        except Exception as exc:  # noqa: BLE001
            summary[letter] = {"label": label, "error": str(exc), "exit": proc.returncode}
    summary["_note"] = (
        "Config C (A9 ON + A10 OFF) is identical to B on the merged tree — "
        "A10 flags default OFF; B's numbers serve for C."
    )
    sp = HERE / "ab_summary.json"
    sp.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ab_driver] summary -> {sp}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
