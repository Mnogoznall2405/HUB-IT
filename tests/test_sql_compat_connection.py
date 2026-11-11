from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, text

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.sql_compat import SqlAlchemyCompatConnection


def test_sqlalchemy_compat_context_manager_closes_connection(temp_dir):
    db_path = Path(temp_dir) / "compat.sqlite3"
    engine = create_engine(f"sqlite+pysqlite:///{db_path}", future=True)

    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE demo (id INTEGER PRIMARY KEY, name TEXT NOT NULL)"))

    compat = SqlAlchemyCompatConnection(engine, table_names={"demo"})
    with compat as conn:
        conn.execute("INSERT INTO demo(name) VALUES (?)", ("ok",))

    assert compat._closed is True

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM demo")).scalar_one()

    assert count == 1
