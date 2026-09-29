import re
from pathlib import Path
from datetime import datetime

log = Path(r"C:\Users\Администратор\.pm2\logs\itinvent-backend-out.log")
lines = log.read_text(encoding="utf-8", errors="replace").splitlines()

# collect chunk PUT timings: timestamp + took_ms + status
pat = re.compile(r"timestamp=(\S+).*?/upload-sessions/\{file_id\}/chunks status=(\d+) took_ms=([\d.]+)")
events = []
for ln in lines:
    m = pat.search(ln)
    if m:
        ts = datetime.fromisoformat(m.group(1))
        events.append((ts, int(m.group(2)), float(m.group(3))))

# keep only last 15 minutes
if events:
    cutoff = events[-1][0]
    events = [e for e in events if (cutoff - e[0]).total_seconds() <= 900]

print(f"chunks in last 15min: {len(events)}")
if len(events) > 3:
    gaps = []
    took = []
    statuses = {}
    for i, e in enumerate(events):
        statuses[e[1]] = statuses.get(e[1], 0) + 1
        took.append(e[2])
        if i:
            gaps.append((e[0] - events[i-1][0]).total_seconds())
    took.sort()
    gaps.sort()
    n = len(took)
    print(f"statuses: {statuses}")
    print(f"took_ms p50={took[n//2]:.0f} p90={took[int(n*0.9)]:.0f} p99={took[int(n*0.99)]:.0f} max={took[-1]:.0f}")
    if gaps:
        g = len(gaps)
        print(f"gap_s  p50={gaps[g//2]:.2f} p90={gaps[int(g*0.9)]:.2f} p99={gaps[int(g*0.99)]:.2f} max={gaps[-1]:.1f}")
        big = [x for x in gaps if x > 10]
        print(f"gaps >10s: {len(big)}  total idle {sum(big):.0f}s")
