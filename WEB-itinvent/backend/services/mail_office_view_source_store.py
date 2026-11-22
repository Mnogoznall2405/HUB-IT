"""Short-lived in-memory store that serves prefetched attachment bytes to Document Server.

``/mail/office-source`` is fetched by Document Server without the user's web
session, so mailbox credentials (including ``primary_session`` auth) are
unavailable there. The authenticated ``office-view`` endpoint therefore
downloads the attachment once under the user's session and parks the bytes
here, keyed by the digest of the signed source token: the anonymous fetch
presents the token, we hand back the parked bytes — no user secrets involved.
"""
from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass


def _positive_int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 1 << 30) -> int:
    try:
        value = int(str(os.getenv(name, "") or "").strip() or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def max_source_entries() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_ENTRIES", 32)


def max_source_total_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES", 256 * 1024 * 1024, maximum=1 << 30)


def max_source_entry_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_ENTRY_BYTES", 64 * 1024 * 1024, maximum=1 << 30)


@dataclass
class OfficeViewSourceEntry:
    filename: str
    content_type: str
    content: bytes


@dataclass
class _Record:
    expires_at: float
    entry: OfficeViewSourceEntry


class OfficeViewSourceStore:
    """Bounded LRU of token-digest → attachment bytes, expiring with the token."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: OrderedDict[str, _Record] = OrderedDict()
        self._total_bytes = 0

    def _drop_expired_locked(self, now: float) -> None:
        stale = [key for key, record in self._records.items() if record.expires_at <= now]
        for key in stale:
            self._total_bytes -= len(self._records[key].entry.content)
            del self._records[key]

    def put(
        self,
        key: str,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        ttl_sec: int,
    ) -> bool:
        """Park bytes under ``key``; returns False when the entry exceeds the size cap."""
        size = len(content or b"")
        if size > max_source_entry_bytes() or size > max_source_total_bytes():
            return False
        now = time.monotonic()
        with self._lock:
            self._drop_expired_locked(now)
            previous = self._records.pop(key, None)
            if previous is not None:
                self._total_bytes -= len(previous.entry.content)
            while (
                self._records
                and (
                    len(self._records) >= max_source_entries()
                    or self._total_bytes + size > max_source_total_bytes()
                )
            ):
                _oldest_key, oldest = self._records.popitem(last=False)
                self._total_bytes -= len(oldest.entry.content)
            self._records[key] = _Record(
                expires_at=now + max(1, int(ttl_sec)),
                entry=OfficeViewSourceEntry(
                    filename=str(filename or "attachment"),
                    content_type=str(content_type or "") or "application/octet-stream",
                    content=content,
                ),
            )
            self._total_bytes += size
            return True

    def get(self, key: str) -> OfficeViewSourceEntry | None:
        """Return the parked entry; records stay readable until expiry (DS may retry)."""
        now = time.monotonic()
        with self._lock:
            self._drop_expired_locked(now)
            record = self._records.get(key)
            return record.entry if record is not None else None


office_view_source_store = OfficeViewSourceStore()
