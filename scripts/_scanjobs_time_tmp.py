import sys, time
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    c.execute(text("SET LOCAL statement_timeout = 0"))
    c.execute(text("SET statement_timeout = 0"))
    ids = [r[0] for r in c.execute(text("SELECT agent_id FROM scan.scan_agents"))]
    ph = ",".join(f":a{i}" for i in range(len(ids)))
    params = {f"a{i}": v for i, v in enumerate(ids)}

    q_agg = f"""
    SELECT agent_id, MAX(COALESCE(finished_at, started_at, created_at)) AS mx
    FROM scan.scan_jobs WHERE agent_id IN ({ph}) GROUP BY agent_id
    """
    q_last = f"""
    SELECT j.id, j.agent_id
    FROM scan.scan_jobs j
    JOIN (
        SELECT agent_id, MAX(COALESCE(finished_at, started_at, created_at)) AS max_order_ts
        FROM scan.scan_jobs WHERE agent_id IN ({ph}) GROUP BY agent_id
    ) latest_map ON latest_map.agent_id = j.agent_id
    WHERE j.agent_id IN ({ph})
      AND COALESCE(j.finished_at, j.started_at, j.created_at) = latest_map.max_order_ts
    ORDER BY j.agent_id, j.created_at DESC
    """
    q_lateral = f"""
    SELECT DISTINCT ON (j.agent_id) j.id, j.agent_id
    FROM scan.scan_jobs j
    WHERE j.agent_id IN ({ph})
    ORDER BY j.agent_id, COALESCE(j.finished_at, j.started_at, j.created_at) DESC, j.created_at DESC
    """
    for name, q in (("AGG-only", q_agg), ("ORIG LAST", q_last), ("DISTINCT ON", q_lateral)):
        t0 = time.perf_counter()
        try:
            n = len(c.execute(text(q), params).fetchall())
            print(f"{name}: {(time.perf_counter()-t0)*1000:.0f}ms rows={n}", flush=True)
        except Exception as exc:
            print(f"{name} failed: {str(exc)[:140]}", flush=True)
            c.rollback()
