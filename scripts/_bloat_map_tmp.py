import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    for r in c.execute(text(
        "SELECT schemaname||'.'||relname tbl, n_live_tup live, n_dead_tup dead, "
        "pg_size_pretty(pg_relation_size(relid)) heap_sz, "
        "pg_size_pretty(pg_total_relation_size(relid)) total_sz, "
        "pg_relation_size(relid) heap_bytes "
        "FROM pg_stat_user_tables WHERE n_live_tup > 0 "
        "ORDER BY pg_relation_size(relid) / GREATEST(n_live_tup,1) DESC LIMIT 25")):
        d = dict(r._mapping)
        d.pop("heap_bytes")
        print(d)
