import sys, time
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    c.execute(text("SET statement_timeout = 0"))
    c.execute(text("SET enable_indexscan = off"))
    c.execute(text("SET enable_bitmapscan = off"))
    ids = [r[0] for r in c.execute(text("SELECT agent_id FROM scan.scan_agents"))]
    ph = ",".join(f":a{i}" for i in range(len(ids)))
    params = {f"a{i}": v for i, v in enumerate(ids)}
    q_agg = f"""
    SELECT agent_id, MAX(COALESCE(finished_at, started_at, created_at)) AS mx
    FROM scan.scan_jobs WHERE agent_id IN ({ph}) GROUP BY agent_id
    """
    t0 = time.perf_counter()
    n = len(c.execute(text(q_agg), params).fetchall())
    print(f"AGG seqscan: {(time.perf_counter()-t0)*1000:.0f}ms rows={n}")
