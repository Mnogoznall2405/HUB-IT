import sys
sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")
import sqlalchemy as sa
from pathlib import Path
from backend.config import config
from backend.services.my_files_storage_layout import configured_storage_dir, resolve_under_root

e = sa.create_engine(config.app_db.database_url)
with e.connect() as c:
    b = c.execute(sa.text(
        "select id, storage_path, stored_size_bytes, ref_count, storage_mode "
        "from app.my_file_blobs where id = '3a966b8932c948f1ae1b20c8359573f8'"
    )).first()
    print("blob:", b)
    if b:
        p = resolve_under_root(configured_storage_dir(), b[1])
        print("resolved:", p)
        print("exists:", p.exists(), "size:", p.stat().st_size if p.exists() else None)
e.dispose()
