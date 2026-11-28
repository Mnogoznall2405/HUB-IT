"""Quick benchmark artifact analysis — usage: python _analyze.py <run.json> [--full]"""
import json
import sys
from collections import Counter

path = sys.argv[1] if len(sys.argv) > 1 else "real_run_a11devbase.json"
full = "--full" in sys.argv
d = json.load(open(path, encoding="utf-8"))
sc = d["scenarios"]
cats = Counter()
fails_by_cat = Counter()
for s in sc:
    cat = s["id"].split("_")[0]
    cats[cat] += 1
    if s.get("correctness") != "PASS":
        fails_by_cat[cat] += 1
print("total:", len(sc), "PASS:", sum(1 for s in sc if s.get("correctness") == "PASS"))
print("fail/total by cat:", {c: f"{fails_by_cat[c]}/{cats[c]}" for c in sorted(cats)})
nofailures = 0
errtools = 0
notools = 0
for s in sc:
    if s.get("correctness") == "PASS":
        continue
    fl = (s.get("expect") or {}).get("failures") or []
    if not fl:
        nofailures += 1
    ex = s["tools"]["executed"]
    if any(e.get("state") == "error" for e in ex):
        errtools += 1
    if not ex:
        notools += 1
print("fails w/o expect-failures:", nofailures, "| with tool errors:", errtools, "| no tools at all:", notools)
if full:
    for s in sc:
        if s.get("correctness") == "PASS":
            continue
        fl = (s.get("expect") or {}).get("failures") or []
        ex = s["tools"]["executed"]
        err1 = next((str(e.get("error"))[:70] for e in ex if e.get("state") == "error"), "")
        print(s["id"], "| tools:", s["tools"]["executed_ids"][:3], "| exp:", str(fl[:1])[:80] if fl else "-", "| err:", err1)
