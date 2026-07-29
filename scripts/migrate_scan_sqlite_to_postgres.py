#!/usr/bin/env python3
"""Migrate scan_server SQLite runtime into PostgreSQL schema ``scan``."""

from __future__ import annotations

import argparse
import hashlib
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

TABLES_IN_ORDER = (
    "scan_agents",
    "scan_tasks",
    "scan_task_system_metrics",
    "scan_jobs",
    "scan_findings",
    "scan_incidents",
    "scan_task_file_observations",
    "scan_artifacts",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db-path", required=True, help="Path to scan_server.db")
    parser.add_argument(
        "--target-database-url",
        default="",
        help="PostgreSQL URL (default: SCAN_DATABASE_URL env)",
    )
    parser.add_argument("--batch-size", type=int, default=2000)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--truncate", action="store_true", help="TRUNCATE target tables before copy")
    parser.add_argument("--sample-checksums", type=int, default=20)
    return parser.parse_args()


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table,),
    ).fetchone()
    return row is not None


def _count_sqlite(conn: sqlite3.Connection, table: str) -> int:
    if not _table_exists(conn, table):
        return 0
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def _count_pg(conn, table: str) -> int:
    row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
    return int(row["c"] if row is not None else 0)


def _iter_sqlite_rows(conn: sqlite3.Connection, table: str, batch_size: int) -> Iterable[list[sqlite3.Row]]:
    if not _table_exists(conn, table):
        return
    offset = 0
    while True:
        rows = conn.execute(
            f"SELECT * FROM {table} ORDER BY rowid LIMIT ? OFFSET ?",
            (batch_size, offset),
        ).fetchall()
        if not rows:
            break
        yield rows
        offset += len(rows)


def _row_values(row: sqlite3.Row, columns: Sequence[str]) -> tuple[Any, ...]:
    return tuple(row[col] for col in columns)


def _copy_table(pg_conn, sqlite_conn: sqlite3.Connection, table: str, batch_size: int) -> int:
    if not _table_exists(sqlite_conn, table):
        print(f"  skip missing sqlite table {table}")
        return 0
    col_rows = sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall()
    columns = [str(r["name"]) for r in col_rows]
    if not columns:
        return 0
    placeholders = ", ".join("?" for _ in columns)
    col_sql = ", ".join(columns)
    insert_sql = f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders})"
    total = 0
    for batch in _iter_sqlite_rows(sqlite_conn, table, batch_size):
        values = [_row_values(row, columns) for row in batch]
        pg_conn.executemany(insert_sql, values)
        pg_conn.commit()
        total += len(values)
        print(f"  {table}: {total}", flush=True)
    if table == "scan_artifacts" and total > 0:
        pg_conn.execute(
            """
            SELECT setval(
                pg_get_serial_sequence('scan.scan_artifacts', 'id'),
                COALESCE((SELECT MAX(id) FROM scan_artifacts), 1),
                true
            )
            """
        )
        pg_conn.commit()
    return total


def _verify(sqlite_conn: sqlite3.Connection, pg_conn, sample_n: int) -> int:
    errors = 0
    print("Verification:")
    for table in TABLES_IN_ORDER:
        src = _count_sqlite(sqlite_conn, table)
        dst = _count_pg(pg_conn, table)
        ok = src == dst
        print(f"  {table}: sqlite={src} postgres={dst} {'OK' if ok else 'MISMATCH'}")
        if not ok:
            errors += 1

    orphan_findings = pg_conn.execute(
        """
        SELECT COUNT(*) AS c FROM scan_findings f
        LEFT JOIN scan_jobs j ON j.id = f.job_id
        WHERE j.id IS NULL
        """
    ).fetchone()["c"]
    orphan_incidents = pg_conn.execute(
        """
        SELECT COUNT(*) AS c FROM scan_incidents i
        LEFT JOIN scan_jobs j ON j.id = i.job_id
        WHERE j.id IS NULL
        """
    ).fetchone()["c"]
    print(f"  orphan findings: {orphan_findings}")
    print(f"  orphan incidents: {orphan_incidents}")
    if orphan_findings or orphan_incidents:
        errors += 1

    if sample_n > 0 and _count_sqlite(sqlite_conn, "scan_jobs") > 0:
        sample = sqlite_conn.execute(
            "SELECT id, status, file_hash FROM scan_jobs ORDER BY RANDOM() LIMIT ?",
            (sample_n,),
        ).fetchall()
        mismatch = 0
        for row in sample:
            pg_row = pg_conn.execute(
                "SELECT id, status, file_hash FROM scan_jobs WHERE id=? LIMIT 1",
                (row["id"],),
            ).fetchone()
            if pg_row is None or str(pg_row["status"]) != str(row["status"]) or str(pg_row["file_hash"]) != str(
                row["file_hash"]
            ):
                mismatch += 1
        print(f"  sample job checksum mismatches: {mismatch}/{len(sample)}")
        if mismatch:
            errors += 1

    status_src = {
        str(r[0]): int(r[1])
        for r in sqlite_conn.execute("SELECT status, COUNT(*) FROM scan_jobs GROUP BY status").fetchall()
    }
    status_dst = {
        str(r["status"]): int(r["c"])
        for r in pg_conn.execute("SELECT status, COUNT(*) AS c FROM scan_jobs GROUP BY status").fetchall()
    }
    if status_src != status_dst:
        print(f"  job status mismatch: sqlite={status_src} postgres={status_dst}")
        errors += 1
    else:
        print(f"  job statuses OK: {status_src}")
    return errors


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    source = Path(args.source_db_path).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Source SQLite DB not found: {source}")

    target_url = str(args.target_database_url or os.getenv("SCAN_DATABASE_URL", "") or "").strip()
    if not target_url:
        raise SystemExit("Provide --target-database-url or SCAN_DATABASE_URL")

    from dotenv import load_dotenv

    load_dotenv(project_root / ".env", override=False)

    from scan_server.db import ensure_scan_schema, get_scan_engine
    from scan_server.pg_compat import PgConnection

    print(f"Source: {source}")
    print(f"Target: {target_url.split('@')[-1] if '@' in target_url else target_url}")
    print(f"Dry-run: {args.dry_run}")

    engine = get_scan_engine(target_url, application_name="itinvent-scan-migrate")
    ensure_scan_schema(engine)

    sqlite_conn = sqlite3.connect(str(source))
    sqlite_conn.row_factory = sqlite3.Row

    if args.dry_run:
        print("Dry-run source counts:")
        for table in TABLES_IN_ORDER:
            print(f"  {table}: {_count_sqlite(sqlite_conn, table)}")
        with PgConnection(engine) as pg_conn:
            pg_conn.execute("SELECT 1")
            print("Target schema reachable.")
        sqlite_conn.close()
        return 0

    started = time.time()
    with PgConnection(engine) as pg_conn:
        if args.truncate:
            print("Truncating target tables...")
            pg_conn.execute(
                "TRUNCATE TABLE "
                + ", ".join(reversed(TABLES_IN_ORDER))
                + " RESTART IDENTITY CASCADE"
            )
            pg_conn.commit()

        copied = {}
        for table in TABLES_IN_ORDER:
            print(f"Copying {table}...")
            copied[table] = _copy_table(pg_conn, sqlite_conn, table, max(100, int(args.batch_size)))

        errors = _verify(sqlite_conn, pg_conn, args.sample_checksums)

    sqlite_conn.close()
    elapsed = time.time() - started
    digest = hashlib.sha256(repr(sorted(copied.items())).encode("utf-8")).hexdigest()[:12]
    print(f"Done in {elapsed:.1f}s copied={copied} fingerprint={digest}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
