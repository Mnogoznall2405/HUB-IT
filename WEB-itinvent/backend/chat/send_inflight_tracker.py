"""In-flight send diagnostics for lock-convoy detection (audit/log only, no Prom labels)."""
from __future__ import annotations

import threading
import time
from collections import Counter
from typing import Any

_LOCK = threading.Lock()
_INFLIGHT: dict[str, dict[str, Any]] = {}
_QUEUED: dict[str, dict[str, Any]] = {}
_MAX_TRACKED = 500


def note_send_queued(*, trace_id: str, conversation_id: str = "", job_type: str = "send") -> None:
    tid = str(trace_id or "").strip()[:32]
    if not tid:
        return
    with _LOCK:
        if len(_QUEUED) >= _MAX_TRACKED:
            return
        _QUEUED[tid] = {
            "trace_id": tid,
            "conversation_id": str(conversation_id or "")[:64],
            "job_type": str(job_type or "send")[:32],
            "queued_at": time.perf_counter(),
            "queued_wall_ts_ms": int(time.time() * 1000),
            "current_stage": "queued",
        }


def note_send_started(*, trace_id: str, conversation_id: str = "") -> None:
    tid = str(trace_id or "").strip()[:32]
    if not tid:
        return
    now = time.perf_counter()
    with _LOCK:
        queued = _QUEUED.pop(tid, None) or {}
        if len(_INFLIGHT) >= _MAX_TRACKED:
            return
        _INFLIGHT[tid] = {
            "trace_id": tid,
            "conversation_id": str(conversation_id or queued.get("conversation_id") or "")[:64],
            "job_type": str(queued.get("job_type") or "send")[:32],
            "queued_at": float(queued.get("queued_at") or now),
            "started_at": now,
            "queued_wall_ts_ms": queued.get("queued_wall_ts_ms"),
            "started_wall_ts_ms": int(time.time() * 1000),
            "current_stage": "started",
            "db_checkout_wait_ms": None,
            "seq_update_elapsed_ms": None,
        }


def note_send_stage(*, trace_id: str, stage: str, **fields: Any) -> None:
    tid = str(trace_id or "").strip()[:32]
    if not tid:
        return
    with _LOCK:
        row = _INFLIGHT.get(tid) or _QUEUED.get(tid)
        if not row:
            return
        row["current_stage"] = str(stage or "")[:64]
        for key in ("db_checkout_wait_ms", "seq_update_elapsed_ms", "conversation_id"):
            if key in fields and fields[key] is not None:
                row[key] = fields[key]


def note_send_finished(*, trace_id: str) -> None:
    tid = str(trace_id or "").strip()[:32]
    if not tid:
        return
    with _LOCK:
        _INFLIGHT.pop(tid, None)
        _QUEUED.pop(tid, None)


def lock_convoy_snapshot(*, top_n: int = 10) -> dict[str, Any]:
    with _LOCK:
        queued = list(_QUEUED.values())
        active = list(_INFLIGHT.values())
    now = time.perf_counter()
    active_convos = [str(r.get("conversation_id") or "") for r in active if r.get("conversation_id")]
    queued_convos = [str(r.get("conversation_id") or "") for r in queued if r.get("conversation_id")]
    active_counts = Counter(active_convos)
    queued_counts = Counter(queued_convos)
    unique_active = len({c for c in active_convos if c})
    active_sends = len(active)
    ratio = (float(active_sends) / float(unique_active)) if unique_active else float(active_sends)

    def _top(counter: Counter[str]) -> list[dict[str, Any]]:
        return [
            {"conversation_id": cid[:64], "count": int(count)}
            for cid, count in counter.most_common(max(1, int(top_n)))
            if cid
        ]

    active_detail = []
    for row in sorted(active, key=lambda r: float(r.get("started_at") or 0.0))[: max(1, int(top_n))]:
        active_detail.append(
            {
                "trace_id": row.get("trace_id"),
                "conversation_id": row.get("conversation_id"),
                "current_stage": row.get("current_stage"),
                "queued_age_ms": round(max(0.0, (now - float(row.get("queued_at") or now)) * 1000.0), 1),
                "running_ms": round(max(0.0, (now - float(row.get("started_at") or now)) * 1000.0), 1),
                "db_checkout_wait_ms": row.get("db_checkout_wait_ms"),
                "seq_update_elapsed_ms": row.get("seq_update_elapsed_ms"),
            }
        )

    return {
        "queued_sends": len(queued),
        "active_sends": active_sends,
        "unique_active_conversations": unique_active,
        "active_send_per_conversation": round(ratio, 2),
        "max_queued_sends_per_conversation": int(max(queued_counts.values()) if queued_counts else 0),
        "top_conversations_by_queue_depth": _top(queued_counts),
        "top_conversations_by_active": _top(active_counts),
        "active_detail": active_detail,
    }
