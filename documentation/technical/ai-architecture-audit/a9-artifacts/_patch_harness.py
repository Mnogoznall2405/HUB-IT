"""One-off patch: add --resume + provider fail-fast to a9_real_run.py (A11 c2 §16)."""
from pathlib import Path

p = Path(__file__).parent / "a9_real_run.py"
src = p.read_text(encoding="utf-8")

# 1. --resume argument next to --seed
anchor = 'add_argument("--provider-retries"'
i = src.find(anchor)
assert i > 0, "provider-retries arg not found"
line_end = src.find("\n", i)
# find the end of that add_argument statement (may span lines)
stmt_end = src.find(")", line_end) + 1
inject = (
    '\nadd_argument("--resume", choices=("0", "1"), default="0",\n'
    '             help="reuse completed/degraded entries from the existing out file; "\n'
    '                  "re-run only failed or missing scenarios (hash-verified)")\n'
    'add_argument("--failfast", type=int, default=5,\n'
    '             help="abort after N consecutive provider-failed scenarios (0=never)")\n'
)
src = src[:stmt_end] + inject + src[stmt_end:]

# 2. resume preload right after results dict is fully initialized — inject before the loop banner print
banner = 'print(f"[a9_real v2] {len(scenarios)} scenarios'
bi = src.find(banner)
assert bi > 0, "banner not found"
resume_code = '''
# --- A11 c2 §16: resume ------------------------------------------------------
# Reuse entries whose run actually completed (completed/degraded) from the
# existing artifact; re-run failed/missing ones. Version mixing is refused:
# code/corpus/seed hashes must match exactly.
_reusable: dict[str, dict] = {}
if _args.resume == "1" and out_path.exists():
    try:
        _prev = json.loads(out_path.read_text(encoding="utf-8"))
        _prev_env = _prev.get("env") or {}
        _mismatches = [
            key for key in ("code_sha", "corpus_sha256", "seed_sha256")
            if _prev_env.get(key) and results["env"].get(key) and _prev_env.get(key) != results["env"].get(key)
        ]
        if _mismatches:
            print(f"[resume] REFUSED: hash mismatch {_mismatches} — results would mix versions", flush=True)
        else:
            for _e in (_prev.get("scenarios") or []):
                if _e.get("outcome") in ("completed", "degraded") and (_e.get("answer") or {}).get("body"):
                    _reusable[_e["id"]] = _e
            print(f"[resume] reusing {len(_reusable)} completed entries, re-running the rest", flush=True)
    except Exception as _exc:  # noqa: BLE001
        print(f"[resume] failed to load previous artifact: {_exc} — full run", flush=True)

_consecutive_provider_failures = 0

'''
src = src[:bi] + resume_code + src[bi:]

# 3. skip logic inside the loop — right after sid/category/prompt are set
loop_anchor = '    sid = scenario["id"]\n'
li = src.find(loop_anchor)
assert li > 0, "loop sid not found"
skip_code = loop_anchor + (
    '    if sid in _reusable:\n'
    '        results["scenarios"].append(_reusable[sid])\n'
    '        print(f"[{idx}/{len(scenarios)}] {sid}: reused ({_reusable[sid][\\"outcome\\"]}/{_reusable[sid][\\"correctness\\"]})", flush=True)\n'
    '        continue\n'
)
src = src[:li] + skip_code + src[li + len(loop_anchor):]

# 4. fail-fast tracking after entry appended — hook into the per-scenario dump
dump_anchor = '    _dump()\n\n# aggregate'
di = src.find(dump_anchor)
assert di > 0, "dump anchor not found"
failfast_code = '''    _dump()
    # §16 fail-fast: a provider outage must not burn the whole corpus (and the
    # quota) with garbage failures. Consecutive provider-only failures trip it.
    if entry["outcome"] == "failed" and entry["errors"]["provider"] and not entry["errors"]["app"]:
        _consecutive_provider_failures += 1
    else:
        _consecutive_provider_failures = 0
    if _args.failfast and _consecutive_provider_failures >= _args.failfast:
        results["aborted"] = f"provider_outage after {_consecutive_provider_failures} consecutive failures"
        print(f"[failfast] {results['aborted']} — aborting; use --resume 1 after recovery", flush=True)
        break

# aggregate'''
src = src[:di] + failfast_code + src[di + len(dump_anchor):]

# 5. aborted marker into aggregate
agg_anchor = 'results["aggregate"] = agg'
ai = src.find(agg_anchor)
assert ai > 0
src = src[:ai] + 'if results.get("aborted"):\n    agg["aborted"] = results["aborted"]\n' + src[ai:]

p.write_text(src, encoding="utf-8", newline="")
print("patched OK")
