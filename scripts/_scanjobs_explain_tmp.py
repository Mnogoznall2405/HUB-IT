import sys, time
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    ids = [r[0] for r in c.execute(text("SELECT agent_id FROM scan.scan_agents"))]
    print("agents:", len(ids))
    ph = ",".join(f":a{i}" for i in range(len(ids)))
    params = {f"a{i}": v for i, v in enumerate(ids)}
    q_active = f"""
    SELECT j.id, j.agent_id, j.status, j.error_text, j.created_at, j.started_at, j.finished_at, '{{}}' AS payload_json
    FROM scan.scan_jobs j
    JOIN (
        SELECT agent_id, MAX(CASE LOWER(status) WHEN 'processing' THEN 2 WHEN 'queued' THEN 1 ELSE 0 END) AS max_priority
        FROM scan.scan_jobs WHERE agent_id IN ({ph}) AND status IN ('queued','processing') GROUP BY agent_id
    ) priority_map ON priority_map.agent_id = j.agent_id
    WHERE j.agent_id IN ({ph}) AND j.status IN ('queued','processing')
      AND CASE LOWER(j.status) WHEN 'processing' THEN 2 WHEN 'queued' THEN 1 ELSE 0 END = priority_map.max_priority
    ORDER BY j.agent_id, COALESCE(j.started_at, j.created_at) DESC, j.created_at DESC
    """
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
    q_count = f"""
    SELECT agent_id, COUNT(*) FROM scan.scan_jobs
    WHERE agent_id IN ({ph}) AND status IN ('queued','processing') GROUP BY agent_id
    """
    for name, q, p in (("ACTIVE", q_active, {**params, **{f"b{i}": v for i, v in enumerate(ids)}}),
                       ("LAST", q_last, {**params, **{f"b{i}": v for i, v in enumerate(ids)}}),
                       ("COUNT", q_count, params)):
        q2 = q.replace(ph + ")", ph + ")")  # same placeholders reused; second IN uses same a0.. params? no—build b's
        # rebuild: second IN ({ph}) also uses a-params — fine, same values
        t0 = time.perf_counter()
        rows = c.execute(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " + q), p).fetchall()
        dt = (time.perf_counter() - t0) * 1000
        print(f"===== {name} ({dt:.0f}ms client) =====")
        for r in rows[-12:]:
            print(r[0])
