"""Very short in-process cache for hot per-request auth checks.

Every authenticated request used to ask the app database two more questions that almost never
change (is this token revoked? is this trusted device still valid?), each a round trip to a remote
PostgreSQL through a small pool. The answer is remembered for a few seconds only:

* only the *allowing* answer is cached (token not revoked / device valid);
* a revocation made by this process invalidates the entry at once;
* a revocation made by another process (the other chat node, the main backend) takes effect after
  at most ``AUTH_REVOCATION_CACHE_TTL_SEC`` seconds (default 3, ``0`` disables the cache).
"""
from __future__ import annotations

import os
import threading
import time

_DEFAULT_TTL_SEC = 3.0
_MAX_TTL_SEC = 30.0
_MAX_ENTRIES = 4096


def revocation_cache_ttl_sec() -> float:
    raw = os.getenv("AUTH_REVOCATION_CACHE_TTL_SEC", "")
    try:
        value = float(raw) if str(raw).strip() else _DEFAULT_TTL_SEC
    except ValueError:
        value = _DEFAULT_TTL_SEC
    return max(0.0, min(_MAX_TTL_SEC, value))


class AllowCache:
    """Remembers "this key is allowed" for a short, fixed time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._expires: dict[object, float] = {}

    def is_allowed(self, key: object) -> bool:
        with self._lock:
            expires_at = self._expires.get(key)
            if expires_at is None:
                return False
            if expires_at <= time.monotonic():
                self._expires.pop(key, None)
                return False
            return True

    def remember(self, key: object) -> None:
        ttl = revocation_cache_ttl_sec()
        if ttl <= 0:
            return
        with self._lock:
            if len(self._expires) >= _MAX_ENTRIES:
                now = time.monotonic()
                self._expires = {k: v for k, v in self._expires.items() if v > now}
                if len(self._expires) >= _MAX_ENTRIES:
                    self._expires.clear()
            self._expires[key] = time.monotonic() + ttl

    def forget(self, key: object) -> None:
        with self._lock:
            self._expires.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._expires.clear()
