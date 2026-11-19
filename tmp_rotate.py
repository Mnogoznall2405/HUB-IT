# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
env = dotenv_values(r"C:\Project\HUB-IT-main\.env")
e = create_engine(env["SCAN_DATABASE_URL"])
with e.connect() as c:
    print("=== rotate_key last 90min by status ===")
    for r in c.execute(text("""
        SELECT status, count(*) FROM scan.scan_tasks
        WHERE command='rotate_key' AND created_at > extract(epoch from now() - interval '90 min')
        GROUP BY status ORDER BY 2 DESC""")):
        print(" ", dict(r._mapping))
    print("=== agents with >1 rotate in 90min ===")
    for r in c.execute(text("""
        SELECT agent_id, count(*) FROM scan.scan_tasks
        WHERE command='rotate_key' AND created_at > extract(epoch from now() - interval '90 min')
        GROUP BY agent_id HAVING count(*)>1 ORDER BY 2 DESC LIMIT 15""")):
        print(" ", dict(r._mapping))
