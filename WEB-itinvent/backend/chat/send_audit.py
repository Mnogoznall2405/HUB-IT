"""Temporary send-path latency audit (session 20cb37). No message body / secrets.

Writes are queued and flushed from a background thread so the asyncio event loop
is not blocked by synchronous file I/O.
"""
from __future__ import annotations

import atexit
import json
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_LOG_PATH = Path(__file__).resolve().parents[3] / "debug-20cb37.log"
_SESSION_ID = "20cb37"
_WRITE_QUEUE: queue.Queue[str | None] = queue.Queue(maxsize=20_000)
_WORKER_STARTED = False
_WORKER_LOCK = threading.Lock()
_DROPPED = 0


def new_trace_id() -> str:
    return uuid.uuid4().hex[:12]


def _ensure_worker() -> None:
    global _WORKER_STARTED
    if _WORKER_STARTED:
        return
    with _WORKER_LOCK:
        if _WORKER_STARTED:
            return

        def _run() -> None:
            while True:
                try:
                    item = _WRITE_QUEUE.get()
                except Exception:
                    continue
                if item is None:
                    _WRITE_QUEUE.task_done()
                    break
                try:
                    with _LOG_PATH.open("a", encoding="utf-8") as handle:
                        handle.write(item)
                        while True:
                            try:
                                nxt = _WRITE_QUEUE.get_nowait()
                            except queue.Empty:
                                break
                            if nxt is None:
                                _WRITE_QUEUE.task_done()
                                return
                            handle.write(nxt)
                            _WRITE_QUEUE.task_done()
                except Exception:
                    pass
                finally:
                    try:
                        _WRITE_QUEUE.task_done()
                    except Exception:
                        pass

        worker = threading.Thread(target=_run, name="chat-send-audit-writer", daemon=True)
        worker.start()
        _WORKER_STARTED = True

        def _shutdown() -> None:
            try:
                _WRITE_QUEUE.put_nowait(None)
            except Exception:
                pass

        atexit.register(_shutdown)


def audit_send_trace(
    *,
    trace_id: str,
    stage: str,
    elapsed_ms: float,
    **fields: Any,
) -> None:
    global _DROPPED
    try:
        from backend.chat.latency_profile import audit_enabled

        if not audit_enabled():
            return
    except Exception:
        pass
    try:
        _ensure_worker()
        payload = {
            "sessionId": _SESSION_ID,
            "runId": "send-audit",
            "hypothesisId": "AUDIT",
            "location": f"send_audit:{stage}",
            "message": f"chat.send.{stage}",
            "data": {
                "trace_id": str(trace_id or "")[:32],
                "stage": str(stage or "")[:64],
                "elapsed_ms": round(float(elapsed_ms), 1),
                **{
                    key: value
                    for key, value in fields.items()
                    if value is not None and key not in {"body", "token", "password", "title"}
                },
            },
            "timestamp": int(time.time() * 1000),
        }
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        try:
            _WRITE_QUEUE.put_nowait(line)
        except queue.Full:
            _DROPPED += 1
    except Exception:
        pass
