import sqlite3
import time

con = sqlite3.connect('e2e/stack/.state-v3/app.sqlite3')
cur = con.cursor()
for label, q in [
    ('etag-agg', "SELECT COUNT(*), MAX(updated_at), MAX(deleted_at) FROM my_files WHERE owner_user_id=3"),
    ('count-group', "SELECT folder_id, COUNT(*) FROM my_files WHERE owner_user_id=3 AND deleted_at IS NULL AND expires_at > '2026-11-24' GROUP BY folder_id"),
    ('live-list-f10', "SELECT * FROM my_files WHERE owner_user_id=3 AND deleted_at IS NULL AND expires_at > '2026-11-24' AND folder_id='c8ce7d9b01a4407da945ef8948a7fdb7' ORDER BY created_at DESC"),
    ('folders-all', "SELECT * FROM my_file_folders WHERE owner_user_id=3 AND deleted_at IS NULL"),
    ('quota-sum', "SELECT COALESCE(SUM(original_size_bytes),0) FROM my_files WHERE owner_user_id=3 AND deleted_at IS NULL"),
]:
    ts = []
    n = -1
    for _ in range(5):
        t0 = time.perf_counter()
        rows = cur.execute(q).fetchall()
        ts.append((time.perf_counter() - t0) * 1000)
        n = len(rows)
    print(f'{label:15} n={n:5} p50={sorted(ts)[2]:.1f}ms min={min(ts):.1f}')
