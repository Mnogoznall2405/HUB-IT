from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def get_process_rss_bytes(pid: Optional[int] = None) -> int:
    """Return resident set size for a process in bytes (best effort)."""
    target_pid = int(pid if pid is not None else os.getpid())
    if target_pid <= 0:
        return 0

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                    ("PrivateUsage", ctypes.c_size_t),
                ]

            counters = PROCESS_MEMORY_COUNTERS_EX()
            counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, target_pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not handle:
                return 0
            try:
                ok = ctypes.windll.psapi.GetProcessMemoryInfo(
                    handle,
                    ctypes.byref(counters),
                    counters.cb,
                )
                if not ok:
                    return 0
                return int(counters.WorkingSetSize or 0)
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return 0

    try:
        with open(f"/proc/{target_pid}/status", "r", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("VmRSS:"):
                    parts = line.split()
                    if len(parts) >= 2:
                        return int(parts[1]) * 1024
    except Exception:
        return 0
    return 0


def memory_pressure_active(*, limit_mb: int, pid: Optional[int] = None) -> bool:
    limit = max(0, int(limit_mb or 0))
    if limit <= 0:
        return False
    rss_bytes = get_process_rss_bytes(pid=pid)
    if rss_bytes <= 0:
        return False
    rss_mb = rss_bytes / (1024 * 1024)
    if rss_mb >= limit:
        logger.warning(
            "Scan worker memory pressure: rss_mb=%.1f limit_mb=%s pid=%s",
            rss_mb,
            limit,
            pid if pid is not None else os.getpid(),
        )
        return True
    return False
