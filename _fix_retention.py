import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from datetime import datetime, timedelta, timezone
from backend.config import config

e = sa.create_engine(config.app_db.database_url)
with e.begin() as c:
    r = c.execute(sa.text(
        "update app.my_files "
        "set retention_days = 0, expires_at = :exp "
        "where id = 'a96c203246474fc0b98611f3e4ac5575' "
        "returning status, retention_days, expires_at"
    ), {"exp": datetime.now(timezone.utc) + timedelta(days=36500)}).first()
    print(r)
e.dispose()
