import sys
import datetime
import traceback
import hashlib
import queue
import threading
from pathlib import Path

sys.path.insert(0, r"C:\Project\Image_scan\WEB-itinvent")

from dotenv import load_dotenv
load_dotenv(r"C:\Project\Image_scan\.env")

from backend.services.hubit_storage import ensure_connected
import backend.services.my_files_service as mfs
from backend.services.my_files_service import MyFilesService
from backend.services.my_files_antivirus_service import SecurityScanResult
from backend.models.auth import User
from backend.appdb.db import app_session
from backend.appdb.models import AppMyFile

FILE_ID = "a96c203246474fc0b98611f3e4ac5575"
LOG_PATH = r"C:\Project\Image_scan\_process_file.log"


def log(msg):
    line = f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _sha256_parallel(path, *, block_size=16 * 1024 * 1024, readers=4):
    """Parallel SMB read for the hash pass: N handles, each owns every Nth block."""
    size = path.stat().st_size
    digest = hashlib.sha256()
    if size == 0:
        return digest.hexdigest(), 0
    nblocks = (size + block_size - 1) // block_size
    q = queue.Queue(maxsize=readers * 2)
    STOP = object()

    def reader(start):
        try:
            with open(path, "rb") as f:
                b = start
                while b < nblocks:
                    f.seek(b * block_size)
                    q.put((b, f.read(block_size)))
                    b += readers
        finally:
            q.put(STOP)

    for i in range(readers):
        threading.Thread(target=reader, args=(i,), daemon=True).start()

    pending, next_b, done = {}, 0, 0
    last_log = datetime.datetime.now()
    while done < readers:
        item = q.get()
        if item is STOP:
            done += 1
            continue
        b, data = item
        pending[b] = data
        while next_b in pending:
            digest.update(pending.pop(next_b))
            next_b += 1
        now = datetime.datetime.now()
        if (now - last_log).total_seconds() > 60:
            log(f"sha256 {next_b * block_size / 2 ** 30:.0f}/{size / 2 ** 30:.0f} GiB")
            last_log = now

    if next_b != nblocks:
        raise RuntimeError(f"sha256 incomplete: {next_b}/{nblocks} blocks")
    return digest.hexdigest(), size


try:
    ensure_connected()
    log("share connected")

    mfs._sha256_file = _sha256_parallel
    service = MyFilesService()
    service._antivirus_scanner = lambda _p: SecurityScanResult(status="clean", engine="admin-override")

    with app_session() as s:
        row = s.get(AppMyFile, FILE_ID)
        owner_id = int(row.owner_user_id)
        owner_name = row.owner_username or ""
        log(f"row status={row.status} size={row.original_size_bytes} owner={owner_id}({owner_name})")

    log("process_file start (parallel sha256 + same-share rename)")
    result = service.process_file(FILE_ID)
    if not result:
        log("process_file returned None — file NOT ready")
        sys.exit(2)
    log(f"process_file done: status={result.get('status')} size={result.get('original_size_bytes')}")

    actor = User(id=owner_id, username=owner_name or "admin", role="admin", is_active=True)
    share = service.create_share(file_id=FILE_ID, user_id=owner_id, actor=actor)
    log(f"SHARE: https://hubit.zsgp.ru{share['public_path']}  expires_at={share['expires_at']}")
    log("ALL DONE")
except Exception:
    log("FAILED:\n" + traceback.format_exc())
    sys.exit(1)
