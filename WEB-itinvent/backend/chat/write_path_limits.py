"""DB slot reservation so send always has write-pool capacity."""
from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from typing import Iterator


def _env_int(name: str, default: int, minimum: int = 0, maximum: int = 10_000) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = int(raw)
    except Exception:
        value = int(default)
    return max(minimum, min(maximum, value))


# Base write pool size (not overflow). Used for invariant checks.
CHAT_DB_WRITE_POOL_SIZE = _env_int("CHAT_DB_WRITE_POOL_SIZE", 8, 1, 128)
CHAT_SEND_DB_RESERVED = _env_int("CHAT_SEND_DB_RESERVED", 4, 1, 128)
CHAT_MARK_READ_DB_SLOTS = _env_int("CHAT_MARK_READ_DB_SLOTS", 2, 0, 128)
CHAT_AUX_WRITE_DB_SLOTS = _env_int("CHAT_AUX_WRITE_DB_SLOTS", 2, 0, 128)

CHAT_READ_CONCURRENCY = _env_int("CHAT_READ_CONCURRENCY", 16, 1, 256)
CHAT_READ_ACQUIRE_TIMEOUT_MS = _env_int("CHAT_READ_ACQUIRE_TIMEOUT_MS", 200, 10, 60_000)
CHAT_READ_STATEMENT_TIMEOUT_MS = _env_int("CHAT_READ_STATEMENT_TIMEOUT_MS", 5_000, 100, 120_000)


def validate_write_slot_invariant() -> None:
    used = int(CHAT_MARK_READ_DB_SLOTS) + int(CHAT_AUX_WRITE_DB_SLOTS)
    reserved_budget = int(CHAT_DB_WRITE_POOL_SIZE) - int(CHAT_SEND_DB_RESERVED)
    if used > reserved_budget:
        raise RuntimeError(
            "Invalid chat write DB slot config: "
            f"MARK_READ({CHAT_MARK_READ_DB_SLOTS})+AUX({CHAT_AUX_WRITE_DB_SLOTS})"
            f"={used} exceeds WRITE_POOL({CHAT_DB_WRITE_POOL_SIZE})"
            f"-SEND_RESERVED({CHAT_SEND_DB_RESERVED})={reserved_budget}"
        )


class _CountingSemaphore:
    """Threading semaphore with optional non-blocking / timeout acquire."""

    def __init__(self, value: int) -> None:
        self._value = max(0, int(value))
        self._sem = threading.Semaphore(self._value) if self._value > 0 else None
        self._lock = threading.Lock()
        self._in_use = 0
        self._timeouts = 0

    @property
    def capacity(self) -> int:
        return int(self._value)

    @property
    def in_use(self) -> int:
        with self._lock:
            return int(self._in_use)

    @property
    def timeouts(self) -> int:
        with self._lock:
            return int(self._timeouts)

    def acquire(self, *, timeout_sec: float | None = None) -> bool:
        if self._sem is None:
            # Zero slots configured → always reject non-send writers.
            with self._lock:
                self._timeouts += 1
            return False
        ok = self._sem.acquire(timeout=None if timeout_sec is None else float(timeout_sec))
        if not ok:
            with self._lock:
                self._timeouts += 1
            return False
        with self._lock:
            self._in_use += 1
        return True

    def release(self) -> None:
        if self._sem is None:
            return
        with self._lock:
            self._in_use = max(0, self._in_use - 1)
        self._sem.release()


_MARK_READ_SLOTS = _CountingSemaphore(CHAT_MARK_READ_DB_SLOTS)
_AUX_WRITE_SLOTS = _CountingSemaphore(CHAT_AUX_WRITE_DB_SLOTS)


class WriteSlotTimeoutError(TimeoutError):
    """Raised when mark_read/aux cannot acquire a reserved write DB slot."""


@contextmanager
def mark_read_db_slot(*, timeout_sec: float = 5.0) -> Iterator[None]:
    if not _MARK_READ_SLOTS.acquire(timeout_sec=timeout_sec):
        raise WriteSlotTimeoutError("mark_read DB slot timeout")
    try:
        yield
    finally:
        _MARK_READ_SLOTS.release()


@contextmanager
def aux_write_db_slot(*, timeout_sec: float = 5.0) -> Iterator[None]:
    if not _AUX_WRITE_SLOTS.acquire(timeout_sec=timeout_sec):
        raise WriteSlotTimeoutError("aux write DB slot timeout")
    try:
        yield
    finally:
        _AUX_WRITE_SLOTS.release()


def write_slot_gauges() -> dict[str, int]:
    return {
        "write_pool_size": int(CHAT_DB_WRITE_POOL_SIZE),
        "send_db_reserved": int(CHAT_SEND_DB_RESERVED),
        "mark_read_db_slots": int(_MARK_READ_SLOTS.capacity),
        "mark_read_db_in_use": int(_MARK_READ_SLOTS.in_use),
        "mark_read_db_timeouts": int(_MARK_READ_SLOTS.timeouts),
        "aux_write_db_slots": int(_AUX_WRITE_SLOTS.capacity),
        "aux_write_db_in_use": int(_AUX_WRITE_SLOTS.in_use),
        "aux_write_db_timeouts": int(_AUX_WRITE_SLOTS.timeouts),
    }


# Validate at import so misconfig fails fast in chat process.
validate_write_slot_invariant()
