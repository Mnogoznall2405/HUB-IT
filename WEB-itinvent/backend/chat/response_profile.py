"""Measure payload dump / JSON serialization cost for Chat HTTP reads."""
from __future__ import annotations

import json
import time
from typing import Any


def measure_payload_serialization(payload: Any, *, items_hint: int | None = None) -> dict[str, Any]:
    """CPU-bound measurement (call from request path when profiling is on).

    Stages:
      payload_build  — model_dump / dict conversion
      serialization  — json.dumps
    """
    started = time.perf_counter()
    dumped: Any
    if hasattr(payload, "model_dump"):
        dumped = payload.model_dump()
    elif hasattr(payload, "dict"):
        dumped = payload.dict()
    else:
        dumped = payload
    build_ms = (time.perf_counter() - started) * 1000.0

    ser_started = time.perf_counter()
    try:
        encoded = json.dumps(dumped, ensure_ascii=False, separators=(",", ":"), default=str)
    except Exception:
        encoded = ""
    ser_ms = (time.perf_counter() - ser_started) * 1000.0

    items_count = items_hint
    if items_count is None:
        if isinstance(dumped, dict):
            for key in ("items", "messages", "conversations"):
                if isinstance(dumped.get(key), list):
                    items_count = len(dumped[key])
                    break
        elif isinstance(dumped, list):
            items_count = len(dumped)

    return {
        "payload_build_ms": round(build_ms, 2),
        "serialization_ms": round(ser_ms, 2),
        "json_bytes": len(encoded.encode("utf-8")) if encoded else 0,
        "items_count": int(items_count or 0),
    }


def maybe_profile_read_response(
    *,
    route: str,
    request_id: str,
    db_ms: float,
    handler_ms: float,
    payload: Any,
    items_hint: int | None = None,
) -> dict[str, Any]:
    """Emit audit stages when CHAT_PROFILE_SERIALIZATION is enabled (default on for chat)."""
    import os

    enabled = str(os.getenv("CHAT_PROFILE_SERIALIZATION", "1") or "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not enabled:
        return {}
    stages = measure_payload_serialization(payload, items_hint=items_hint)
    try:
        from backend.chat.latency_profile import profile_trace

        profile_trace(
            request_id or "read",
            "http_read_breakdown",
            float(handler_ms),
            route=route,
            db_ms=round(float(db_ms), 2),
            payload_build_ms=stages["payload_build_ms"],
            serialization_ms=stages["serialization_ms"],
            json_bytes=stages["json_bytes"],
            items_count=stages["items_count"],
            unaccounted_ms=round(
                max(
                    0.0,
                    float(handler_ms)
                    - float(db_ms)
                    - float(stages["payload_build_ms"])
                    - float(stages["serialization_ms"]),
                ),
                2,
            ),
        )
    except Exception:
        pass
    return stages
