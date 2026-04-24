from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path


TABLE_NAME = "env_settings_audit"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate env settings audit data from SQLite into PostgreSQL system schema.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source env audit SQLite database.")
    parser.add_argument("--target-database-url", help="Target APP_DATABASE_URL. Defaults to current env.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    source_db_path = Path(args.source_db_path).expanduser().resolve()

    if not source_db_path.exists():
        raise SystemExit(f"Source SQLite database does not exist: {source_db_path}")

    if args.target_database_url:
        os.environ["APP_DATABASE_URL"] = str(args.target_database_url).strip()

    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from backend.config import reload_runtime_config

    reload_runtime_config()

    from backend.appdb.db import ensure_app_database_configured, get_app_engine, initialize_app_schema
    from backend.appdb.sql_compat import SqlAlchemyCompatConnection
    from backend.db_schema import schema_name

    database_url = ensure_app_database_configured()
    initialize_app_schema(database_url)

    source = sqlite3.connect(str(source_db_path), timeout=30, check_same_thread=False)
    source.row_factory = sqlite3.Row
    target = SqlAlchemyCompatConnection(
        get_app_engine(database_url),
        table_names={TABLE_NAME},
        schema=schema_name("system", database_url),
        returning_id_tables={TABLE_NAME},
    )

    try:
        exists = source.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
            (TABLE_NAME,),
        ).fetchone()
        target.execute(f"DELETE FROM {TABLE_NAME}")
        target.commit()

        count = 0
        if exists:
            rows = source.execute(f"SELECT * FROM {TABLE_NAME}").fetchall()
            count = len(rows)
            for row in rows:
                payload = dict(row)
                columns = list(payload.keys())
                placeholders = ", ".join(["?"] * len(columns))
                sql = f"INSERT INTO {TABLE_NAME} ({', '.join(columns)}) VALUES ({placeholders})"
                target.execute(sql, tuple(payload[column] for column in columns))
            target.commit()
    finally:
        source.close()
        target.close()

    print(f"Env audit migration completed: {TABLE_NAME}={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
