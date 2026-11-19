import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    # 10-agent sample first, then full 956 for plan only
    ids = [r[0] for r in c.execute(text("SELECT agent_id FROM scan.scan_agents LIMIT 10"))]
    ph = ",".join(f":a{i}" for i in range(len(ids)))
    params = {f"a{i}": v for i, v in enumerate(ids)}
    q_last = f"""
    SELECT j.id, j.agent_id, j.status, j.error_text, j.created_at, j.started_at, j.finished_at, '{{}}' AS payload_json
    FROM scan.scan_jobs j
    JOIN (
        SELECT agent_id, MAX(COALESCE(finished_at, started_at, created_at)) AS max_order_ts
        FROM scan.scan_jobs WHERE agent_id IN ({ph}) GROUP BY agent_id
    ) latest_map ON latest_map.agent_id = j.agent_id
    WHERE j.agent_id IN ({ph})
      AND COALESCE(j.finished_at, j.started_at, j.created_at) = latest_map.max_order_ts
    ORDER BY j.agent_id, j.created_at DESC
    """
    print("===== LAST plan (10 agents) =====")
    for r in c.execute(text("EXPLAIN " + q_last), params):
        print(r[0])
    print("===== indexes on scan_jobs =====")
    for r in c.execute(text(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='scan_jobs' ORDER BY indexname")):
        print(r[0], "|", r[1][:160])
    print("===== row count + per-agent skew =====")
    for r in c.execute(text(
        "SELECT COUNT(*) total, COUNT(DISTINCT agent_id) agents FROM scan.scan_jobs")):
        print(dict(r._mapping))
    for r in c.execute(text(
        "SELECT agent_id, COUNT(*) c FROM scan.scan_jobs GROUP BY 1 ORDER BY 2 DESC LIMIT 5")):
        print(dict(r._mapping))
