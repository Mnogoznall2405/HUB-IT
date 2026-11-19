import sys
sys.path.insert(0, r"C:\Project\HUB-IT-main\WEB-itinvent")
from sqlalchemy import text
from backend.chat.db import get_chat_database_url, get_chat_read_engine

e = get_chat_read_engine(get_chat_database_url())
with e.connect() as c:
    for tbl in ("scan.scan_jobs", "app.one_c_catalog_tokens"):
        for pct in (1, 5, 10):
            try:
                r = c.execute(text(
                    f"SELECT COUNT(*), AVG(pg_column_size(t.*))::int "
                    f"FROM {tbl} t TABLESAMPLE SYSTEM ({pct})"))
                n, avg = r.first()
                print(f"{tbl} sample {pct}%: n={n} avg={avg}B")
                if n and n > 200:
                    break
            except Exception as exc:
                print(tbl, pct, "failed:", str(exc)[:100])
                c.rollback()
                break
