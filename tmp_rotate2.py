# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
env = dotenv_values(r"C:\Project\HUB-IT-main\.env")
e = create_engine(env["SCAN_DATABASE_URL"])
with e.connect() as c:
    print("=== tmn-sup-0001 rotate_key last 60min ===")
    for r in c.execute(text("""
        SELECT status, count(*) FROM scan.scan_tasks
        WHERE agent_id='tmn-sup-0001' AND command='rotate_key'
          AND created_at > extract(epoch from now() - interval '60 min')
        GROUP BY status""")):
        print(" ", dict(r._mapping))
    print("=== agents at cap (>=5 rotate in 90min) with no completed ===")
    for r in c.execute(text("""
        SELECT agent_id,
               count(*) total,
               count(*) FILTER (WHERE status='completed') done,
               count(*) FILTER (WHERE status='queued') queued,
               count(*) FILTER (WHERE status='expired') expired
        FROM scan.scan_tasks
        WHERE command='rotate_key' AND created_at > extract(epoch from now() - interval '90 min')
        GROUP BY agent_id ORDER BY total DESC LIMIT 10""")):
        print(" ", dict(r._mapping))
