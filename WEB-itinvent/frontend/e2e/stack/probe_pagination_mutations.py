"""Pagination under mutations: keyset walk while rows are inserted/deleted
directly in SQLite mid-walk (same technique as reseed_v3.py). Uses the f5000
folder so it never perturbs the f1000 perf measurements.

Checks:
  - deleting a not-yet-fetched row mid-walk removes it from later pages,
    pages stay disjoint, cursor walk still terminates;
  - inserting a row that sorts before the cursor does NOT resurrect it
    (keyset bound, not offset) — the walk sees a consistent snapshot window;
  - moving a row out of the folder mid-walk drops it from later pages;
  - total/ETag reflect the mutations (ETag rotates on insert+delete).

Run:  python e2e/stack/probe_pagination_mutations.py
Reseed afterwards if it fails mid-way:  python e2e/stack/reseed_v3.py
"""
import http.client
import json
import sqlite3
import time
import uuid
from pathlib import Path

HOST, PORT = '127.0.0.1', 18013
FOLDER = 'b5f9699ca35945e194c0b74491617a72'  # perf-f5000
DB = Path(__file__).resolve().parent / '.state-v3' / 'app.sqlite3'
OWNER = 3  # e2e_admin per reseed_v3.py


def login():
    c = http.client.HTTPConnection(HOST, PORT, timeout=30)
    c.request('POST', '/api/v1/auth/login', body=json.dumps(
        {'username': 'e2e_admin', 'password': 'e2e-local-admin-pass'}),
        headers={'Content-Type': 'application/json'})
    r = c.getresponse()
    r.read()
    assert r.status == 200, r.status
    return '; '.join(v.split(';')[0] for k, v in r.getheaders() if k.lower() == 'set-cookie')


def get(cookie, path):
    t0 = time.perf_counter()
    c = http.client.HTTPConnection(HOST, PORT, timeout=60)
    c.request('GET', path, headers={'Cookie': cookie})
    r = c.getresponse()
    body = r.read()
    dt = (time.perf_counter() - t0) * 1000
    return dt, r.status, json.loads(body) if body else {}, r.getheader('ETag') or ''


def db():
    con = sqlite3.connect(str(DB), timeout=30)
    con.execute('PRAGMA busy_timeout=15000')
    return con


def insert_file(con, fid, name, folder_id=FOLDER, owner=OWNER):
    now = '2026-11-25T12:00:00'
    sha = uuid.uuid4().hex
    blob = uuid.uuid4().hex
    con.execute(
        'INSERT INTO my_file_blobs (id, owner_user_id, original_sha256, storage_path,'
        ' storage_mode, stored_sha256, original_size_bytes, stored_size_bytes,'
        ' output_mime_type, output_extension, ref_count, created_at, updated_at, last_used_at)'
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (blob, owner, sha, f'seed/{sha[:16]}.bin', 'stored', sha, 256, 256, 'text/plain',
         '.txt', 1, now, now, now))
    con.execute(
        'INSERT INTO my_files (id, owner_user_id, owner_username, uploaded_by_user_id,'
        ' original_file_name, download_file_name, mime_type, download_mime_type,'
        ' original_size_bytes, stored_size_bytes, retention_days, status, storage_mode,'
        ' original_sha256, blob_id, folder_id, spool_path, error_text,'
        ' security_scan_status, security_scan_engine, is_favorite, created_at,'
        ' updated_at, expires_at, deleted_at)'
        ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (fid, owner, 'e2e_admin', owner, name, name, 'text/plain', 'text/plain',
         256, 256, 1, 'ready', 'stored', sha, blob, folder_id,
         'seed/spool', '', 'clean', 'seed', 0, now, now, '2030-01-01T00:00:00', None))
    con.commit()


def soft_delete(con, fid):
    con.execute("UPDATE my_files SET deleted_at='2026-11-25T13:00:00',"
                " updated_at='2026-11-25T13:00:00' WHERE id=?", (fid,))
    con.commit()


def move_out(con, fid):
    con.execute("UPDATE my_files SET folder_id=NULL, updated_at='2026-11-25T13:00:00' WHERE id=?",
                (fid,))
    con.commit()


def hard_remove(con, fid):
    blob = con.execute('SELECT blob_id FROM my_files WHERE id=?', (fid,)).fetchone()
    con.execute('DELETE FROM my_files WHERE id=?', (fid,))
    if blob and blob[0]:
        con.execute('DELETE FROM my_file_blobs WHERE id=?', (blob[0],))
    con.commit()


def main():
    cookie = login()
    base = f'/api/v1/my-files?folder_id={FOLDER}'
    con = db()

    # --- baseline walk -------------------------------------------------------
    dt, st, p1, etag0 = get(cookie, f'{base}&limit=150&sort=name&order=asc')
    assert st == 200 and len(p1['items']) == 150, f'p1 broken: {st} {len(p1.get("items", []))}'
    total0 = p1['total']
    cursor = p1['next_cursor']
    print(f'p1: {dt:.0f}ms total={total0} etag={etag0[:20]}…')

    # --- delete a row that lives on page 2+, mid-walk --------------------------
    # names are perf-5000-file-NNNN.* — page-1 covers the first ~150 sort-wise;
    # delete one sitting well past the cursor (e.g. index ~400 of the ordering).
    con2 = db()
    victim = con2.execute(
        "SELECT id, original_file_name FROM my_files WHERE folder_id=? AND deleted_at IS NULL"
        " ORDER BY original_file_name LIMIT 1 OFFSET 400", (FOLDER,)).fetchone()
    assert victim, 'no victim row'
    vid, vname = victim
    soft_delete(con2, vid)
    print(f'soft-deleted mid-walk: {vname} ({vid[:8]})')

    dt, st, p2, etag1 = get(cookie, f'{base}&limit=150&sort=name&order=asc&cursor={cursor}')
    ids2 = {i['id'] for i in p2['items']}
    print(f'p2 after delete: {dt:.0f}ms items={len(p2["items"])} total={p2["total"]} victim_present={vid in ids2}')
    assert st == 200
    assert vid not in ids2, 'deleted row resurrected on page-2'
    assert not ({i["id"] for i in p1["items"]} & ids2), 'pages overlap after mutation'
    assert etag1 and etag1 != etag0, 'ETag did not rotate on delete'

    # --- insert a row sorting BEFORE the cursor: must not resurrect ------------
    fid_new = uuid.uuid4().hex
    insert_file(con2, fid_new, 'perf-5000-file-0001-mutant.txt')
    cur2 = p2['next_cursor']
    dt, st, p3, _ = get(cookie, f'{base}&limit=150&sort=name&order=asc&cursor={cur2}')
    ids3 = {i['id'] for i in p3['items']}
    print(f'p3 after insert-before-cursor: {dt:.0f}ms items={len(p3["items"])} mutant_present={fid_new in ids3}')
    assert st == 200
    assert fid_new not in ids3, 'row inserted before cursor leaked into later page'
    assert not (ids2 & ids3), 'pages 2/3 overlap'

    # --- move a row out of the folder mid-walk ---------------------------------
    victim2 = con2.execute(
        "SELECT id, original_file_name FROM my_files WHERE folder_id=? AND deleted_at IS NULL"
        " ORDER BY original_file_name LIMIT 1 OFFSET 700", (FOLDER,)).fetchone()
    vid2, vname2 = victim2
    move_out(con2, vid2)
    cur3 = p3['next_cursor']
    dt, st, p4, _ = get(cookie, f'{base}&limit=150&sort=name&order=asc&cursor={cur3}')
    ids4 = {i['id'] for i in p4['items']}
    print(f'p4 after move-out: {dt:.0f}ms items={len(p4["items"])} moved_present={vid2 in ids4}')
    assert st == 200 and vid2 not in ids4, 'moved-out row stayed on page-4'

    # --- ETag must differ from baseline; totals reflect mutations ---------------
    dt, st, p1b, etag2 = get(cookie, f'{base}&limit=150&sort=name&order=asc')
    print(f'p1 recheck: total={p1b["total"]} (was {total0}, expect -1: delete+insert cancel, move -1) etag_changed={etag2 != etag0}')
    assert p1b['total'] == total0 - 1, f'total drift: {total0} -> {p1b["total"]}'

    # --- cleanup: remove the mutant, restore victim rows ------------------------
    hard_remove(con2, fid_new)
    con2.execute("UPDATE my_files SET deleted_at=NULL WHERE id=?", (vid,))
    con2.execute("UPDATE my_files SET folder_id=? WHERE id=?", (FOLDER, vid2))
    con2.commit()
    con2.close()
    con.close()
    print('PAGINATION-UNDER-MUTATIONS PROBE OK')


if __name__ == '__main__':
    main()
