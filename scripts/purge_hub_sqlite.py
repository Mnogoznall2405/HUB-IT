#!/usr/bin/env python3
"""Remove legacy hub_* data from local SQLite store (backup first)."""
from __future__ import annotations

import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

DB_CANDIDATES = [
    DATA_DIR / "local_store.unified.db",
    DATA_DIR / "local_store.db",
]

# Child tables first (reads, attachments, logs), then parents.
HUB_TABLES_DELETE_ORDER = [
    "hub_notification_reads",
    "hub_notifications",
    "hub_announcement_reads",
    "hub_announcement_attachments",
    "hub_announcements",
    "hub_task_comment_reads",
    "hub_task_comments",
    "hub_task_attachments",
    "hub_task_reports",
    "hub_task_status_log",
    "hub_tasks",
    "hub_task_objects",
    "hub_task_projects",
]


def resolve_db_path() -> Path:
    for path in DB_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError("No local_store database found under data/")


def backup_db(db_path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = db_path.with_suffix(db_path.suffix + f".bak-{stamp}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def list_hub_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'hub_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows]


def main() -> int:
    db_path = resolve_db_path()
    backup_path = backup_db(db_path)
    print(f"backup: {backup_path}")

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    hub_tables = list_hub_tables(conn)
    print(f"database: {db_path}")
    print(f"hub tables found: {len(hub_tables)}")

    deleted_total = 0
    for table in HUB_TABLES_DELETE_ORDER:
        if table not in hub_tables:
            continue
        before = cur.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
        if before:
            cur.execute(f"DELETE FROM [{table}]")
            deleted_total += before
        print(f"  {table}: {before} -> 0")

    # Any extra hub_* tables not in the ordered list
    for table in hub_tables:
        if table in HUB_TABLES_DELETE_ORDER:
            continue
        before = cur.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
        if before:
            cur.execute(f"DELETE FROM [{table}]")
            deleted_total += before
        print(f"  {table}: {before} -> 0")

    conn.commit()
    conn.execute("VACUUM")
    conn.close()

    print(f"done: removed {deleted_total} hub rows from SQLite")
    print("PostgreSQL hub data is unchanged.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
