from __future__ import annotations

import logging
import signal
import threading
from pathlib import Path
import sys

from sqlalchemy import text


project_root = Path(__file__).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from backend.appdb.db import get_app_engine, initialize_app_schema, ping_app_database
from backend.config import config
from backend.services.my_files_service import my_files_service


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("my_files_worker")


def _acquire_worker_lock():
    engine = get_app_engine()
    if engine.dialect.name != "postgresql":
        return None
    connection = engine.connect()
    acquired = connection.execute(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": my_files_service._advisory_lock_key("my-files:worker")},
    ).scalar()
    connection.commit()
    if not acquired:
        connection.close()
        raise RuntimeError("Another my-files worker already owns the database lock")
    return connection


def main() -> None:
    if not my_files_service.configured:
        raise RuntimeError("My-files worker requires APP_DATABASE_URL")
    initialize_app_schema()
    ping_app_database()
    worker_lock = _acquire_worker_lock()
    recovered = my_files_service.recover_stale_processing(force=True)
    if recovered:
        logger.warning("Recovered %s interrupted my-files jobs", recovered)

    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    settings = config.my_files_security
    logger.info(
        "My-files worker started: antivirus=%s fail_closed=%s zstd_threads=%s max_processing=%s",
        settings.antivirus_enabled,
        settings.antivirus_fail_closed,
        settings.zstd_threads,
        settings.max_processing_global,
    )
    try:
        while not stop_event.is_set():
            try:
                processed = my_files_service.process_next_job()
                if not processed:
                    processed = my_files_service.process_next_security_backfill()
            except Exception:
                logger.exception("My-files worker cycle failed")
                stop_event.wait(10)
                continue
            stop_event.wait(0.2 if processed else 3)
    finally:
        if worker_lock is not None:
            worker_lock.close()
        logger.info("My-files worker stopped")


if __name__ == "__main__":
    main()
