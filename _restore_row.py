import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from backend.config import config

e = sa.create_engine(config.app_db.database_url)
with e.begin() as c:
    r = c.execute(sa.text(
        "update app.my_files set status='ready', error_text='' "
        "where id = 'a96c203246474fc0b98611f3e4ac5575' "
        "returning status, error_text, blob_id, original_sha256, stored_size_bytes, "
        "share_token_hash is not null as shared, download_file_name"
    )).first()
    print(r)
e.dispose()
