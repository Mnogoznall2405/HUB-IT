import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    print("== pgstattuple ext ==")
    try:
        print(c.execute(text("SELECT pgstattuple('scan.scan_agents')")).fetchall())
    except Exception as exc:
        print("no pgstattuple:", str(exc)[:100])
        c.rollback()
    print("== avg row widths (agents) ==")
    for r in c.execute(text(
        "SELECT COUNT(*), pg_size_pretty(SUM(pg_column_size(t.*))::bigint) AS total, "
        "pg_size_pretty(AVG(pg_column_size(t.*))::bigint) AS avg_row FROM scan.scan_agents t")):
        print(r)
    print("== avg row widths (jobs) ==")
    for r in c.execute(text(
        "SELECT COUNT(*), pg_size_pretty(SUM(pg_column_size(t.*))::bigint) AS total, "
        "pg_size_pretty(AVG(pg_column_size(t.*))::bigint) AS avg_row FROM scan.scan_jobs t")):
        print(r)
    print("== top-5 widest agents ==")
    for r in c.execute(text(
        "SELECT agent_id, pg_size_pretty(pg_column_size(t.*)) FROM scan.scan_agents t "
        "ORDER BY pg_column_size(t.*) DESC LIMIT 5")):
        print(r)
    print("== widest columns agents ==")
    for r in c.execute(text(
        "SELECT column_name, data_type, character_maximum_length "
        "FROM information_schema.columns WHERE table_name='scan_agents' ORDER BY ordinal_position")):
        print(r)
