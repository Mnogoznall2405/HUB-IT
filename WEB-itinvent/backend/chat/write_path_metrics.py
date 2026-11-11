"""Write-path stage histograms and correlation helpers for chat send SLO."""
from __future__ import annotations

import contextvars
import math
import threading
import time
from collections import defaultdict
from typing import Any

_STAGE_SAMPLES: dict[str, list[float]] = defaultdict(list)
_STAGE_LOCK = threading.Lock()
_MAX_SAMPLES = 2_000

# Context for measuring DB pool wait (timestamp before connection request).
_db_checkout_started: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "chat_db_checkout_started", default=None
)
_db_pool_class: contextvars.ContextVar[str] = contextvars.ContextVar(
    "chat_db_pool_class", default="legacy"
)
_send_trace_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "chat_send_trace_id", default=""
)

# Session class counters (write / read / legacy)
_SESSION_COUNTERS: dict[str, int] = {"write": 0, "read": 0, "legacy": 0}
_SESSION_COUNTER_LOCK = threading.Lock()

# Critical / background queue gauges
_CRITICAL_QUEUE_DEPTH = 0
_CRITICAL_QUEUE_DROPS = 0
_CRITICAL_OLDEST_ENQUEUED_AT: float | None = None
_BACKGROUND_QUEUE_DEPTH = 0
_BACKGROUND_OLDEST_ENQUEUED_AT: float | None = None
_QUEUE_GAUGE_LOCK = threading.Lock()

_OUTBOX_ENQUEUE_FAILED = 0
_OUTBOX_REPAIRED = 0
_OUTBOX_METRIC_LOCK = threading.Lock()


def set_send_trace_id(trace_id: str) -> contextvars.Token:
    """Bind send audit trace to the current context; always reset via returned Token."""
    return _send_trace_id.set(str(trace_id or "")[:32])


def reset_send_trace_id(token: contextvars.Token) -> None:
    try:
        _send_trace_id.reset(token)
    except Exception:
        try:
            _send_trace_id.set("")
        except Exception:
            pass


def get_send_trace_id() -> str:
    return str(_send_trace_id.get() or "")


def mark_send_stage(
    stage: str,
    *,
    started_at: float | None = None,
    finished_at: float | None = None,
    **fields: Any,
) -> float:
    """Record a discrete send stage with monotonic duration + wall-clock for correlation."""
    end = float(finished_at if finished_at is not None else time.perf_counter())
    elapsed_ms = 0.0
    if started_at is not None:
        elapsed_ms = max(0.0, (end - float(started_at)) * 1000.0)
    record_stage(
        stage,
        elapsed_ms,
        wall_ts_ms=int(time.time() * 1000),
        **fields,
    )
    return end


def mark_db_checkout_wait_start() -> None:
    _db_checkout_started.set(time.perf_counter())


def take_db_checkout_wait_ms() -> float | None:
    started = _db_checkout_started.get()
    _db_checkout_started.set(None)
    if started is None:
        return None
    return max(0.0, (time.perf_counter() - started) * 1000.0)


def set_db_pool_class(pool_class: str) -> None:
    _db_pool_class.set(str(pool_class or "legacy"))


def get_db_pool_class() -> str:
    return str(_db_pool_class.get() or "legacy")


def note_session_open(session_class: str, *, caller: str | None = None) -> None:
    key = str(session_class or "legacy")
    if key not in _SESSION_COUNTERS:
        key = "legacy"
    with _SESSION_COUNTER_LOCK:
        _SESSION_COUNTERS[key] = int(_SESSION_COUNTERS.get(key) or 0) + 1
    if key == "legacy" and caller:
        try:
            from backend.chat.send_audit import audit_send_trace

            audit_send_trace(
                trace_id="legacy_session",
                stage="chat_db_session_legacy",
                elapsed_ms=0.0,
                caller=str(caller)[:120],
            )
        except Exception:
            pass


def session_counters_snapshot() -> dict[str, int]:
    with _SESSION_COUNTER_LOCK:
        return {k: int(v) for k, v in _SESSION_COUNTERS.items()}


def record_stage(stage: str, elapsed_ms: float, *, trace_id: str | None = None, **fields: Any) -> None:
    name = str(stage or "").strip()[:80]
    if not name:
        return
    value = float(elapsed_ms)
    with _STAGE_LOCK:
        bucket = _STAGE_SAMPLES[name]
        bucket.append(value)
        if len(bucket) > _MAX_SAMPLES:
            del bucket[: len(bucket) - _MAX_SAMPLES]
    try:
        from backend.chat.send_audit import audit_send_trace

        audit_send_trace(
            trace_id=str(trace_id or get_send_trace_id() or "stage")[:32],
            stage=name,
            elapsed_ms=value,
            **fields,
        )
    except Exception:
        pass


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * (p / 100.0)
    low = int(math.floor(rank))
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return float(ordered[low] * (1.0 - frac) + ordered[high] * frac)


def stage_histogram_snapshot(*, clear: bool = False) -> dict[str, dict[str, Any]]:
    with _STAGE_LOCK:
        items = {k: list(v) for k, v in _STAGE_SAMPLES.items()}
        if clear:
            _STAGE_SAMPLES.clear()
    out: dict[str, dict[str, Any]] = {}
    for name, values in sorted(items.items()):
        if not values:
            continue
        out[name] = {
            "n": len(values),
            "p50": _percentile(values, 50),
            "p95": _percentile(values, 95),
            "p99": _percentile(values, 99),
            "max": max(values),
        }
    return out


def critical_queue_enter() -> None:
    global _CRITICAL_QUEUE_DEPTH, _CRITICAL_OLDEST_ENQUEUED_AT
    now = time.perf_counter()
    with _QUEUE_GAUGE_LOCK:
        _CRITICAL_QUEUE_DEPTH += 1
        if _CRITICAL_OLDEST_ENQUEUED_AT is None:
            _CRITICAL_OLDEST_ENQUEUED_AT = now


def critical_queue_leave() -> None:
    global _CRITICAL_QUEUE_DEPTH, _CRITICAL_OLDEST_ENQUEUED_AT
    with _QUEUE_GAUGE_LOCK:
        _CRITICAL_QUEUE_DEPTH = max(0, _CRITICAL_QUEUE_DEPTH - 1)
        if _CRITICAL_QUEUE_DEPTH == 0:
            _CRITICAL_OLDEST_ENQUEUED_AT = None


def note_critical_queue_drop() -> None:
    """Must stay at 0 for SLO; call only if a drop somehow occurs (should not)."""
    global _CRITICAL_QUEUE_DROPS
    with _QUEUE_GAUGE_LOCK:
        _CRITICAL_QUEUE_DROPS += 1


def background_queue_enter() -> None:
    global _BACKGROUND_QUEUE_DEPTH, _BACKGROUND_OLDEST_ENQUEUED_AT
    now = time.perf_counter()
    with _QUEUE_GAUGE_LOCK:
        _BACKGROUND_QUEUE_DEPTH += 1
        if _BACKGROUND_OLDEST_ENQUEUED_AT is None:
            _BACKGROUND_OLDEST_ENQUEUED_AT = now


def background_queue_leave() -> None:
    global _BACKGROUND_QUEUE_DEPTH, _BACKGROUND_OLDEST_ENQUEUED_AT
    with _QUEUE_GAUGE_LOCK:
        _BACKGROUND_QUEUE_DEPTH = max(0, _BACKGROUND_QUEUE_DEPTH - 1)
        if _BACKGROUND_QUEUE_DEPTH == 0:
            _BACKGROUND_OLDEST_ENQUEUED_AT = None


def note_outbox_enqueue_failed() -> None:
    global _OUTBOX_ENQUEUE_FAILED
    with _OUTBOX_METRIC_LOCK:
        _OUTBOX_ENQUEUE_FAILED += 1


def note_outbox_repaired(count: int = 1) -> None:
    global _OUTBOX_REPAIRED
    with _OUTBOX_METRIC_LOCK:
        _OUTBOX_REPAIRED += max(0, int(count))


def outbox_metrics_snapshot() -> dict[str, int]:
    with _OUTBOX_METRIC_LOCK:
        return {
            "outbox_enqueue_failed": int(_OUTBOX_ENQUEUE_FAILED),
            "outbox_repaired": int(_OUTBOX_REPAIRED),
        }


def queue_gauges_snapshot() -> dict[str, Any]:
    now = time.perf_counter()
    with _QUEUE_GAUGE_LOCK:
        critical_age = None
        if _CRITICAL_OLDEST_ENQUEUED_AT is not None:
            critical_age = max(0.0, (now - _CRITICAL_OLDEST_ENQUEUED_AT) * 1000.0)
        background_age = None
        if _BACKGROUND_OLDEST_ENQUEUED_AT is not None:
            background_age = max(0.0, (now - _BACKGROUND_OLDEST_ENQUEUED_AT) * 1000.0)
        gauges = {
            "critical_queue_depth": int(_CRITICAL_QUEUE_DEPTH),
            "critical_queue_drop": int(_CRITICAL_QUEUE_DROPS),
            "critical_queue_age_ms": critical_age,
            "background_queue_depth": int(_BACKGROUND_QUEUE_DEPTH),
            "background_queue_age_ms": background_age,
        }
    gauges.update(outbox_metrics_snapshot())
    return gauges
