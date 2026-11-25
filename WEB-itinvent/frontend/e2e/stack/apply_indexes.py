import sqlite3

db = sqlite3.connect("e2e/stack/.state-v3/app.sqlite3")
db.execute("CREATE INDEX IF NOT EXISTS ix_app_my_files_owner_live_folder "
           "ON my_files (owner_user_id, deleted_at, folder_id, created_at)")
db.execute("CREATE INDEX IF NOT EXISTS ix_app_my_files_owner_quota_cover "
           "ON my_files (owner_user_id, deleted_at, status, expires_at, original_size_bytes)")
db.commit()
rows = db.execute(
    "select name from sqlite_master where type='index' and tbl_name='my_files'").fetchall()
print([r[0] for r in rows])
db.close()
