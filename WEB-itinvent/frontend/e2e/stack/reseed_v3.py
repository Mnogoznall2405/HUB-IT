"""Re-seed the V3 stand DB directly in SQLite (upload rate-limit bypass).

IDs come from e2e/artifacts/perf-audit/seed-v3.json so the perf harness keeps
working without re-seeding. owner=3 is e2e_admin; library owner namespace = -1.
"""
import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

STACK = Path(__file__).resolve().parent
DB = STACK / ".state-v3" / "app.sqlite3"
SEED_JSON = STACK.parent / "artifacts" / "perf-audit" / "seed-v3.json"

OWNER = 3
LIB_OWNER = -1
NOW = datetime.now(timezone.utc)
EXPIRES = NOW + timedelta(days=3650)
TS = "%Y-%m-%d %H:%M:%S.%f"


def ts(dt):
    return dt.strftime(TS)


def nid():
    return uuid.uuid4().hex


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def main():
    seed = json.loads(SEED_JSON.read_text())
    tf = {int(k): v for k, v in seed["tableFolders"].items()}
    nav = seed["nav"]
    lib_id = seed["libraries"]["a"]
    lib_root = seed["libRoot"]
    lib_deep = seed["libDeepFolderId"]

    db = sqlite3.connect(DB)
    cur = db.cursor()

    # --- folders -----------------------------------------------------------
    folders = []

    def folder(fid, owner, parent, name):
        folders.append((fid, owner, parent, name, 0, ts(NOW), ts(NOW), None))

    for n, fid in sorted(tf.items()):
        folder(fid, OWNER, None, "v3-f%d" % n)
    folder(nav["a"], OWNER, None, "v3-nav-a")
    folder(nav["b"], OWNER, nav["a"], "v3-nav-b")
    folder(nav["c"], OWNER, nav["b"], "v3-nav-c")

    # library: root + 12-deep chain ending at lib_deep + 150 spread folders
    folder(lib_root, LIB_OWNER, None, "v3-lib-root")
    parent = lib_root
    for d in range(1, 12):
        fid = lib_deep if d == 11 else nid()
        folder(fid, LIB_OWNER, parent, "v3-deep-%d" % d)
        parent = fid
    spread_ids = [nid() for _ in range(150)]
    for i, sid in enumerate(spread_ids):
        under = spread_ids[i % len(spread_ids)] if i % 3 == 0 and i > 0 else lib_root
        folder(sid, LIB_OWNER, under, "v3-lib-n%03d" % i)

    cur.executemany(
        "INSERT INTO my_file_folders (id, owner_user_id, parent_id, name, is_favorite,"
        " created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?)",
        folders,
    )

    # --- library entity ----------------------------------------------------
    cur.execute(
        "INSERT INTO my_file_libraries (id, name, owner_user_id, quota_bytes,"
        " created_by_user_id, created_at, updated_at, deleted_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (lib_id, "v3-lib", LIB_OWNER, 53687091200, OWNER, ts(NOW), ts(NOW), None),
    )

    # --- blobs + files -----------------------------------------------------
    blobs = []
    files = []

    def add_file(owner, folder_id, name, idx):
        fid = nid()
        sha_hex = sha(fid + name)
        mime = "text/plain"
        size = 256 + (idx % 4096)
        created = NOW - timedelta(minutes=idx % 10000, seconds=idx % 60)
        blobs.append((
            nid(), owner, sha_hex, "seed/%s.bin" % sha_hex[:16], "stored", sha_hex,
            size, size, mime, ".txt", 1, ts(created), ts(created), ts(created),
        ))
        files.append((
            fid, owner, "e2e_admin", OWNER, name, name, mime, mime,
            size, size, 1, "ready", "stored", sha_hex, blobs[-1][0], folder_id,
            "seed/spool", "", "clean", "seed", 0, ts(created), ts(created), ts(EXPIRES), None,
        ))

    kinds = ["txt", "md", "csv", "json", "log"]
    for n, folder_id in sorted(tf.items()):
        for i in range(n):
            add_file(OWNER, folder_id, "perf-%d-file-%04d.%s" % (n, i, kinds[i % 5]), i)

    add_file(OWNER, nav["b"], "v3-marker-nav-b.txt", 0)
    add_file(OWNER, nav["c"], "v3-marker-nav-c.txt", 0)
    add_file(OWNER, None, "zebra-search-marker.txt", 0)
    add_file(OWNER, None, "v3-root-marker.txt", 0)
    for i in range(40):
        add_file(OWNER, None, "v3-root-file-%02d.txt" % i, i)
    for i in range(150):
        add_file(LIB_OWNER, lib_deep, "v3-lib-file-%03d.txt" % i, i)

    cur.executemany(
        "INSERT INTO my_file_blobs (id, owner_user_id, original_sha256, storage_path,"
        " storage_mode, stored_sha256, original_size_bytes, stored_size_bytes,"
        " output_mime_type, output_extension, ref_count, created_at, updated_at,"
        " last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        blobs,
    )
    cur.executemany(
        "INSERT INTO my_files (id, owner_user_id, owner_username, uploaded_by_user_id,"
        " original_file_name, download_file_name, mime_type, download_mime_type,"
        " original_size_bytes, stored_size_bytes, retention_days, status, storage_mode,"
        " original_sha256, blob_id, folder_id, spool_path, error_text,"
        " security_scan_status, security_scan_engine, is_favorite, created_at,"
        " updated_at, expires_at, deleted_at)"
        " VALUES (%s)" % ",".join("?" * 25),
        files,
    )
    db.commit()
    print("folders", db.execute("select count(*) from my_file_folders").fetchone()[0])
    print("files", db.execute("select count(*) from my_files").fetchone()[0])
    print("blobs", db.execute("select count(*) from my_file_blobs").fetchone()[0])
    db.close()


if __name__ == "__main__":
    main()
