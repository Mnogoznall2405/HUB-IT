from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path


TABLES_IN_ORDER = [
    "hub_announcements",
    "hub_announcement_reads",
    "hub_announcement_attachments",
    "hub_tasks",
    "hub_task_reports",
    "hub_task_attachments",
    "hub_task_comment_reads",
    "hub_task_comments",
    "hub_task_status_log",
    "hub_notifications",
    "hub_notification_reads",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate hub data from SQLite into PostgreSQL app schema.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source internal SQLite database.")
    parser.add_argument("--target-database-url", help="Target APP_DATABASE_URL. Defaults to current env.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply the migration. Without this flag only a dry-run report is printed and nothing is changed.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow replacing rows in a non-empty target. Without it a non-empty target is refused.",
    )
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
    from backend.services.hub_service import HubService

    database_url = ensure_app_database_configured()

    def open_target() -> SqlAlchemyCompatConnection:
        return SqlAlchemyCompatConnection(
            get_app_engine(database_url),
            table_names=set(TABLES_IN_ORDER),
            schema=schema_name("app", database_url),
        )

    def count_rows(target: SqlAlchemyCompatConnection, table_name: str) -> int:
        try:
            row = target.execute(f"SELECT COUNT(*) AS cnt FROM {table_name}").fetchone()
            return int(row["cnt"] if row is not None else 0)
        except Exception:
            target.rollback()  # table not created yet: the target is empty as far as this table goes
            return 0

    source = sqlite3.connect(f"file:{source_db_path.as_posix()}?mode=ro", uri=True, timeout=30, check_same_thread=False)
    source.row_factory = sqlite3.Row
    source_counts: dict[str, int] = {}
    target_counts: dict[str, int] = {}
    target = None
    try:
        missing = [name for name in TABLES_IN_ORDER if not _table_exists(source, name)]
        if missing:
            raise SystemExit(f"Source is incomplete, missing tables: {', '.join(missing)}. Nothing was changed.")
        for table_name in TABLES_IN_ORDER:
            source_counts[table_name] = int(source.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0])
        if not any(source_counts.values()):
            raise SystemExit("Source has no rows in any hub table. Nothing was changed.")

        # Read-only pre-checks: neither schema init nor HubService (which may backfill) runs before them.
        probe = open_target()
        try:
            for table_name in TABLES_IN_ORDER:
                target_counts[table_name] = count_rows(probe, table_name)
        finally:
            probe.close()
        target_rows = sum(target_counts.values())
        if target_rows and not args.overwrite:
            raise SystemExit(
                f"Target already holds {target_rows} hub rows. Nothing was changed; pass --overwrite to replace them."
            )

        if not args.execute:
            print("Dry-run (nothing changed). Pass --execute to apply:")
            for table_name in TABLES_IN_ORDER:
                print(f"  {table_name}: source={source_counts[table_name]} target={target_counts[table_name]}")
            return 0

        initialize_app_schema(database_url)
        HubService(database_url=database_url)
        target = open_target()

        # Delete and copy share one transaction: any failure rolls the target back untouched.
        try:
            for table_name in reversed(TABLES_IN_ORDER):
                target.execute(f"DELETE FROM {table_name}")
            for table_name in TABLES_IN_ORDER:
                for row in source.execute(f"SELECT * FROM {table_name}").fetchall():
                    payload = dict(row)
                    columns = list(payload.keys())
                    placeholders = ", ".join(["?"] * len(columns))
                    sql = f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES ({placeholders})"
                    target.execute(sql, tuple(payload[column] for column in columns))
            for table_name in TABLES_IN_ORDER:
                copied = count_rows(target, table_name)
                if copied != source_counts[table_name]:
                    raise RuntimeError(
                        f"Row count mismatch in {table_name}: source={source_counts[table_name]} target={copied}"
                    )
            target.sync_identity_sequences()
            target.commit()
        except BaseException:
            target.rollback()
            raise
    finally:
        source.close()
        if target is not None:
            target.close()

    print("Hub migration completed:")
    for table_name in TABLES_IN_ORDER:
        print(f"  {table_name}={source_counts[table_name]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
