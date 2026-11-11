from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Event, RLock
from typing import Any, Callable

_DEFAULT_TTL_SEC = 86400


def _cache_ttl_sec() -> int:
    raw = os.getenv("AD_PASSWORD_EXPIRY_CACHE_TTL_SEC", str(_DEFAULT_TTL_SEC))
    try:
        return max(60, int(raw))
    except (TypeError, ValueError):
        return _DEFAULT_TTL_SEC


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class CacheHit:
    value: Any
    cached_at: datetime
    cache_expires_at: datetime


@dataclass
class _CacheEntry:
    value: Any
    cached_at: datetime
    expires_at: datetime


@dataclass
class _SingleflightCall:
    event: Event = field(default_factory=Event)
    result: CacheHit | None = None
    error: Exception | None = None


class AdExpiryCache:
    def __init__(self) -> None:
        self._lock = RLock()
        self._report_entries: dict[str, _CacheEntry] = {}
        self._ou_entries: dict[str, _CacheEntry] = {}
        self._singleflight: dict[str, _SingleflightCall] = {}

    def _normalize_parent_dn(self, parent_dn: str | None) -> str:
        return str(parent_dn or "").strip()

    def build_report_key(self, *, ou_dn: str | None, mode: str, days_threshold: int) -> str:
        normalized_ou = str(ou_dn or "").strip()
        normalized_mode = str(mode or "all").strip().lower()
        return f"report::{normalized_ou}::{normalized_mode}::{int(days_threshold)}"

    def build_ou_key(self, parent_dn: str | None) -> str:
        return f"ou::{self._normalize_parent_dn(parent_dn)}"

    def _get_entry(self, bucket: dict[str, _CacheEntry], key: str) -> CacheHit | None:
        entry = bucket.get(key)
        if entry is None:
            return None
        now = _utc_now()
        if entry.expires_at <= now:
            bucket.pop(key, None)
            return None
        return CacheHit(
            value=entry.value,
            cached_at=entry.cached_at,
            cache_expires_at=entry.expires_at,
        )

    def _set_entry(self, bucket: dict[str, _CacheEntry], key: str, value: Any) -> CacheHit:
        now = _utc_now()
        ttl = _cache_ttl_sec()
        expires_at = now + timedelta(seconds=ttl)
        bucket[key] = _CacheEntry(value=value, cached_at=now, expires_at=expires_at)
        return CacheHit(value=value, cached_at=now, cache_expires_at=expires_at)

    def get_report_snapshot(self, key: str) -> CacheHit | None:
        with self._lock:
            return self._get_entry(self._report_entries, key)

    def set_report_snapshot(self, key: str, value: Any) -> CacheHit:
        with self._lock:
            return self._set_entry(self._report_entries, key, value)

    def get_ou_children(self, parent_dn: str | None) -> CacheHit | None:
        key = self.build_ou_key(parent_dn)
        with self._lock:
            return self._get_entry(self._ou_entries, key)

    def set_ou_children(self, parent_dn: str | None, items: list[dict[str, Any]]) -> CacheHit:
        key = self.build_ou_key(parent_dn)
        with self._lock:
            return self._set_entry(self._ou_entries, key, items)

    def invalidate_all(self) -> None:
        with self._lock:
            self._report_entries.clear()
            self._ou_entries.clear()

    def run_singleflight(self, key: str, loader: Callable[[], CacheHit]) -> CacheHit:
        with self._lock:
            existing = self._singleflight.get(key)
            if existing is not None:
                waiter = existing
                is_leader = False
            else:
                waiter = _SingleflightCall()
                self._singleflight[key] = waiter
                is_leader = True

        if not is_leader:
            waiter.event.wait()
            if waiter.error is not None:
                raise waiter.error
            if waiter.result is None:
                raise RuntimeError("AD expiry cache singleflight completed without result")
            return waiter.result

        try:
            result = loader()
            waiter.result = result
            return result
        except Exception as exc:
            waiter.error = exc
            raise
        finally:
            with self._lock:
                self._singleflight.pop(key, None)
            waiter.event.set()


ad_expiry_cache = AdExpiryCache()


def cache_metadata(hit: CacheHit, *, from_cache: bool) -> dict[str, Any]:
    return {
        "cached_at": _iso_utc(hit.cached_at),
        "cache_expires_at": _iso_utc(hit.cache_expires_at),
        "from_cache": from_cache,
    }
