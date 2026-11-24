"""Grant all load_user_* accounts viewer membership in the seeded library.

The library folder keeps serving a realistic, authorized listing for the
concurrency probe; without membership the service correctly answers 404.
"""
import sqlite3
import uuid
from datetime import datetime, timezone

DB = 'e2e/stack/.state-v3/app.sqlite3'
LIB = 'aa4e68e8cd454f2690b3097a96c80bdf'

db = sqlite3.connect(DB)
print(db.execute("select sql from sqlite_master where name='my_file_library_members'").fetchone()[0])
utable = db.execute(
    "select name from sqlite_master where type='table' and name like '%user%' order by name"
).fetchall()
print('user tables:', utable)
users = db.execute("select id, username from users where username like 'load_user_%'").fetchall()
print(f'{len(users)} load users')
now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S.%f')
for uid, name in users:
    db.execute(
        'insert or ignore into my_file_library_members '
        '(library_id, principal_type, principal_id, role, added_by_user_id, created_at, updated_at) '
        'values (?, ?, ?, ?, ?, ?, ?)',
        (LIB, 'user', str(uid), 'viewer', 3, now, now),
    )
db.commit()
print('members now:', db.execute('select count(*) from my_file_library_members').fetchone())
