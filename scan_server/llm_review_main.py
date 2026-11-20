"""Standalone entry point for the Scan LLM second-opinion reviewer.

``python -m scan_server.llm_review_main`` — one process per host (singleton lock),
BelowNormal priority on Windows. When ``SCAN_LLM_REVIEW_ENABLED=0`` the process
idles instead of exiting so PM2 does not enter a restart loop.
"""

from __future__ import annotations

import logging
import os
import signal
import threading
import time
from pathlib import Path
from typing import BinaryIO, Optional

from .config import config
from .llm_review_worker import LlmReviewWorker, build_default_store
from .worker_main import _acquire_singleton_lock, _set_below_normal_priority, _to_float, _wait_for_singleton_lock

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scan-llm-worker-main")


def main() -> None:
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    if _set_below_normal_priority():
        logger.info("Scan LLM worker process priority set to BelowNormal")

    if not config.llm_review_enabled:
        logger.info("SCAN_LLM_REVIEW_ENABLED=0 — LLM reviewer idles (no work claimed)")
        while not stop_event.wait(30):
            pass
        return

    lock_wait_sec = max(
        0.0,
        _to_float(os.getenv("SCAN_LLM_WORKER_LOCK_WAIT_SEC", "30"), 30.0),
    )
    lock_handle = _wait_for_singleton_lock(
        config.db_path.parent / "scan_llm_worker.lock",
        stop_event,
        timeout_sec=lock_wait_sec,
    )
    if lock_handle is None:
        return

    store = build_default_store(config)
    worker = LlmReviewWorker(store=store, config=config, stop_event=stop_event)
    interval = max(1, int(getattr(config, "llm_review_interval_sec", 5) or 5))
    logger.info("Scan LLM reviewer started (model=%s)", config.llm_review_model_path)
    try:
        while not stop_event.is_set():
            processed = False
            try:
                processed = worker.process_one()
            except Exception:  # noqa: BLE001 — service must survive store errors
                logger.exception("LLM review loop iteration failed")
            if not processed:
                wait = interval * 4 if worker.backend_recently_failed() else interval
                stop_event.wait(wait)
    finally:
        lock_handle.close()
        logger.info("Scan LLM reviewer stopped")


if __name__ == "__main__":
    main()
