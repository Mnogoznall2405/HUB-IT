from __future__ import annotations

import logging
import os
import signal
import threading
import time
from pathlib import Path
from typing import BinaryIO, Optional

from .config import config
from .database import ScanStore
from .worker import ScanWorker


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scan-worker")


def _acquire_singleton_lock(lock_path: Path) -> Optional[BinaryIO]:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.lockf(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        handle.seek(0)
        handle.truncate()
        handle.write(str(os.getpid()).encode("ascii"))
        handle.flush()
        return handle
    except OSError:
        handle.close()
        return None


def _to_float(value: str, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _wait_for_singleton_lock(
    lock_path: Path,
    stop_event: threading.Event,
    *,
    timeout_sec: float = 30.0,
    poll_interval_sec: float = 5.0,
) -> Optional[BinaryIO]:
    warned = False
    deadline = time.monotonic() + max(0.0, timeout_sec)
    while not stop_event.is_set():
        handle = _acquire_singleton_lock(lock_path)
        if handle is not None:
            if warned:
                logger.info("Standalone scan worker lock acquired after waiting")
            return handle
        remaining_sec = deadline - time.monotonic()
        if remaining_sec <= 0:
            logger.warning(
                "Standalone scan worker lock wait timed out after %.1fs; exiting",
                max(0.0, timeout_sec),
            )
            return None
        if not warned:
            logger.warning("Another standalone scan worker is already running; waiting for lock")
            warned = True
        stop_event.wait(min(max(0.1, poll_interval_sec), remaining_sec))
    return None


def main() -> None:
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    lock_wait_sec = max(
        0.0,
        _to_float(os.getenv("SCAN_WORKER_LOCK_WAIT_SEC", "30"), 30.0),
    )
    lock_handle = _wait_for_singleton_lock(
        config.db_path.parent / "scan_worker.lock",
        stop_event,
        timeout_sec=lock_wait_sec,
    )
    if lock_handle is None:
        return

    store = ScanStore(
        db_path=config.db_path,
        archive_dir=config.archive_dir,
        task_ack_timeout_sec=config.task_ack_timeout_sec,
        agent_online_timeout_sec=config.agent_online_timeout_sec,
        resolve_agent_sql_context=config.resolve_agent_sql_context,
        job_processing_timeout_sec=config.job_processing_timeout_sec,
    )

    worker = ScanWorker(store=store, config=config, stop_event=stop_event)
    worker.start()
    logger.info("Standalone scan worker process started")
    try:
        while worker.is_alive() and not stop_event.wait(1):
            time.sleep(0)
    finally:
        stop_event.set()
        worker.join(timeout=5)
        if worker.is_alive():
            logger.warning("Standalone scan worker did not stop within timeout; forcing process exit")
            os._exit(0)
        lock_handle.close()
        logger.info("Standalone scan worker process stopped")


if __name__ == "__main__":
    main()
