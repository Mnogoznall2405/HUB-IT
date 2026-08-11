"""Non-blocking logging for Chat API (QueueHandler → background QueueListener).

Hot-path code must only call stdlib logging APIs; handlers never block the
asyncio MainThread on file/console I/O. Overflow increments dropped_logs.
"""
from __future__ import annotations

import atexit
import logging
import logging.handlers
import os
import queue
import threading
import time
from typing import Any


def _env_flag(name: str, default: str = "1") -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(str(os.getenv(name, str(default)) or default).strip() or default))
    except Exception:
        return max(minimum, int(default))


CHAT_LOG_QUEUE_SIZE = _env_int("CHAT_LOG_QUEUE_SIZE", 5000, 100)
CHAT_ROUTE_LOG_SLOW_MS = float(str(os.getenv("CHAT_ROUTE_LOG_SLOW_MS", "200") or "200").strip() or "200")
CHAT_SLOW_LOG_RATE_LIMIT_SEC = float(str(os.getenv("CHAT_SLOW_LOG_RATE_LIMIT_SEC", "5") or "5").strip() or "5")

_DROP_LOCK = threading.Lock()
_DROPPED_LOGS = 0
_INSTALLED = False
_LISTENER: logging.handlers.QueueListener | None = None
_LOG_QUEUE: queue.SimpleQueue | queue.Queue | None = None
_RATE_LOCK = threading.Lock()
_RATE_LAST: dict[str, float] = {}


class _NonBlockingQueueHandler(logging.handlers.QueueHandler):
    """QueueHandler that never blocks: overflow → drop + counter."""

    def enqueue(self, record: logging.LogRecord) -> None:  # type: ignore[override]
        global _DROPPED_LOGS
        try:
            self.queue.put_nowait(record)
        except Exception:
            with _DROP_LOCK:
                _DROPPED_LOGS += 1


def dropped_logs() -> int:
    with _DROP_LOCK:
        return int(_DROPPED_LOGS)


def logging_stats() -> dict[str, Any]:
    qsize = 0
    try:
        if _LOG_QUEUE is not None and hasattr(_LOG_QUEUE, "qsize"):
            qsize = int(_LOG_QUEUE.qsize())  # type: ignore[arg-type]
    except Exception:
        qsize = 0
    return {
        "installed": bool(_INSTALLED),
        "queue_size": qsize,
        "queue_capacity": int(CHAT_LOG_QUEUE_SIZE),
        "dropped_logs": dropped_logs(),
    }


def allow_rate_limited(key: str, *, interval_sec: float | None = None) -> bool:
    """Return True if this key may emit now (one emit per interval)."""
    window = float(CHAT_SLOW_LOG_RATE_LIMIT_SEC if interval_sec is None else interval_sec)
    now = time.monotonic()
    with _RATE_LOCK:
        last = float(_RATE_LAST.get(key) or 0.0)
        if (now - last) < window:
            return False
        _RATE_LAST[key] = now
        return True


def install_chat_async_logging(*, force: bool = False) -> dict[str, Any]:
    """Install QueueHandler on root + key chat loggers. Idempotent."""
    global _INSTALLED, _LISTENER, _LOG_QUEUE
    if _INSTALLED and not force:
        return logging_stats()

    log_queue: queue.Queue = queue.Queue(maxsize=CHAT_LOG_QUEUE_SIZE)
    _LOG_QUEUE = log_queue

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )

    listener = logging.handlers.QueueListener(log_queue, stream_handler, respect_handler_level=True)
    listener.daemon = True  # type: ignore[attr-defined]
    listener.start()
    _LISTENER = listener

    queue_handler = _NonBlockingQueueHandler(log_queue)
    queue_handler.setLevel(logging.INFO)

    # Replace blocking handlers on root and hot chat loggers.
    targets = [
        logging.getLogger(),
        logging.getLogger("backend.chat"),
        logging.getLogger("backend.chat.api"),
        logging.getLogger("backend.chat.websocket"),
        logging.getLogger("backend.chat.realtime"),
        logging.getLogger("backend.request_metrics"),
        logging.getLogger("uvicorn"),
        logging.getLogger("uvicorn.error"),
        logging.getLogger("uvicorn.access"),
    ]
    for logger in targets:
        logger.handlers = [queue_handler]
        logger.propagate = False if logger is not logging.getLogger() else True
        if logger.level == logging.NOTSET or logger.level > logging.INFO:
            logger.setLevel(logging.INFO)

    # Root keeps queue handler; avoid double-emit via propagate on children.
    for name in (
        "backend.chat",
        "backend.chat.api",
        "backend.chat.websocket",
        "backend.chat.realtime",
        "backend.request_metrics",
        "uvicorn",
        "uvicorn.error",
        "uvicorn.access",
    ):
        logging.getLogger(name).propagate = False

    _INSTALLED = True

    def _shutdown() -> None:
        stop_chat_async_logging()

    atexit.register(_shutdown)
    return logging_stats()


def stop_chat_async_logging() -> None:
    global _INSTALLED, _LISTENER
    listener = _LISTENER
    _LISTENER = None
    if listener is not None:
        try:
            listener.stop()
        except Exception:
            pass
    _INSTALLED = False


def should_log_route_timing(took_ms: float) -> bool:
    return float(took_ms or 0.0) >= float(CHAT_ROUTE_LOG_SLOW_MS)


def log_slow_warning(logger: logging.Logger, key: str, msg: str, *args: Any) -> None:
    if not allow_rate_limited(f"slow:{key}"):
        return
    logger.warning(msg, *args)
