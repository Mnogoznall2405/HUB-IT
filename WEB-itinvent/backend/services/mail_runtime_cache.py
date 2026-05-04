"""
Runtime cache and singleflight coordination for mail requests.

The cache stores only process-local response snapshots; it has no database or
Exchange dependency and is safe to exercise with unit tests.
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Event, RLock
from typing import Any, Callable


@dataclass
class RuntimeCacheEntry:
    bucket: str
    expires_at: datetime
    value: Any
    size_bytes: int = 0


@dataclass(frozen=True)
class RuntimeCachePolicy:
    max_entries: int
    ttl_sec: int
    max_total_bytes: int | None = None
    max_entry_bytes: int | None = None


@dataclass
class SingleflightCall:
    event: Event = field(default_factory=Event)
    result: Any = None
    error: Exception | None = None


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def cache_key(*, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
    normalized_extra = normalize_text(extra)
    normalized_scope = normalize_text(mailbox_scope, "global")
    return f"{int(user_id)}::{normalize_text(bucket)}::{normalized_scope}::{normalized_extra}"


def singleflight_key(*, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
    return f"singleflight::{cache_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)}"


def estimate_cache_value_size(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (bytes, bytearray)):
        return len(value)
    if isinstance(value, str):
        return len(value.encode("utf-8", "ignore"))
    if isinstance(value, bool):
        return 1
    if isinstance(value, (int, float)):
        return 8
    if isinstance(value, dict):
        return sum(estimate_cache_value_size(key) + estimate_cache_value_size(item) for key, item in value.items())
    if isinstance(value, (list, tuple, set, frozenset)):
        return sum(estimate_cache_value_size(item) for item in value)
    return len(repr(value).encode("utf-8", "ignore"))


class MailRuntimeCache:
    def __init__(self) -> None:
        self._lock = RLock()
        self._entries: OrderedDict[str, RuntimeCacheEntry] = OrderedDict()

    def _remove_locked(self, key: str) -> RuntimeCacheEntry | None:
        return self._entries.pop(key, None)

    def _prune_expired_locked(self, *, now: datetime | None = None) -> int:
        current_time = now or datetime.now(timezone.utc)
        removed = 0
        for key, entry in list(self._entries.items()):
            if entry.expires_at > current_time:
                continue
            self._remove_locked(key)
            removed += 1
        return removed

    def _bucket_stats_locked(self, bucket: str) -> tuple[int, int]:
        count = 0
        total_bytes = 0
        for entry in self._entries.values():
            if entry.bucket != bucket:
                continue
            count += 1
            total_bytes += max(0, int(entry.size_bytes or 0))
        return count, total_bytes

    def _enforce_policy_locked(self, bucket: str, policy: RuntimeCachePolicy) -> int:
        removed = 0
        count, total_bytes = self._bucket_stats_locked(bucket)
        while count > policy.max_entries or (
            policy.max_total_bytes is not None and total_bytes > policy.max_total_bytes
        ):
            removed_key = None
            removed_entry = None
            for key, entry in self._entries.items():
                if entry.bucket != bucket:
                    continue
                removed_key = key
                removed_entry = entry
                break
            if removed_key is None or removed_entry is None:
                break
            self._remove_locked(removed_key)
            removed += 1
            count -= 1
            total_bytes -= max(0, int(removed_entry.size_bytes or 0))
        return removed

    def get(self, key: str) -> Any:
        with self._lock:
            entry = self._entries.get(key)
            if not entry:
                return None
            if entry.expires_at <= datetime.now(timezone.utc):
                self._remove_locked(key)
                return None
            self._entries.move_to_end(key)
            return entry.value

    def set(self, key: str, *, bucket: str, value: Any, policy: RuntimeCachePolicy, ttl_sec: int | None = None) -> tuple[Any, int]:
        ttl = max(1, int(ttl_sec or policy.ttl_sec))
        entry_size = estimate_cache_value_size(value)
        if policy.max_entry_bytes is not None and entry_size > policy.max_entry_bytes:
            return value, 0
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=ttl)
        evicted = 0
        with self._lock:
            evicted += self._prune_expired_locked(now=now)
            if key in self._entries:
                self._remove_locked(key)
            self._entries[key] = RuntimeCacheEntry(
                bucket=bucket,
                expires_at=expires_at,
                value=value,
                size_bytes=entry_size,
            )
            self._entries.move_to_end(key)
            evicted += self._enforce_policy_locked(bucket, policy)
        return value, evicted

    def invalidate_user(self, *, user_id: int, prefixes: list[str] | tuple[str, ...] | None = None) -> None:
        normalized_prefixes = {normalize_text(prefix) for prefix in (prefixes or ()) if normalize_text(prefix)}
        if "message_detail" in normalized_prefixes:
            normalized_prefixes.add("attachment_content")
        user_prefix = f"{int(user_id)}::"
        with self._lock:
            keys_to_delete = []
            for key in list(self._entries.keys()):
                if not key.startswith(user_prefix):
                    continue
                if normalized_prefixes and not any(
                    key.startswith(f"{user_prefix}{prefix}::") for prefix in normalized_prefixes
                ):
                    continue
                keys_to_delete.append(key)
            for key in keys_to_delete:
                self._remove_locked(key)

    def update_dict_value(self, key: str, values: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)
        with self._lock:
            entry = self._entries.get(key)
            if not entry:
                return
            if entry.expires_at <= now:
                self._remove_locked(key)
                return
            if not isinstance(entry.value, dict):
                return
            next_value = dict(entry.value)
            next_value.update(values)
            entry.value = next_value
            self._entries.move_to_end(key)


class SingleflightGroup:
    def __init__(self) -> None:
        self._lock = RLock()
        self._calls: dict[str, SingleflightCall] = {}

    def run(self, *, key: str, producer: Callable[[], Any], on_hit: Callable[[int], None] | None = None) -> Any:
        with self._lock:
            call = self._calls.get(key)
            if call is None:
                call = SingleflightCall()
                self._calls[key] = call
                leader = True
                if on_hit:
                    on_hit(0)
            else:
                leader = False
                if on_hit:
                    on_hit(1)

        if not leader:
            call.event.wait()
            if call.error is not None:
                raise call.error
            return call.result

        try:
            call.result = producer()
            return call.result
        except Exception as exc:
            call.error = exc
            raise
        finally:
            call.event.set()
            with self._lock:
                if self._calls.get(key) is call:
                    self._calls.pop(key, None)
