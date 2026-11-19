import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    for tbl in ("scan.scan_jobs", "app.one_c_catalog_entries", "app.one_c_catalog_tokens"):
        try:
            r = c.execute(text(
                f"SELECT COUNT(*), AVG(pg_column_size(t.*))::int avg_bytes "
                f"FROM (SELECT * FROM {tbl} TABLESAMPLE SYSTEM (1)) t LIMIT 5000" if False else
                f"SELECT AVG(pg_column_size(t.*))::int FROM (SELECT * FROM {tbl} ORDER BY random() LIMIT 2000) t"))
            print(tbl, "avg row bytes:", r.scalar())
        except Exception as exc:
            print(tbl, "failed:", str(exc)[:120])
            c.rollback()
