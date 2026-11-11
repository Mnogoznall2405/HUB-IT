#!/usr/bin/env python3
"""List hub announcements from local SQLite store."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"

CANDIDATES = [
    DATA_DIR / "local_store.unified.db",
    DATA_DIR / "local_store.db",
    DATA_DIR / "local_store.restored.db",
]


def resolve_db_path() -> Path | None:
    for path in CANDIDATES:
        if path.exists():
            return path
    return None


def main() -> int:
    db_path = resolve_db_path()
    if not db_path:
        print("No local_store database found under data/", file=sys.stderr)
        return 1

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    try:
        rows = cur.execute(
            """
            SELECT
                id,
                title,
                preview,
                priority,
                is_active,
                author_username,
                author_full_name,
                published_at,
                updated_at,
                version,
                requires_ack,
                is_pinned
            FROM hub_announcements
            ORDER BY published_at DESC, title ASC
            """
        ).fetchall()
    except sqlite3.Error as exc:
        print(f"Query failed on {db_path}: {exc}", file=sys.stderr)
        return 1

    print(f"database: {db_path}")
    print(f"total: {len(rows)}")
    print("-" * 100)

    for index, row in enumerate(rows, start=1):
        active = "active" if int(row["is_active"] or 0) else "archived"
        ack = "ack" if int(row["requires_ack"] or 0) else "no-ack"
        pinned = "pinned" if int(row["is_pinned"] or 0) else ""
        flags = ", ".join(part for part in (active, ack, pinned) if part)
        author = (row["author_full_name"] or row["author_username"] or "").strip()
        preview = (row["preview"] or "").strip().replace("\n", " ")
        if len(preview) > 120:
            preview = preview[:117] + "..."

        print(f"{index:>3}. id={row['id']}")
        print(f"     title: {row['title']}")
        print(f"     preview: {preview or '(empty)'}")
        print(f"     author: {author or '-'} | priority: {row['priority']} | {flags}")
        print(f"     published: {row['published_at']} | updated: {row['updated_at']} | v{row['version']}")
        print()

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
