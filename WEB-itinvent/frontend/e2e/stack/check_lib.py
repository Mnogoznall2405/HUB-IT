import sqlite3
import sys

db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else 'e2e/stack/.state-v3/app.sqlite3')
tables = [r[0] for r in db.execute("select name from sqlite_master where type='table' and (name like '%libr%' or name like '%member%' or name like '%collab%')")]
print('tables:', tables)
for t in tables:
    print(t, db.execute(f'select * from {t} limit 5').fetchall())
print('files by owner:', db.execute('select owner_user_id, count(*) from my_files group by owner_user_id').fetchall())
print('lib folders:', db.execute('select id, name, owner_user_id from my_file_folders where owner_user_id<0').fetchall()[:10])
print('lib big folder files:', db.execute("select folder_id, count(*) from my_files where owner_user_id<0 group by folder_id order by 2 desc limit 5").fetchall())
print('load users:', db.execute("select count(*) from app_users where username like 'load_user_%'").fetchone())
print('load user ids:', db.execute("select id, username from app_users where username like 'load_user_%' order by username limit 3").fetchall())
