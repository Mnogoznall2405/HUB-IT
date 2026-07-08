from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path
from typing import BinaryIO, Optional

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

from .config import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scan-server-main")


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


def _wait_for_singleton_lock(
    lock_path: Path,
    stop_event: threading.Event,
    *,
    timeout_sec: float,
    poll_interval_sec: float = 5.0,
) -> Optional[BinaryIO]:
    warned = False
    started_at = time.monotonic()
    while not stop_event.is_set():
        handle = _acquire_singleton_lock(lock_path)
        if handle is not None:
            if warned:
                logger.info("Scan API lock acquired after waiting")
            return handle
        if not warned:
            logger.warning("Another scan API process is already running; waiting for lock")
            warned = True
        if timeout_sec > 0 and time.monotonic() - started_at >= timeout_sec:
            logger.error(
                "Scan API lock wait timed out after %.1fs; exiting for PM2 lifecycle recovery",
                timeout_sec,
            )
            return None
        stop_event.wait(max(0.05, float(poll_interval_sec or 5.0)))
    return None


def main() -> None:
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    lock_handle = _wait_for_singleton_lock(
        config.db_path.parent / "scan_server.lock",
        stop_event,
        timeout_sec=float(config.server_lock_wait_sec),
    )
    if lock_handle is None:
        return

    from .app import app

    try:
        uvicorn.run(
            app,
            host=config.host,
            port=config.port,
            reload=False,
            loop="scan_server.uvicorn_loops:windows_selector_loop_factory",
        )
    finally:
        lock_handle.close()


if __name__ == "__main__":
    main()
