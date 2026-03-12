#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from local_store import SQLiteLocalStore


JSON_RECOVERY_FILES = [
    "battery_replacements.json",
    "cartridge_database.json",
    "cartridge_replacements.json",
    "component_replacements.json",
    "equipment_installations.json",
    "equipment_transfers.json",
    "export_state.json",
    "pc_cleanings.json",
    "printer_color_cache.json",
    "printer_component_cache.json",
    "unfound_equipment.json",
    "user_db_selection.json",
    "web_sessions.json",
    "web_user_settings.json",
    "web_users.json",
]

SQLITE_NATIVE_TABLES = [
    "hub_announcement_attachments",
    "hub_announcement_reads",
    "hub_announcements",
    "hub_notification_reads",
    "hub_notifications",
    "hub_task_reports",
    "hub_tasks",
    "mfu_page_baseline",
    "mfu_page_snapshots",
    "mfu_runtime_state",
    "network_audit_log",
    "network_branch_db_map",
    "network_branches",
    "network_devices",
    "network_import_jobs",
    "network_map_points",
    "network_maps",
    "network_panels",
    "network_ports",
    "network_sites",
    "network_socket_profiles",
    "network_sockets",
]

RESILIENT_TABLES = {
    "mfu_page_snapshots",
}

EXACT_SCAN_TABLES = {
    "hub_notifications": 5_000,
    "hub_task_reports": 1_000,
    "network_audit_log": 20_000,
}


def _table_columns(conn: sqlite3.Connection, table_name: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table_name}")').fetchall()]


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (table_name,),
    ).fetchone()
    return bool(row)


def _clear_tables(conn: sqlite3.Connection, table_names: Iterable[str]) -> None:
    for table_name in table_names:
        if _table_exists(conn, table_name):
            conn.execute(f'DELETE FROM "{table_name}"')
    conn.commit()


def _backup_db(source_db: Path, dest_db: Path) -> None:
    if dest_db.exists():
        dest_db.unlink()
    dest_db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(source_db), timeout=30) as src_conn, sqlite3.connect(str(dest_db), timeout=30) as dst_conn:
        src_conn.backup(dst_conn)


def _load_json_payload(path: Path) -> Any:
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return []
    return json.loads(raw)


def _import_json_archive(dest_db: Path, json_dir: Path) -> dict[str, int]:
    store = SQLiteLocalStore(data_dir=json_dir, db_path=dest_db)
    imported_rows = 0
    processed_files = 0
    for file_name in JSON_RECOVERY_FILES:
        path = json_dir / file_name
        if not path.exists():
            continue
        payload = _load_json_payload(path)
        store.save_json(file_name, payload)
        processed_files += 1
        if isinstance(payload, dict):
            imported_rows += len(payload)
        elif isinstance(payload, list):
            imported_rows += len(payload)
        elif payload is not None:
            imported_rows += 1
    return {
        "files": processed_files,
        "rows": imported_rows,
    }


def _insert_rows(
    conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
    rows: list[sqlite3.Row],
) -> int:
    if not rows:
        return 0
    placeholders = ", ".join("?" for _ in dest_columns)
    columns_sql = ", ".join(f'"{column}"' for column in dest_columns)
    values = [tuple(row[column] for column in dest_columns) for row in rows]
    conn.executemany(
        f'INSERT OR REPLACE INTO "{table_name}" ({columns_sql}) VALUES ({placeholders})',
        values,
    )
    return len(values)


def _copy_table_full(
    src_conn: sqlite3.Connection,
    dst_conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
    *,
    batch_size: int = 512,
) -> int:
    select_sql = ", ".join(f'"{column}"' for column in dest_columns)
    cursor = src_conn.execute(f'SELECT {select_sql} FROM "{table_name}"')
    copied = 0
    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            break
        copied += _insert_rows(dst_conn, table_name, dest_columns, rows)
    dst_conn.commit()
    return copied


def _copy_rowid_range(
    src_conn: sqlite3.Connection,
    dst_conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
    start_rowid: int,
    end_rowid: int,
    *,
    batch_width: int = 256,
) -> tuple[int, int]:
    if start_rowid > end_rowid:
        return 0, 0

    select_sql = ", ".join(f'"{column}"' for column in dest_columns)
    if start_rowid == end_rowid:
        try:
            rows = src_conn.execute(
                f'SELECT {select_sql} FROM "{table_name}" WHERE rowid = ?',
                (start_rowid,),
            ).fetchall()
        except sqlite3.DatabaseError:
            return 0, 1
        copied = _insert_rows(dst_conn, table_name, dest_columns, rows)
        if copied:
            dst_conn.commit()
        return copied, 0

    if (end_rowid - start_rowid) <= batch_width:
        try:
            rows = src_conn.execute(
                f'SELECT {select_sql} FROM "{table_name}" WHERE rowid BETWEEN ? AND ? ORDER BY rowid',
                (start_rowid, end_rowid),
            ).fetchall()
            copied = _insert_rows(dst_conn, table_name, dest_columns, rows)
            if copied:
                dst_conn.commit()
            return copied, 0
        except sqlite3.DatabaseError:
            pass

    middle = (start_rowid + end_rowid) // 2
    copied_left, skipped_left = _copy_rowid_range(
        src_conn,
        dst_conn,
        table_name,
        dest_columns,
        start_rowid,
        middle,
        batch_width=batch_width,
    )
    copied_right, skipped_right = _copy_rowid_range(
        src_conn,
        dst_conn,
        table_name,
        dest_columns,
        middle + 1,
        end_rowid,
        batch_width=batch_width,
    )
    return copied_left + copied_right, skipped_left + skipped_right


def _copy_table_resilient(
    src_conn: sqlite3.Connection,
    dst_conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
) -> tuple[int, int]:
    min_rowid = src_conn.execute(f'SELECT COALESCE(MIN(rowid), 0) FROM "{table_name}"').fetchone()[0]
    max_rowid = src_conn.execute(f'SELECT COALESCE(MAX(rowid), 0) FROM "{table_name}"').fetchone()[0]
    if not min_rowid and not max_rowid:
        return 0, 0
    return _copy_rowid_range(src_conn, dst_conn, table_name, dest_columns, int(min_rowid), int(max_rowid))


def _copy_table_forward_scan(
    src_conn: sqlite3.Connection,
    dst_conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
    *,
    batch_size: int = 128,
    max_corrupt_rowids: int = 250_000,
) -> tuple[int, int]:
    select_sql = ", ".join(f'"{column}"' for column in dest_columns)
    current_rowid = 0
    copied = 0
    skipped_corrupt_rowids = 0

    while True:
        try:
            rows = src_conn.execute(
                f'SELECT rowid AS __rowid__, {select_sql} FROM "{table_name}" WHERE rowid > ? ORDER BY rowid LIMIT ?',
                (current_rowid, batch_size),
            ).fetchall()
        except sqlite3.DatabaseError:
            current_rowid += 1
            skipped_corrupt_rowids += 1
            if skipped_corrupt_rowids > max_corrupt_rowids:
                break
            continue

        if not rows:
            break

        copied += _insert_rows(dst_conn, table_name, dest_columns, rows)
        current_rowid = int(rows[-1]["__rowid__"])
        dst_conn.commit()

    return copied, skipped_corrupt_rowids


def _copy_table_exact_scan(
    src_conn: sqlite3.Connection,
    dst_conn: sqlite3.Connection,
    table_name: str,
    dest_columns: list[str],
    *,
    max_rowid: int,
    empty_stop: int = 1_024,
) -> tuple[int, int]:
    select_sql = ", ".join(f'"{column}"' for column in dest_columns)
    copied = 0
    skipped_corrupt_rowids = 0
    seen_any = False
    empty_streak = 0

    for rowid in range(1, max_rowid + 1):
        try:
            row = src_conn.execute(
                f'SELECT rowid AS __rowid__, {select_sql} FROM "{table_name}" WHERE rowid = ?',
                (rowid,),
            ).fetchone()
        except sqlite3.DatabaseError:
            skipped_corrupt_rowids += 1
            continue

        if row is None:
            if seen_any:
                empty_streak += 1
                if empty_streak >= empty_stop:
                    break
            continue

        seen_any = True
        empty_streak = 0
        copied += _insert_rows(dst_conn, table_name, dest_columns, [row])
        if copied % 128 == 0:
            dst_conn.commit()

    dst_conn.commit()
    return copied, skipped_corrupt_rowids


def _copy_sqlite_native_tables(source_db: Path, dest_db: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    with sqlite3.connect(f"file:{source_db}?mode=ro", uri=True, timeout=30) as src_conn, sqlite3.connect(
        str(dest_db),
        timeout=30,
    ) as dst_conn:
        src_conn.row_factory = sqlite3.Row
        dst_conn.row_factory = sqlite3.Row
        src_conn.execute("PRAGMA writable_schema=ON;")
        dst_conn.execute("PRAGMA foreign_keys=OFF;")

        for table_name in SQLITE_NATIVE_TABLES:
            if not _table_exists(src_conn, table_name) or not _table_exists(dst_conn, table_name):
                results.append({
                    "table": table_name,
                    "copied": 0,
                    "skipped_corrupt_rows": 0,
                    "status": "missing",
                })
                continue

            source_columns = set(_table_columns(src_conn, table_name))
            dest_columns = [column for column in _table_columns(dst_conn, table_name) if column in source_columns]
            if not dest_columns:
                results.append({
                    "table": table_name,
                    "copied": 0,
                    "skipped_corrupt_rows": 0,
                    "status": "no_shared_columns",
                })
                continue

            dst_conn.execute(f'DELETE FROM "{table_name}"')
            dst_conn.commit()

            copied = 0
            skipped_corrupt_rows = 0
            status = "copied"
            try:
                copied = _copy_table_full(src_conn, dst_conn, table_name, dest_columns)
            except sqlite3.DatabaseError:
                copied, skipped_corrupt_rows = _copy_table_forward_scan(src_conn, dst_conn, table_name, dest_columns)
                if table_name in EXACT_SCAN_TABLES and copied == 0:
                    dst_conn.execute(f'DELETE FROM "{table_name}"')
                    dst_conn.commit()
                    copied, skipped_corrupt_rows = _copy_table_exact_scan(
                        src_conn,
                        dst_conn,
                        table_name,
                        dest_columns,
                        max_rowid=EXACT_SCAN_TABLES[table_name],
                    )
                if table_name in RESILIENT_TABLES and (copied or skipped_corrupt_rows):
                    status = "partial" if skipped_corrupt_rows else "copied"
                else:
                    status = "partial" if copied else "error"

            results.append({
                "table": table_name,
                "copied": copied,
                "skipped_corrupt_rows": skipped_corrupt_rows,
                "status": status,
            })

    return results


def _summarize_dest(dest_db: Path) -> dict[str, int]:
    tables = [
        "local_records",
        "hub_notifications",
        "hub_tasks",
        "network_branches",
        "network_devices",
        "network_ports",
        "network_sockets",
        "network_maps",
        "network_map_points",
        "mfu_runtime_state",
        "mfu_page_snapshots",
    ]
    counts: dict[str, int] = {}
    with sqlite3.connect(str(dest_db), timeout=30) as conn:
        for table_name in tables:
            if _table_exists(conn, table_name):
                counts[table_name] = int(conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0])
    return counts


def _safe_replace_live_db(restored_db: Path, live_db: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = live_db.parent / f"local_store_pre_restore_{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    for suffix in ("", "-wal", "-shm"):
        src = Path(f"{live_db}{suffix}")
        if src.exists():
            shutil.move(str(src), str(backup_dir / src.name))

    shutil.copy2(restored_db, live_db)
    return backup_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Recover a clean local_store.db from a broken backup and archived JSON.")
    parser.add_argument("--template-db", default=str(REPO_ROOT / "data" / "local_store.db"))
    parser.add_argument("--source-db", default=str(REPO_ROOT / "tmp" / "local_store.db.pre_run_backup"))
    parser.add_argument("--json-dir", default=str(REPO_ROOT / "archive" / "data_json_archive_20260217_234011"))
    parser.add_argument("--dest-db", default=str(REPO_ROOT / "data" / "local_store.restored.db"))
    parser.add_argument("--replace-live", action="store_true")
    args = parser.parse_args()

    template_db = Path(args.template_db)
    source_db = Path(args.source_db)
    json_dir = Path(args.json_dir)
    dest_db = Path(args.dest_db)

    if not template_db.exists():
        raise FileNotFoundError(f"Template DB not found: {template_db}")
    if not source_db.exists():
        raise FileNotFoundError(f"Source broken DB not found: {source_db}")
    if not json_dir.exists():
        raise FileNotFoundError(f"JSON archive dir not found: {json_dir}")

    _backup_db(template_db, dest_db)

    with sqlite3.connect(str(dest_db), timeout=30) as conn:
        _clear_tables(conn, ["local_records", "migration_meta", *SQLITE_NATIVE_TABLES])

    json_stats = _import_json_archive(dest_db, json_dir)
    table_results = _copy_sqlite_native_tables(source_db, dest_db)
    summary = _summarize_dest(dest_db)

    print("JSON recovery:")
    print(json.dumps(json_stats, ensure_ascii=False, indent=2))
    print("\nSQLite-native tables:")
    print(json.dumps(table_results, ensure_ascii=False, indent=2))
    print("\nDestination summary:")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    with sqlite3.connect(str(dest_db), timeout=30) as conn:
        print("\nIntegrity:", conn.execute("PRAGMA integrity_check;").fetchone()[0])

    if args.replace_live:
        backup_dir = _safe_replace_live_db(dest_db, template_db)
        print(f"\nLive database replaced. Backup: {backup_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
