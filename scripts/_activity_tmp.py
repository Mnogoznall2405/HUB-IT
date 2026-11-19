import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    for r in c.execute(text(
        "SELECT pid, application_name, state, wait_event_type||':'||coalesce(wait_event,'-') w, "
        "now()-query_start age, left(regexp_replace(query,'\\s+',' ','g'),110) q "
        "FROM pg_stat_activity WHERE state<>'idle' AND query NOT LIKE '%pg_stat_activity%' ORDER BY query_start")):
        print(dict(r._mapping))
