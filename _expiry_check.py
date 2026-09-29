import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from backend.config import config

e = sa.create_engine(config.app_db.database_url)
with e.connect() as c:
    r = c.execute(sa.text(
        "select status, retention_days, expires_at, updated_at "
        "from app.my_files where id = 'a96c203246474fc0b98611f3e4ac5575'"
    )).first()
    print(r)
e.dispose()
