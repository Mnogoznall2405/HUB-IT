import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    print("== VACUUM ==")
    for r in c.execute(text(
        "SELECT pid, now()-query_start AS age, wait_event_type||':'||coalesce(wait_event,'') AS w, "
        "left(regexp_replace(query,'\\s+',' ','g'),100) FROM pg_stat_activity WHERE query LIKE 'VACUUM%'")):
        print(dict(r._mapping))
    print("== who blocks (lock waiters -> blockers) ==")
    for r in c.execute(text(
        "SELECT DISTINCT bl.pid AS blocker_pid, bl.application_name AS blocker_app, "
        "now()-bl.query_start AS blocker_qage, bl.wait_event_type||':'||coalesce(bl.wait_event,'') AS blocker_wait, "
        "wl.application_name AS waiter_app, wl.wait_event AS waiter_wait, "
        "left(regexp_replace(bl.query,'\\s+',' ','g'),90) AS blocker_q "
        "FROM pg_stat_activity wl JOIN pg_locks l ON l.pid=wl.pid AND NOT l.granted "
        "JOIN pg_locks bl_l ON bl_l.locktype=l.locktype AND bl_l.relation IS NOT DISTINCT FROM l.relation "
        "  AND bl_l.transactionid IS NOT DISTINCT FROM l.transactionid "
        "  AND bl_l.tuple IS NOT DISTINCT FROM l.tuple AND bl_l.granted "
        "JOIN pg_stat_activity bl ON bl.pid=bl_l.pid "
        "WHERE wl.wait_event_type='Lock' LIMIT 15")):
        print(dict(r._mapping))
