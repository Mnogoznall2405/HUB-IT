import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    for r in c.execute(text(
        "SELECT relname, n_live_tup, n_dead_tup, n_mod_since_analyze, "
        "pg_size_pretty(pg_relation_size(relid)) sz, last_autovacuum, last_autoanalyze "
        "FROM pg_stat_user_tables WHERE relname IN ('scan_jobs','scan_incidents','scan_tasks','scan_agents')")):
        print(dict(r._mapping))
    for r in c.execute(text(
        "SELECT pid, state, wait_event_type||':'||coalesce(wait_event,'-') w, now()-query_start age, "
        "left(regexp_replace(query,'\\s+',' ','g'),90) q FROM pg_stat_activity "
        "WHERE state<>'idle' AND query NOT LIKE '%pg_stat%'")):
        print(dict(r._mapping))
