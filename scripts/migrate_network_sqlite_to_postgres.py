from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path


TABLES_IN_ORDER = [
    "network_branches",
    "network_sites",
    "network_devices",
    "network_ports",
    "network_socket_profiles",
    "network_panels",
    "network_sockets",
    "network_branch_db_map",
    "network_maps",
    "network_map_points",
    "network_import_jobs",
    "network_audit_log",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate network data from SQLite into PostgreSQL app schema.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source internal SQLite database.")
    parser.add_argument("--target-database-url", help="Target APP_DATABASE_URL. Defaults to current env.")
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
    from backend.services.network_service import NetworkService

    database_url = ensure_app_database_configured()
    initialize_app_schema(database_url)
    NetworkService(database_url=database_url)

    source = sqlite3.connect(str(source_db_path), timeout=30, check_same_thread=False)
    source.row_factory = sqlite3.Row
    target = SqlAlchemyCompatConnection(
        get_app_engine(database_url),
        table_names=set(TABLES_IN_ORDER),
        schema=schema_name("app", database_url),
        returning_id_tables=set(TABLES_IN_ORDER),
    )

    counts: dict[str, int] = {}
    try:
        for table_name in reversed(TABLES_IN_ORDER):
            target.execute(f"DELETE FROM {table_name}")
        target.commit()

        for table_name in TABLES_IN_ORDER:
            if not _table_exists(source, table_name):
                counts[table_name] = 0
                continue
            rows = source.execute(f"SELECT * FROM {table_name}").fetchall()
            counts[table_name] = len(rows)
            if not rows:
                continue
            for row in rows:
                payload = dict(row)
                columns = list(payload.keys())
                placeholders = ", ".join(["?"] * len(columns))
                sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})"
                target.execute(sql, tuple(payload[column] for column in columns))
        target.sync_identity_sequences()
        target.commit()
    finally:
        source.close()
        target.close()

    print("Network migration completed:")
    for table_name in TABLES_IN_ORDER:
        print(f"  {table_name}={counts.get(table_name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
