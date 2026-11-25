# -*- coding: utf-8 -*-
"""Recompute expect_failures + correctness in real_run_fin_*.json with the
final check semantics (scope_downgraded only fails when a scope=all call ran
without the flag). Entries store executed args, so this is pure re-evaluation
of recorded data — no re-run needed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _expect_failures(entry: dict) -> list[str]:
    expect = ((entry.get("expect") or {}).get("spec")) or {}
    executed = (entry.get("tools") or {}).get("executed") or []
    flags = entry.get("flags") or {}
    fails: list[str] = []
    if "tool_result_total" in expect:
        want = int(expect["tool_result_total"])
        got = [t.get("result_total") for t in executed if t.get("result_total") is not None]
        if want not in [int(v) for v in got]:
            fails.append(f"tool_result_total: want {want}, got {got or 'no trace'}")
    if expect.get("scope_downgraded") is not None:
        want_sd = bool(expect["scope_downgraded"])
        scope_all = [t for t in executed
                     if str((t.get("args") or {}).get("scope") or "").lower() == "all"]
        if scope_all:
            got_sd = all(bool(t.get("scope_downgraded")) for t in scope_all)
            if got_sd != want_sd:
                fails.append(f"scope_downgraded: want {want_sd} for scope=all calls, got {got_sd}")
    if expect.get("tool_error") is not None:
        want_te = bool(expect["tool_error"])
        got_te = any(t.get("error") for t in executed)
        if got_te != want_te:
            fails.append(f"tool_error: want {want_te}, got {got_te}")
    for flag in ("direct_read_hit", "fast_path_hit"):
        if expect.get(flag) is not None:
            if bool(flags.get(flag)) != bool(expect[flag]):
                fails.append(f"{flag}: want {bool(expect[flag])}, got {bool(flags.get(flag))}")
    return fails


def _correctness(entry: dict, fails: list[str]) -> str:
    tools = entry.get("tools") or {}
    facts = entry.get("facts") or {}
    checks = bool(tools.get("expected_hit") or tools.get("expected_missing")
                  or facts.get("required") or facts.get("forbidden")
                  or ((entry.get("expect") or {}).get("spec")))
    if entry.get("outcome") == "failed":
        return "FAIL" if checks else "NO_CHECK"
    if (tools.get("expected_missing") or tools.get("forbidden_hit")
            or facts.get("missing") or facts.get("forbidden_hit") or fails):
        return "FAIL"
    return "PASS" if checks else "NO_CHECK"


def main() -> int:
    changed = []
    for path in sorted(HERE.glob("real_run_fin_*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        dirty = False
        for s in data.get("scenarios") or []:
            old_fails = list(((s.get("expect") or {}).get("failures")) or [])
            old_corr = s.get("correctness")
            new_fails = _expect_failures(s)
            s.setdefault("expect", {})["failures"] = new_fails
            s["correctness"] = _correctness(s, new_fails)
            if new_fails != old_fails or s["correctness"] != old_corr:
                dirty = True
                changed.append(f"{path.name}:{s.get('id')} {old_corr}->{s['correctness']}")
        if dirty:
            sc = data["scenarios"]
            data.setdefault("aggregate", {})["correctness"] = {
                "PASS": sum(1 for x in sc if x["correctness"] == "PASS"),
                "FAIL": sum(1 for x in sc if x["correctness"] == "FAIL"),
                "NO_CHECK": sum(1 for x in sc if x["correctness"] == "NO_CHECK"),
            }
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n".join(changed) or "no changes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
