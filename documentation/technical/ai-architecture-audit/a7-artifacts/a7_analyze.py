"""Join a7_results.jsonl with worker-log profiles -> a7_enriched.json + summary stats."""
import json, re, io, sys, statistics

LOG = r"C:\Users\Администратор\.pm2\logs\itinvent-ai-chat-worker-error.log"
RES = r"C:\Project\Image_scan\.codex_tmp\a7_results.jsonl"
OUT = r"C:\Project\Image_scan\.codex_tmp\a7_enriched.json"

profiles = {}   # run_id -> final profile
stages = {}     # run_id -> {stage: [ms]}
jev = {}        # run_id -> {intent, latency_ms, routed, cache}

rx_stage = re.compile(r"ai_chat\.run\.(\w+) duration_ms=([\d.]+)(?:.*?)run_id=([0-9a-f-]{36})")
rx_final = re.compile(r"ai_run_profile_final run_id=([0-9a-f-]{36}) (.*)")
rx_jev = re.compile(r"ai_jev_routing probs=\{[^}]*\} routed=(\[.*?\]) sticky=(\[.*?\]) intent=(\w+) probs_mode=\{[^}]*\} latency_ms=(\d+).*run_id=([0-9a-f-]{36})")
rx_cache = re.compile(r"ai_jev_routing_cache (hit|miss) mode=\w+ run_id=([0-9a-f-]{36})")
kv = re.compile(r"(\w+)=([^\s]+(?:\[[^\]]*\])?)")

def parse_final(rest):
    d = {}
    for m in kv.finditer(rest):
        d[m.group(1)] = m.group(2)
    return d

with io.open(LOG, encoding="utf-8", errors="replace") as f:
    for line in f:
        m = rx_stage.search(line)
        if m:
            stages.setdefault(m.group(3), {}).setdefault(m.group(1), []).append(float(m.group(2)))
            continue
        m = rx_final.search(line)
        if m:
            profiles[m.group(1)] = parse_final(m.group(2)); continue
        m = rx_jev.search(line)
        if m:
            jev[m.group(5)] = {"routed": m.group(1), "sticky": m.group(2),
                               "intent": m.group(3), "jev_ms": int(m.group(4))}
            continue
        m = rx_cache.search(line)
        if m:
            jev.setdefault(m.group(2), {})["cache"] = m.group(1)

results = [json.loads(l) for l in io.open(RES, encoding="utf-8") if l.strip()]
enriched = []
for r in results:
    rid = r.get("run_id")
    e = dict(r)
    if rid:
        e["profile"] = profiles.get(rid)
        e["stages"] = stages.get(rid)
        e["jev"] = jev.get(rid)
    enriched.append(e)

def pct(vals, p):
    if not vals: return None
    vals = sorted(vals)
    k = max(0, min(len(vals) - 1, int(round((p / 100) * (len(vals) - 1)))))
    return round(vals[k], 1)

def stat(vals):
    vals = [v for v in vals if v is not None]
    if not vals: return None
    return {"n": len(vals), "mean": round(statistics.mean(vals), 1),
            "p50": pct(vals, 50), "p95": pct(vals, 95), "max": round(max(vals), 1)}

summary = {
    "n": len(enriched),
    "send_ms": stat([r["send_ms"] for r in enriched]),
    "reply_ms": stat([r.get("reply_ms") for r in enriched]),
    "server_total_ms": stat([float((r.get("profile") or {}).get("server_total_ms", "nan") or "nan") if (r.get("profile") or {}).get("server_total_ms") else None for r in enriched]),
    "queue_wait_ms": stat([float((r.get("profile") or {}).get("queue_wait_ms", "nan") or "nan") if (r.get("profile") or {}).get("queue_wait_ms") else None for r in enriched]),
    "llm_first_ms": stat([(r.get("stages") or {}).get("llm_first", [None])[0] for r in enriched]),
    "llm_followup_ms": stat([max((r.get("stages") or {}).get("llm_followup", [0]) or [0]) or None for r in enriched]),
    "tools_ms": stat([sum((r.get("stages") or {}).get("tools", []) or [0]) or None for r in enriched]),
    "context_ms": stat([(r.get("stages") or {}).get("context", [None])[0] for r in enriched]),
    "jev_ms": stat([(r.get("jev") or {}).get("jev_ms") for r in enriched]),
    "total_tokens": stat([float((r.get("profile") or {}).get("total_tokens", "nan") or "nan") if (r.get("profile") or {}).get("total_tokens") else None for r in enriched]),
    "intents": {},
    "by_expected": {},
}
from collections import Counter
summary["intents"] = dict(Counter((r.get("profile") or {}).get("intent") or (r.get("jev") or {}).get("intent") or "?" for r in enriched))
for r in enriched:
    exp = r.get("expected") or "?"
    summary["by_expected"].setdefault(exp, []).append(
        (r.get("profile") or {}).get("intent") or (r.get("jev") or {}).get("intent") or "?")
summary["by_expected"] = {k: dict(Counter(v)) for k, v in summary["by_expected"].items()}

with io.open(OUT, "w", encoding="utf-8") as f:
    json.dump({"summary": summary, "runs": enriched}, f, ensure_ascii=False, indent=1, default=str)
print(json.dumps(summary, ensure_ascii=False, indent=1, default=str))
