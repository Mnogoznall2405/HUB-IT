from __future__ import annotations

import logging
import os
import signal
import threading
from pathlib import Path
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool


project_root = Path(__file__).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from backend.appdb.db import (
    get_app_database_url,
    get_app_engine,
    initialize_app_schema,
    ping_app_database,
)
from backend.config import config
from backend.services.my_files_service import my_files_service


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("my_files_worker")


class _WorkerLockHandle:
    """Own the PostgreSQL session lock without occupying the worker pool."""

    def __init__(self, *, engine, connection) -> None:
        self._engine = engine
        self._connection = connection

    def close(self) -> None:
        try:
            self._connection.close()
        finally:
            self._engine.dispose()


def _create_worker_lock_engine():
    application_name = str(
        os.getenv("APP_DB_DEDICATED_APPLICATION_NAME", "itinvent-my-files-worker-lock")
        or "itinvent-my-files-worker-lock"
    ).strip()
    return create_engine(
        get_app_database_url(),
        future=True,
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args={"application_name": application_name},
    )


def _acquire_worker_lock():
    engine = get_app_engine()
    if engine.dialect.name != "postgresql":
        return None
    lock_engine = _create_worker_lock_engine()
    connection = lock_engine.connect()
    handle = _WorkerLockHandle(engine=lock_engine, connection=connection)
    try:
        acquired = connection.execute(
            text("SELECT pg_try_advisory_lock(:lock_key)"),
            {"lock_key": my_files_service._advisory_lock_key("my-files:worker")},
        ).scalar()
        connection.commit()
        if not acquired:
            raise RuntimeError("Another my-files worker already owns the database lock")
        return handle
    except Exception:
        handle.close()
        raise


def main() -> None:
    if not my_files_service.configured:
        raise RuntimeError("My-files worker requires APP_DATABASE_URL")
    initialize_app_schema()
    ping_app_database()
    my_files_service._ensure_dirs()
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
        "My-files worker started: antivirus=%s provider=%s fail_closed=%s zstd_threads=%s max_processing=%s",
        settings.antivirus_enabled,
        settings.antivirus_provider,
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
