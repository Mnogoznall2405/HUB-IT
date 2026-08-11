"""Start the shared durable file-preview worker."""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
from pathlib import Path
from uuid import uuid4


_project_root = Path(__file__).resolve().parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_path, override=False)
    except ImportError:
        with _env_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from backend.chat.chat_attachment_preview_service import chat_attachment_preview_service
from backend.chat.db import ensure_chat_configured, initialize_chat_schema, ping_chat_database
from backend.appdb.db import initialize_app_schema, ping_app_database
from backend.services.document_preview_job_service import document_preview_job_service
from backend.services.my_files_service import my_files_service
from backend.services.task_attachment_preview_service import task_attachment_preview_service


logger = logging.getLogger("backend.preview.worker")


def _positive_int_env(name: str, default: int, *, maximum: int = 8) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        value = default
    return max(1, min(maximum, value))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Shared file preview worker")
    parser.add_argument("--once", action="store_true", help="Process at most one job and exit")
    return parser.parse_args()


_PREVIEW_JOB_HANDLERS = (
    lambda worker_id: chat_attachment_preview_service.process_next_job(worker_id=worker_id),
    lambda worker_id: task_attachment_preview_service.process_next_job(worker_id=worker_id),
    lambda worker_id: document_preview_job_service.process_next_job(worker_id=worker_id),
    lambda _worker_id: my_files_service.process_next_preview_job(),
)


def _process_next_preview_job_round_robin(*, worker_id: str, start_index: int = 0) -> tuple[bool, int]:
    handler_count = len(_PREVIEW_JOB_HANDLERS)
    normalized_start = max(0, int(start_index or 0)) % handler_count
    for offset in range(handler_count):
        index = (normalized_start + offset) % handler_count
        if _PREVIEW_JOB_HANDLERS[index](worker_id):
            return True, (index + 1) % handler_count
    return False, (normalized_start + 1) % handler_count


def _process_next_preview_job(*, worker_id: str) -> bool:
    """Backward-compatible single-cycle helper used by --once and tests."""

    processed, _next_index = _process_next_preview_job_round_robin(worker_id=worker_id)
    return processed


def _run_worker_loop(*, worker_id: str, stop_event: threading.Event) -> None:
    next_handler_index = 0
    while not stop_event.is_set():
        try:
            processed, next_handler_index = _process_next_preview_job_round_robin(
                worker_id=worker_id,
                start_index=next_handler_index,
            )
        except Exception:
            logger.exception("Preview worker cycle failed worker_id=%s", worker_id)
            stop_event.wait(5)
            continue
        stop_event.wait(
            0.05 if processed else min(
                chat_attachment_preview_service.poll_interval_ms,
                task_attachment_preview_service.poll_interval_ms,
                document_preview_job_service.poll_interval_ms,
            ) / 1000.0
        )


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    ensure_chat_configured()
    initialize_chat_schema()
    ping_chat_database()
    initialize_app_schema()
    ping_app_database()
    my_files_service._ensure_dirs()

    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except Exception:
        pass

    worker_id = f"{os.getpid()}-{uuid4().hex[:12]}"
    concurrency = _positive_int_env("PREVIEW_WORKER_CONCURRENCY", 2)
    logger.info(
        "Preview worker started worker_id=%s concurrency=%s chat_lease_sec=%s "
        "task_lease_sec=%s document_lease_sec=%s chat_max_attempts=%s task_max_attempts=%s "
        "document_max_attempts=%s sources=chat,hub-task,mail,docflow,my-files poll_ms=%s",
        worker_id,
        concurrency,
        chat_attachment_preview_service.lease_seconds,
        task_attachment_preview_service.lease_seconds,
        document_preview_job_service.lease_seconds,
        chat_attachment_preview_service.max_attempts,
        task_attachment_preview_service.max_attempts,
        document_preview_job_service.max_attempts,
        min(
            chat_attachment_preview_service.poll_interval_ms,
            task_attachment_preview_service.poll_interval_ms,
            document_preview_job_service.poll_interval_ms,
        ),
    )

    if args.once:
        try:
            _process_next_preview_job(worker_id=worker_id)
        except Exception:
            logger.exception("Preview worker cycle failed worker_id=%s", worker_id)
            return 2
        return 0

    threads = [
        threading.Thread(
            target=_run_worker_loop,
            kwargs={"worker_id": f"{worker_id}-{index + 1}", "stop_event": stop_event},
            name=f"preview-worker-{index + 1}",
            daemon=True,
        )
        for index in range(concurrency)
    ]
    for thread in threads:
        thread.start()

    try:
        while not stop_event.wait(0.5):
            if not any(thread.is_alive() for thread in threads):
                logger.error("All preview worker threads stopped unexpectedly")
                return 2
    finally:
        stop_event.set()
        for thread in threads:
            thread.join(timeout=10.0)
    logger.info("Preview worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
