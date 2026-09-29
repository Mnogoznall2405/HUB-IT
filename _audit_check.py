import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from backend.config import config

e = sa.create_engine(config.app_db.database_url)
with e.connect() as c:
    rows = c.execute(sa.text(
        "select action, actor_username, ip_address, created_at "
        "from app.my_file_audit "
        "where file_id = 'a96c203246474fc0b98611f3e4ac5575' "
        "order by created_at desc limit 30"
    )).fetchall()
    for r in rows:
        print(r)
    print("---")
    print("download_started count:", c.execute(sa.text(
        "select count(*) from app.my_file_audit "
        "where file_id = 'a96c203246474fc0b98611f3e4ac5575' and action like '%download%'"
    )).scalar())
e.dispose()
