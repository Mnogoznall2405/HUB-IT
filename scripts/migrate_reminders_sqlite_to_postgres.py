from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

from _migration_safety import add_safety_args, safe_replace


TABLES_IN_ORDER = [
    "equipment_transfer_act_reminders",
    "equipment_transfer_act_reminder_groups",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate transfer act reminders from SQLite into PostgreSQL app schema.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source internal SQLite database.")
    parser.add_argument("--target-database-url", help="Target APP_DATABASE_URL. Defaults to current env.")
    add_safety_args(parser)
    return parser.parse_args()


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return bool(row)


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
    from backend.services.transfer_act_reminder_service import TransferActReminderService

    database_url = ensure_app_database_configured()

    def init_target() -> None:
        initialize_app_schema(database_url)
        TransferActReminderService(database_url=database_url)

    def open_target() -> SqlAlchemyCompatConnection:
        return SqlAlchemyCompatConnection(
            get_app_engine(database_url),
            table_names=set(TABLES_IN_ORDER),
            schema=schema_name("app", database_url),
        )

    source = sqlite3.connect(
        f"file:{source_db_path.as_posix()}?mode=ro", uri=True, timeout=30, check_same_thread=False
    )
    source.row_factory = sqlite3.Row
    try:
        counts = safe_replace(
            source=source,
            tables=TABLES_IN_ORDER,
            args=args,
            open_target=open_target,
            init_target=init_target,
        )
    finally:
        source.close()
    if counts is None:
        return 0

    print("Transfer reminder migration completed:")
    for table_name in TABLES_IN_ORDER:
        print(f"  {table_name}={counts.get(table_name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
