"""Latency stall watcher: catches slow queries, lock/IO waits, WAL-sync stalls
and round-trip spikes on the live DB. Read-only; prints anomalies to stdout."""
import sys, time, datetime, json
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

SLOW_MS = 300          # active query older than this is a stall
RT_WARN_MS = 80        # SELECT 1 round trip above this = latency spike
WAL_SYNC_WARN_MS = 20  # mean wal_sync_time per sync above this = fsync stall
POLL_SEC = 0.5
WINDOW_SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 300

e = get_chat_read_engine(get_chat_database_url())
prev_wal = None
seen_pids = set()
t_end = time.time() + WINDOW_SEC
stats = {"slow_queries": 0, "rt_spikes": 0, "wal_stalls": 0, "wait_events": 0,
         "max_rt_ms": 0.0, "max_query_s": 0.0}

def log(kind, detail):
    print(f"{datetime.datetime.now():%H:%M:%S.%f}"[:12], kind, detail, flush=True)

while time.time() < t_end:
    try:
        t0 = time.perf_counter()
        with e.connect() as c:
            c.execute(text("SELECT 1"))
            rt_ms = (time.perf_counter() - t0) * 1000
            stats["max_rt_ms"] = max(stats["max_rt_ms"], rt_ms)
            if rt_ms > RT_WARN_MS:
                stats["rt_spikes"] += 1
                log("RT", f"round-trip {rt_ms:.0f}ms")

            w = c.execute(text("SELECT wal_sync, wal_sync_time FROM pg_stat_wal")).one()
            now = time.time()
            if prev_wal:
                ds, dms, dt = w.wal_sync - prev_wal[1], w.wal_sync_time - prev_wal[2], now - prev_wal[0]
                if ds and dms / ds > WAL_SYNC_WARN_MS:
                    stats["wal_stalls"] += 1
                    log("WAL", f"{ds} syncs, mean {dms/ds:.1f}ms/sync")
            prev_wal = (now, w.wal_sync, w.wal_sync_time)

            waits = c.execute(text(
                "SELECT wait_event_type||':'||wait_event AS ev, count(*) n FROM pg_stat_activity "
                "WHERE wait_event IS NOT NULL AND state<>'idle' GROUP BY 1")).all()
            for r in waits:
                if r.n >= 3:
                    stats["wait_events"] += r.n
                    log("WAIT", f"{r.ev} x{r.n}")

            slow = c.execute(text(
                "SELECT pid, application_name, wait_event, "
                "round(EXTRACT(EPOCH FROM now()-query_start)*1000)::int AS ms, "
                "left(regexp_replace(query,'\\s+',' ','g'),120) AS q "
                "FROM pg_stat_activity WHERE state='active' "
                "AND query NOT LIKE '%pg_stat%' AND query_start < now() - interval '0.3 seconds'"
            )).all()
            for r in slow:
                key = (r.pid, r.q[:40])
                if key in seen_pids:
                    continue
                seen_pids.add(key)
                stats["slow_queries"] += 1
                stats["max_query_s"] = max(stats["max_query_s"], r.ms / 1000)
                log("SLOW", f"pid={r.pid} {r.application_name} {r.ms}ms wait={r.wait_event} :: {r.q}")
    except Exception as exc:
        log("ERR", str(exc)[:160])
    if len(seen_pids) > 5000:
        seen_pids.clear()
    time.sleep(POLL_SEC)

log("SUMMARY", json.dumps(stats))
