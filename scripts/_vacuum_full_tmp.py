import sys, time
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

target = sys.argv[1] if len(sys.argv) > 1 else "scan.scan_agents"
e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    c.execute(text("SET statement_timeout = 0"))
    c.execute(text("SET lock_timeout = '15s'"))
    size_before = c.execute(text(
        "SELECT pg_size_pretty(pg_relation_size(:t)), pg_size_pretty(pg_total_relation_size(:t))"),
        {"t": target}).first()
    print(f"{target} before: heap={size_before[0]} total={size_before[1]}", flush=True)
    t0 = time.perf_counter()
    try:
        c.execute(text(f"VACUUM (FULL, ANALYZE, VERBOSE) {target}"))
        print(f"VACUUM FULL done in {(time.perf_counter()-t0):.1f}s", flush=True)
    except Exception as exc:
        print(f"VACUUM FULL failed after {(time.perf_counter()-t0):.1f}s: {str(exc)[:300]}", flush=True)
        sys.exit(1)
with e.connect() as c:
    size_after = c.execute(text(
        "SELECT pg_size_pretty(pg_relation_size(:t)), pg_size_pretty(pg_total_relation_size(:t))"),
        {"t": target}).first()
    print(f"{target} after: heap={size_after[0]} total={size_after[1]}", flush=True)
