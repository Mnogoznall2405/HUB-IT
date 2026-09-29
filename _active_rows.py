import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from backend.config import config

e = sa.create_engine(config.app_db.database_url)
with e.connect() as c:
    rows = c.execute(sa.text(
        "select id, status, updated_at from app.my_files "
        "where status in ('uploading','queued','scanning','processing') and deleted_at is null"
    )).fetchall()
    print("active:", rows)
e.dispose()
