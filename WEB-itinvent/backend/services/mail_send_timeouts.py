"""Mail send timeout budgets for MAIL-AUDIT-005B.

IIS ARR /api/* is 120s. Backend wait_for stays shorter so FastAPI can return
MAIL_SEND_TIMEOUT before the proxy drops the connection. exchangelib stays 120s;
the executor thread is not cancelled when wait_for fires.
"""
from __future__ import annotations

import logging
import os
import threading
from collections import deque
from typing import Any

logger = logging.getLogger(__name__)

IIS_ARR_TIMEOUT_SEC = 120
EXCHANGELIB_TIMEOUT_SEC = 120
DEFAULT_SEND_WAIT_FOR_SEC = 110.0
MAX_SEND_WAIT_FOR_SEC = 115.0
MIN_SEND_WAIT_FOR_SEC = 0.05

_metrics_lock = threading.Lock()
_METRICS = {
    "ambiguous_send": 0,
    "send_count": 0,
}
_SEND_SAMPLES_MS: deque[float] = deque(maxlen=200)


def mail_send_wait_for_sec(raw: Any | None = None) -> float:
    value = os.getenv("MAIL_SEND_WAIT_FOR_SEC") if raw is None else raw
    text = str(value or "").strip()
    if not text:
        return DEFAULT_SEND_WAIT_FOR_SEC
    try:
        parsed = float(text)
    except (TypeError, ValueError):
        logger.warning(
            "MAIL_SEND_WAIT_FOR_SEC=%r is invalid; using %s",
            text,
            DEFAULT_SEND_WAIT_FOR_SEC,
        )
        return DEFAULT_SEND_WAIT_FOR_SEC
    if parsed > MAX_SEND_WAIT_FOR_SEC:
        logger.warning(
            "MAIL_SEND_WAIT_FOR_SEC=%s exceeds IIS budget; clamping to %s",
            parsed,
            MAX_SEND_WAIT_FOR_SEC,
        )
        return MAX_SEND_WAIT_FOR_SEC
    if parsed < MIN_SEND_WAIT_FOR_SEC:
        logger.warning(
            "MAIL_SEND_WAIT_FOR_SEC=%s is too small; using %s",
            parsed,
            MIN_SEND_WAIT_FOR_SEC,
        )
        return MIN_SEND_WAIT_FOR_SEC
    return parsed


def reset_mail_send_timeout_metrics() -> None:
    with _metrics_lock:
        _METRICS["ambiguous_send"] = 0
        _METRICS["send_count"] = 0
        _SEND_SAMPLES_MS.clear()


def increment_ambiguous_send() -> None:
    with _metrics_lock:
        _METRICS["ambiguous_send"] += 1
    logger.info("mail.send event=ambiguous_send")


def record_mail_send_timing(duration_ms: float) -> None:
    elapsed = max(0.0, float(duration_ms))
    with _metrics_lock:
        _METRICS["send_count"] += 1
        _SEND_SAMPLES_MS.append(elapsed)


def mail_send_timeout_metrics() -> dict[str, float | int]:
    with _metrics_lock:
        samples = list(_SEND_SAMPLES_MS)
        send_count = int(_METRICS["send_count"])
        ambiguous = int(_METRICS["ambiguous_send"])
    p95 = 0.0
    if samples:
        ordered = sorted(samples)
        rank = 0.95 * (len(ordered) - 1)
        lower = int(rank)
        upper = min(lower + 1, len(ordered) - 1)
        if lower == upper:
            p95 = ordered[lower]
        else:
            weight = rank - lower
            p95 = ordered[lower] + (ordered[upper] - ordered[lower]) * weight
    rate = (ambiguous / send_count) if send_count else 0.0
    return {
        "ambiguous_send": ambiguous,
        "send_count": send_count,
        "ambiguous_send_rate": rate,
        "send_p95_ms": p95,
    }
