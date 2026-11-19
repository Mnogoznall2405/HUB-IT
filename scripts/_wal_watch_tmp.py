"""Per-10s WAL sync + wait sampler -> CSV. Local read-only monitor."""
import sys, time, datetime
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

OUT = r"C:\Project\HUB-IT-main\scripts\_wal_watch_tmp.csv"
e = get_chat_read_engine(get_chat_database_url())
prev = None
t_end = time.time() + 4 * 3600
with open(OUT, "a", encoding="utf-8") as f:
    f.write("ts,d_sync,d_sync_ms,ms_per_sync,waiters,longest_s\n")
    while time.time() < t_end:
        try:
            with e.connect() as c:
                w = c.execute(text("SELECT wal_sync, wal_sync_time FROM pg_stat_wal")).one()
                waiters, longest = c.execute(text(
                    "SELECT count(*), COALESCE(max(EXTRACT(EPOCH FROM now()-query_start)),0) "
                    "FROM pg_stat_activity WHERE wait_event IS NOT NULL AND state<>'idle'"
                )).one()
            now = time.time()
            if prev:
                dt = now - prev[0]
                ds = w.wal_sync - prev[1]
                dms = w.wal_sync_time - prev[2]
                per = (dms / ds) if ds else 0.0
                line = (f"{datetime.datetime.now():%H:%M:%S},{ds},{dms:.1f},{per:.2f},{waiters},{longest:.1f}\n")
                f.write(line); f.flush()
                if per > 20 or longest > 10:
                    print("WAVE", line.strip())
            prev = (now, w.wal_sync, w.wal_sync_time)
        except Exception as exc:
            print("err", exc)
        time.sleep(10)
