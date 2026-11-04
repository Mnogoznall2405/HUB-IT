"""Shared safety contract for SQLite -> PostgreSQL migrators that REPLACE target tables.

Same contract as ``migrate_hub_sqlite_to_postgres.py`` (DOPS-01):
  * dry-run by default (``--execute`` applies);
  * a non-empty target is never replaced without ``--overwrite``;
  * a source missing tables, or with no rows at all, aborts before anything is touched;
  * DELETE + INSERT run in ONE transaction, row counts are verified, any failure rolls the target
    back to its previous content.
"""
from __future__ import annotations

import argparse
import sqlite3
from typing import Callable, Iterable


def add_safety_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply the migration. Without this flag only a dry-run report is printed and nothing is changed.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace rows that already exist in the target. Without it a non-empty target aborts the run.",
    )
    parser.add_argument(
        "--allow-missing-tables",
        action="store_true",
        help="Treat tables absent from the source as empty instead of aborting (older source schema).",
    )


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return bool(row)


def _count_target_rows(target, table_name: str) -> int:
    try:
        row = target.execute(f"SELECT COUNT(*) AS cnt FROM {table_name}").fetchone()
        return int(row["cnt"] if row is not None else 0)
    except Exception:
        target.rollback()  # table not created yet: empty as far as this table goes
        return 0


def safe_replace(
    *,
    source: sqlite3.Connection,
    tables: Iterable[str],
    args: argparse.Namespace,
    open_target: Callable[[], object],
    init_target: Callable[[], None],
    sync_sequences: bool = True,
) -> dict[str, int] | None:
    """Return per-table source counts after a real migration, ``None`` for a dry-run."""
    tables = list(tables)
    missing = [name for name in tables if not table_exists(source, name)]
    if missing and not args.allow_missing_tables:
        raise SystemExit(
            f"Source is incomplete, missing tables: {', '.join(missing)}. Nothing was changed "
            "(pass --allow-missing-tables to treat them as empty)."
        )
    source_counts = {
        name: (0 if name in missing else int(source.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]))
        for name in tables
    }
    if not any(source_counts.values()):
        raise SystemExit("Source has no rows in any migrated table. Nothing was changed.")

    # Read-only pre-checks: neither schema init nor service initialisers run before them.
    probe = open_target()
    try:
        target_counts = {name: _count_target_rows(probe, name) for name in tables}
    finally:
        probe.close()
    target_rows = sum(target_counts.values())
    if target_rows and not args.overwrite:
        raise SystemExit(
            f"Target already holds {target_rows} rows. Nothing was changed; pass --overwrite to replace them."
        )

    if not args.execute:
        print("Dry-run (nothing changed). Pass --execute to apply:")
        for name in tables:
            print(f"  {name}: source={source_counts[name]} target={target_counts[name]}")
        return None

    init_target()
    target = open_target()
    try:
        for name in reversed(tables):
            target.execute(f"DELETE FROM {name}")
        for name in tables:
            if name in missing:
                continue
            for row in source.execute(f"SELECT * FROM {name}").fetchall():
                payload = dict(row)
                columns = list(payload.keys())
                placeholders = ", ".join(["?"] * len(columns))
                target.execute(
                    f"INSERT INTO {name} ({', '.join(columns)}) VALUES ({placeholders})",
                    tuple(payload[column] for column in columns),
                )
        for name in tables:
            copied = _count_target_rows(target, name)
            if copied != source_counts[name]:
                raise RuntimeError(
                    f"Row count mismatch in {name}: source={source_counts[name]} target={copied}"
                )
        if sync_sequences:
            target.sync_identity_sequences()
        target.commit()
    except BaseException:
        target.rollback()
        raise
    finally:
        target.close()
    return source_counts
