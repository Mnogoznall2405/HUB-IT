import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    print("user:", c.execute(text("SELECT current_user")).scalar(),
          "| in_recovery:", c.execute(text("SELECT pg_is_in_recovery()")).scalar())
    for r in c.execute(text(
        "SELECT c.relname, pg_get_userbyid(c.relowner) owner "
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname||'.'||c.relname IN ('scan.scan_agents','app.one_c_catalog_entries')")):
        print(r)
    print("== lock holders on targets ==")
    for r in c.execute(text(
        "SELECT a.pid, a.application_name, a.state, now()-a.query_start age, "
        "left(regexp_replace(a.query,'\\s+',' ','g'),80) q "
        "FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid "
        "JOIN pg_class cl ON cl.oid=l.relation "
        "JOIN pg_namespace n ON n.oid=cl.relnamespace "
        "WHERE n.nspname||'.'||cl.relname IN ('scan.scan_agents','app.one_c_catalog_entries') "
        "AND a.query NOT LIKE '%pg_locks%'")):
        print(dict(r._mapping))
    print("done")
