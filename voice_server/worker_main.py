"""Dedicated worker process: ``python -m voice_server.worker_main``.

Polls the ``voice.voice_jobs`` queue (FOR UPDATE SKIP LOCKED) and runs each job
as a ``run.py`` subprocess inside the VoiceVideo tree. GPU-bound: default
concurrency is 1 (``VOICE_WORKER_CONCURRENCY``).
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Optional

from .config import config
from . import runner, store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("voice-worker")


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


def _worker_loop(stop_event: threading.Event, worker_index: int) -> None:
    while not stop_event.is_set():
        job = None
        try:
            job = store.claim_next_job()
        except Exception as exc:
            logger.error("worker %d: claim failed: %s", worker_index, exc)
            stop_event.wait(config.worker_interval_sec * 3)
            continue
        if job is None:
            stop_event.wait(config.worker_interval_sec)
            continue
        if store.is_cancel_requested(str(job.get("id"))):
            store.update_job(
                str(job.get("id")),
                status="cancelled",
                finished_at=datetime.now(timezone.utc),
            )
            logger.info("worker %d: job %s cancelled before start", worker_index, job.get("id"))
            continue
        logger.info("worker %d: running job %s (%s)", worker_index, job["id"], job.get("kind"))
        try:
            runner.run_job(job)
        except Exception:
            logger.exception("worker %d: job %s crashed", worker_index, job.get("id"))
            try:
                store.update_job(str(job.get("id")), status="failed", error="worker crash")
            except Exception:
                pass


def main() -> None:
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    lock_handle = _acquire_singleton_lock(config.data_dir / "voice_worker.lock")
    if lock_handle is None:
        logger.error("Another voice worker already holds the lock; exiting")
        return

    try:
        requeued = store.requeue_interrupted()
        if requeued:
            logger.warning("Requeued %d interrupted job(s)", requeued)

        threads = [
            threading.Thread(
                target=_worker_loop, args=(stop_event, idx), daemon=True, name=f"voice-worker-{idx}"
            )
            for idx in range(config.worker_concurrency)
        ]
        for thread in threads:
            thread.start()
        logger.info(
            "Voice worker ready: concurrency=%d root=%s",
            config.worker_concurrency, config.voicevideo_root,
        )
        while not stop_event.is_set():
            stop_event.wait(1.0)
        for thread in threads:
            thread.join(timeout=5)
    finally:
        lock_handle.close()


if __name__ == "__main__":
    main()
