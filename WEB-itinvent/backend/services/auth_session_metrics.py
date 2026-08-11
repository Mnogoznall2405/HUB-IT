"""In-process counters for auth/session drop diagnosis."""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

_LOCK = threading.Lock()
_STARTED_AT = time.time()
_COUNTERS: dict[str, int] = {
    "session_expired_idle": 0,
    "session_expired_absolute": 0,
    "session_inactive_on_api": 0,
    "session_inactive_on_ws": 0,
    "refresh_success": 0,
    "refresh_grace_hit": 0,
    "refresh_invalid_token": 0,
    "refresh_revoked_jti": 0,
    "refresh_expired_or_already_used": 0,
    "refresh_session_inactive": 0,
    "refresh_other_error": 0,
    "websocket_4401_session_expired": 0,
    "client_auth_required": 0,
    "client_refresh_failed": 0,
}
_RECENT: deque[dict[str, Any]] = deque(maxlen=40)


def _utc_iso(ts: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts if ts is not None else time.time()))


def note(name: str, *, detail: str | None = None, **extra: Any) -> None:
    key = str(name or "").strip()
    if not key:
        return
    with _LOCK:
        if key not in _COUNTERS:
            _COUNTERS[key] = 0
        _COUNTERS[key] += 1
        event: dict[str, Any] = {
            "at": _utc_iso(),
            "name": key,
        }
        if detail:
            event["detail"] = str(detail)[:160]
        for field, value in extra.items():
            if value is None:
                continue
            text = str(value).strip()
            if text:
                event[field] = text[:80]
        _RECENT.appendleft(event)


def note_session_expired(status: str, *, network_zone: str | None = None) -> None:
    normalized = str(status or "").strip().lower()
    if normalized == "expired_idle":
        note("session_expired_idle", network_zone=network_zone)
    elif normalized == "expired_absolute":
        note("session_expired_absolute", network_zone=network_zone)


def snapshot() -> dict[str, Any]:
    with _LOCK:
        counters = dict(_COUNTERS)
        recent = list(_RECENT)
        started_at = _STARTED_AT
    return {
        "started_at": _utc_iso(started_at),
        "uptime_sec": round(max(0.0, time.time() - started_at), 1),
        "counters": counters,
        "recent": recent,
    }


def reset() -> None:
    global _STARTED_AT
    with _LOCK:
        for key in list(_COUNTERS.keys()):
            _COUNTERS[key] = 0
        _RECENT.clear()
        _STARTED_AT = time.time()
