import sqlite3
import sys

db = sqlite3.connect(sys.argv[1])
names = [
    r[0] for r in db.execute(
        "select name from sqlite_master where type='index' and tbl_name='my_files'"
        " and name in ('ix_app_my_files_owner_live_folder','ix_app_my_files_owner_quota_cover')")]
print("indexes present:", names)
