# -*- coding: utf-8 -*-
"""Temporary analysis of jev_eval_report.json transitions (cycle A11 §6)."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
base = Path(__file__).parent
r = json.loads((base / "jev_eval_report.json").read_text(encoding="utf-8"))
trans = r["replay"]["transitions"]

print("=== WRONG rescues (rescued group not in expected):")
for t in trans:
    if t["rescue_wrong"]:
        print(f'{t["scenario_id"]:14s} exp={t["expected_groups"]} on={t["on_routed"]} | {t["prompt"][:70]}')

print()
print("=== CORRECT rescues:")
for t in trans:
    if t["rescue_correct"]:
        print(f'{t["scenario_id"]:14s} exp={t["expected_groups"]} on={t["on_routed"]} | {t["prompt"][:70]}')

print()
# how many wrong-rescues are permission-negative (expected group not even offered)?
# reconstruct: expected_groups non-empty but the sample unroutable. The transition
# rows don't carry asked groups; approximate: rescue lands a group while expected
# is non-empty and disjoint.
perm_neg = [t for t in trans if t["rescue_wrong"] and t["expected_groups"]]
notool = [t for t in trans if t["rescue_wrong"] and not t["expected_groups"]]
print(f"wrong with non-empty expected (incl. permission-negative): {len(perm_neg)}")
print(f"wrong on no-tool/chat scenarios: {len(notool)}")
print()
def _f(x):
    return f"{x:.3f}" if isinstance(x, (int, float)) else "—"

print("sweep data_band summary (micro recall/precision ON vs OFF per level):")
for level, grid in r["sweep"]["data_band"].items():
    on = grid["on"]["micro"]["recall"]
    off = grid["off"]["micro"]["recall"]
    onp = grid["on"]["micro"]["precision"]
    offp = grid["off"]["micro"]["precision"]
    print(f'  p={level}: recall {_f(off)}->{_f(on)} | precision {_f(offp)}->{_f(onp)}')
print()
print("sweep chat_noise summary (false-positive rate proxy: micro precision & none-routing):")
for level, grid in r["sweep"]["chat_noise"].items():
    on = grid["on"]["micro"]
    off = grid["off"]["micro"]
    print(f'  p={level}: ON precision={on["precision"]} recall={on["recall"]} | OFF precision={off["precision"]} recall={off["recall"]}')
print()
print("notool replay stats:")
for flag in ("on", "off"):
    nt = r["replay"][flag]["notool_samples"]
    print(f'  {flag}: samples={nt["samples"]} micro={nt["micro"]} exact={nt["exact_set_match"]}/{nt["samples"]}')
print()
print("permission-negative replay stats:")
for flag in ("on", "off"):
    pn = r["replay"][flag]["permission_negative"]
    print(f'  {flag}: samples={pn["samples"]} micro={pn["micro"]} exact={pn["exact_set_match"]}/{pn["samples"]}')
print()
print("mode_only bucket:", r["replay"]["mode_only_vectors"])
print()
print("dedup robustness (routable):")
for flag in ("on", "off"):
    dd = r["replay"][flag]["routable_dedup"]
    print(f'  {flag}: samples={dd["samples"]} micro={dd["micro"]}')
