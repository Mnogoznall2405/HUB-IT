"""Write-impact of the two new my_files indexes: insert/update/delete timings."""
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

SRC = Path("e2e/stack/.state-v3/app.sqlite3")
IDX = [
    ("ix_app_my_files_owner_live_folder",
     "my_files (owner_user_id, deleted_at, folder_id, created_at)"),
    ("ix_app_my_files_owner_quota_cover",
     "my_files (owner_user_id, deleted_at, status, expires_at, original_size_bytes)"),
]
N = 2000


def seed_rows(db, n):
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=3650)
    ts = "%Y-%m-%d %H:%M:%S.%f"
    rows = [
        (uuid.uuid4().hex, 3, "e2e_admin", 3, "w.txt", "w.txt", "text/plain", "text/plain",
         100, 100, 1, "ready", "stored", uuid.uuid4().hex, None, None,
         "seed/spool", "", "clean", "seed", 0,
         now.strftime(ts), now.strftime(ts), exp.strftime(ts), None)
        for _ in range(n)
    ]
    db.executemany(
        "INSERT INTO my_files (id, owner_user_id, owner_username, uploaded_by_user_id,"
        " original_file_name, download_file_name, mime_type, download_mime_type,"
        " original_size_bytes, stored_size_bytes, retention_days, status, storage_mode,"
        " original_sha256, blob_id, folder_id, spool_path, error_text,"
        " security_scan_status, security_scan_engine, is_favorite, created_at,"
        " updated_at, expires_at, deleted_at) VALUES (%s)" % ",".join("?" * 25),
        rows)
    db.commit()


def timed(db, fn):
    t0 = time.perf_counter()
    fn()
    return (time.perf_counter() - t0) * 1000


def measure(path):
    db = sqlite3.connect(path)
    insert_ms = timed(db, lambda: seed_rows(db, N))
    update_ms = timed(db, lambda: db.executemany(
        "UPDATE my_files SET original_file_name = original_file_name || 'x' WHERE id = ?",
        [(r[0],) for r in db.execute("SELECT id FROM my_files WHERE spool_path='seed/spool' LIMIT %d" % N)]))
    db.commit()
    delete_ms = timed(db, lambda: db.execute(
        "DELETE FROM my_files WHERE spool_path='seed/spool'").rowcount and db.commit())
    db.close()
    return insert_ms, update_ms, delete_ms


def main():
    tmp = Path(tempfile.mkdtemp())
    with_idx = tmp / "with.sqlite3"
    without_idx = tmp / "without.sqlite3"
    for target in (with_idx, without_idx):
        shutil.copy(SRC, target)
        # Remove leftover seed rows so both runs insert into identical state.
        db = sqlite3.connect(target)
        db.execute("DELETE FROM my_files WHERE spool_path='seed/spool'")
        db.commit()
        db.close()

    db = sqlite3.connect(without_idx)
    for name, _cols in IDX:
        db.execute("DROP INDEX IF EXISTS %s" % name)
    db.commit()
    db.close()

    a = measure(without_idx)
    b = measure(with_idx)
    print("N=%d rows" % N)
    print("without new indexes: insert %.0fms update %.0fms delete %.0fms" % a)
    print("with new indexes   : insert %.0fms update %.0fms delete %.0fms" % b)
    print("delta              : insert %+.0fms update %+.0fms delete %+.0fms"
          % (b[0] - a[0], b[1] - a[1], b[2] - a[2]))


if __name__ == "__main__":
    main()
