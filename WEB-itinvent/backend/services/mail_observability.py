"""In-process mail SLI samples for MAIL-AUDIT-020.

No mailbox_id / user_id / email labels. No invented SLO targets.
Rollback: MAIL_METRICS_EXPORT=0 (recording and export become a disabled stub).
"""
from __future__ import annotations

import logging
import os
import threading
from collections import deque
from typing import Any

logger = logging.getLogger(__name__)

_TRUE = frozenset({"1", "true", "yes", "on"})
_FALSE = frozenset({"0", "false", "no", "off"})
_SAMPLE_SIZE = 200
_MAX_OPS = 32

ALLOWED_OPS = frozenset({
    "bootstrap",
    "list",
    "detail",
    "conversations",
    "conversation_detail",
    "send",
    "download",
    "preview",
    "summarize",
    "smart_replies",
    "mailboxes",
    "contacts",
    "unread",
    "folders",
    "folder_summary",
    "move",
    "delete",
    "other",
})

_FUNC_OP = {
    "get_bootstrap": "bootstrap",
    "_list_messages_payload": "list",
    "list_messages": "list",
    "get_message": "detail",
    "list_conversations": "conversations",
    "get_conversation": "conversation_detail",
    "send_message": "send",
    "download_attachment": "download",
    "get_attachment_preview": "preview",
    "summarize_message": "summarize",
    "smart_replies_for_message": "smart_replies",
    "list_user_mailboxes": "mailboxes",
    "search_contacts": "contacts",
    "get_unread_count": "unread",
    "get_folder_tree": "folders",
    "get_folder_summary": "folder_summary",
    "move_message": "move",
    "delete_message": "delete",
}

ALLOWED_SEND_STATES = frozenset({
    "sent",
    "failed",
    "timeout",
    "unknown",
    "in_flight",
    "conflict",
})

ALLOWED_SOURCES = frozenset({"snapshot", "exchange", "unknown"})

_ERROR_SEND_STATE = {
    "MAIL_SEND_TIMEOUT": "timeout",
    "MAIL_SEND_UNKNOWN": "unknown",
    "MAIL_SEND_IN_FLIGHT": "in_flight",
    "MAIL_IDEMPOTENCY_CONFLICT": "conflict",
}

_lock = threading.Lock()
_ops: dict[str, dict[str, Any]] = {}
_source_counts = {"snapshot": 0, "exchange": 0, "unknown": 0}
_send_states = {name: 0 for name in sorted(ALLOWED_SEND_STATES)}
_attachment_bytes: deque[int] = deque(maxlen=_SAMPLE_SIZE)
_create_account_ms: deque[float] = deque(maxlen=_SAMPLE_SIZE)
_protocol_cache = {"hits": 0, "misses": 0, "errors": 0, "last_size": 0}
_cancelled_wait = 0


def mail_metrics_export_enabled(raw: Any | None = None) -> bool:
    value = os.getenv("MAIL_METRICS_EXPORT") if raw is None else raw
    if value is None:
        return True
    text = str(value).strip().lower()
    if not text:
        return True
    if text in _FALSE:
        return False
    if text in _TRUE:
        return True
    logger.warning("MAIL_METRICS_EXPORT has unrecognized value %r; treating as disabled", text)
    return False


def mail_op_name(func: Any) -> str:
    raw = str(getattr(func, "__name__", "") or "").strip()
    mapped = _FUNC_OP.get(raw, "other")
    return mapped if mapped in ALLOWED_OPS else "other"


def send_state_from_error_code(code: Any) -> str:
    text = str(code or "").strip()
    return _ERROR_SEND_STATE.get(text, "failed")


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(item) for item in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = max(0.0, min(1.0, float(percentile) / 100.0)) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def _bucket(op: str) -> dict[str, Any]:
    name = op if op in ALLOWED_OPS else "other"
    bucket = _ops.get(name)
    if bucket is None:
        if len(_ops) >= _MAX_OPS and name not in _ops:
            name = "other"
            bucket = _ops.get(name)
        if bucket is None:
            bucket = {
                "count": 0,
                "error_count": 0,
                "cache_hits": 0,
                "cache_misses": 0,
                "singleflight_hits": 0,
                "account_reused": 0,
                "account_created": 0,
                "semaphore_wait_ms": deque(maxlen=_SAMPLE_SIZE),
                "executor_wait_ms": deque(maxlen=_SAMPLE_SIZE),
                "call_ms": deque(maxlen=_SAMPLE_SIZE),
            }
            _ops[name] = bucket
    return bucket


def record_mail_call(
    *,
    op: str,
    semaphore_wait_ms: float,
    executor_wait_ms: float,
    call_ms: float,
    metrics: dict[str, Any] | None = None,
    error: bool = False,
) -> None:
    if not mail_metrics_export_enabled():
        return
    payload = metrics or {}
    with _lock:
        bucket = _bucket(op)
        bucket["count"] += 1
        if error:
            bucket["error_count"] += 1
        bucket["semaphore_wait_ms"].append(max(0.0, float(semaphore_wait_ms)))
        bucket["executor_wait_ms"].append(max(0.0, float(executor_wait_ms)))
        bucket["call_ms"].append(max(0.0, float(call_ms)))
        if payload.get("cache_hit") in (1, True):
            bucket["cache_hits"] += 1
        elif payload.get("cache_hit") in (0, False):
            bucket["cache_misses"] += 1
        if payload.get("singleflight_hit") in (1, True):
            bucket["singleflight_hits"] += 1
        if payload.get("account_reused") in (1, True):
            bucket["account_reused"] += 1
        elif payload.get("account_reused") in (0, False):
            bucket["account_created"] += 1


def record_mail_source(source: str) -> None:
    if not mail_metrics_export_enabled():
        return
    resolved = str(source or "").strip().lower()
    if resolved in {"app_snapshot", "stale", "snapshot"}:
        resolved = "snapshot"
    elif resolved in {"exchange", "live"}:
        resolved = "exchange"
    else:
        resolved = "unknown"
    with _lock:
        _source_counts[resolved] = int(_source_counts.get(resolved, 0)) + 1


def record_mail_send_state(state: str) -> None:
    if not mail_metrics_export_enabled():
        return
    resolved = str(state or "").strip().lower()
    if resolved not in ALLOWED_SEND_STATES:
        resolved = "failed"
    with _lock:
        _send_states[resolved] = int(_send_states.get(resolved, 0)) + 1


def record_mail_attachment_bytes(size: int) -> None:
    if not mail_metrics_export_enabled():
        return
    with _lock:
        _attachment_bytes.append(max(0, int(size or 0)))


def record_mail_create_account_ms(duration_ms: float) -> None:
    if not mail_metrics_export_enabled():
        return
    with _lock:
        _create_account_ms.append(max(0.0, float(duration_ms)))


def record_mail_cancelled_wait() -> None:
    """Client aborted the await; the EWS worker thread is not cancelled (MAIL-AUDIT-025)."""
    if not mail_metrics_export_enabled():
        return
    global _cancelled_wait
    with _lock:
        _cancelled_wait += 1


def record_mail_protocol_cache(*, hit: bool, errored: bool = False, size: int = 0) -> None:
    """Count CachingProtocol reuse. No endpoint, credentials, mailbox, or user labels."""
    if not mail_metrics_export_enabled():
        return
    with _lock:
        _protocol_cache["last_size"] = max(0, int(size or 0))
        if errored:
            _protocol_cache["errors"] += 1
            _protocol_cache["misses"] += 1
            return
        if hit:
            _protocol_cache["hits"] += 1
            return
        _protocol_cache["misses"] += 1


def reset_mail_observability() -> None:
    global _cancelled_wait
    with _lock:
        _ops.clear()
        for key in list(_source_counts):
            _source_counts[key] = 0
        for key in list(_send_states):
            _send_states[key] = 0
        _attachment_bytes.clear()
        _create_account_ms.clear()
        for key in list(_protocol_cache):
            _protocol_cache[key] = 0
        _cancelled_wait = 0


def mail_observability_snapshot() -> dict[str, Any]:
    if not mail_metrics_export_enabled():
        return {"enabled": False}
    with _lock:
        ops_out: dict[str, Any] = {}
        for name, bucket in sorted(_ops.items()):
            semaphore = list(bucket["semaphore_wait_ms"])
            executor = list(bucket["executor_wait_ms"])
            call = list(bucket["call_ms"])
            cache_total = int(bucket["cache_hits"]) + int(bucket["cache_misses"])
            ops_out[name] = {
                "count": int(bucket["count"]),
                "error_count": int(bucket["error_count"]),
                "cache_hits": int(bucket["cache_hits"]),
                "cache_misses": int(bucket["cache_misses"]),
                "cache_hit_rate": round((int(bucket["cache_hits"]) / cache_total), 4) if cache_total else 0.0,
                "singleflight_hits": int(bucket["singleflight_hits"]),
                "account_reused": int(bucket["account_reused"]),
                "account_created": int(bucket["account_created"]),
                "semaphore_wait": {
                    "p50_ms": round(_percentile(semaphore, 50), 1),
                    "p95_ms": round(_percentile(semaphore, 95), 1),
                    "max_ms": round(max(semaphore), 1) if semaphore else 0.0,
                },
                "executor_wait": {
                    "p50_ms": round(_percentile(executor, 50), 1),
                    "p95_ms": round(_percentile(executor, 95), 1),
                    "max_ms": round(max(executor), 1) if executor else 0.0,
                },
                "call": {
                    "p50_ms": round(_percentile(call, 50), 1),
                    "p95_ms": round(_percentile(call, 95), 1),
                    "max_ms": round(max(call), 1) if call else 0.0,
                },
            }
        source_counts = dict(_source_counts)
        send_states = dict(_send_states)
        attachment_samples = [float(item) for item in _attachment_bytes]
        create_samples = list(_create_account_ms)
        protocol_cache = dict(_protocol_cache)
        cancelled_wait = int(_cancelled_wait)

    extras: dict[str, Any] = {}
    try:
        from backend.services.mail_send_timeouts import mail_send_timeout_metrics
        extras["send_timeouts"] = mail_send_timeout_metrics()
    except Exception as exc:
        extras["send_timeouts"] = {"error": type(exc).__name__}
    try:
        from backend.services.mail_send_idempotency import mail_send_idempotency_metrics
        extras["idempotency"] = mail_send_idempotency_metrics()
    except Exception as exc:
        extras["idempotency"] = {"error": type(exc).__name__}
    try:
        from backend.services.mail_ai_privacy import mail_ai_privacy_metrics
        extras["ai"] = mail_ai_privacy_metrics()
    except Exception as exc:
        extras["ai"] = {"error": type(exc).__name__}

    return {
        "enabled": True,
        "ops": ops_out,
        "source": source_counts,
        "send_state": send_states,
        "attachment_bytes": {
            "count": len(attachment_samples),
            "p50": round(_percentile(attachment_samples, 50), 1),
            "p95": round(_percentile(attachment_samples, 95), 1),
            "max": round(max(attachment_samples), 1) if attachment_samples else 0.0,
        },
        "create_account": {
            "count": len(create_samples),
            "p50_ms": round(_percentile(create_samples, 50), 1),
            "p95_ms": round(_percentile(create_samples, 95), 1),
            "max_ms": round(max(create_samples), 1) if create_samples else 0.0,
        },
        "cancelled_wait": cancelled_wait,
        "protocol_cache": {
            "hits": int(protocol_cache.get("hits") or 0),
            "misses": int(protocol_cache.get("misses") or 0),
            "errors": int(protocol_cache.get("errors") or 0),
            "last_size": int(protocol_cache.get("last_size") or 0),
            "hit_rate": (
                round(
                    int(protocol_cache.get("hits") or 0)
                    / (
                        int(protocol_cache.get("hits") or 0)
                        + int(protocol_cache.get("misses") or 0)
                    ),
                    4,
                )
                if (int(protocol_cache.get("hits") or 0) + int(protocol_cache.get("misses") or 0))
                else 0.0
            ),
        },
        **extras,
    }
