"""PC activity accounting: active / passive / away / locked in 5-minute buckets.

States mirror ActivTrak: typing/mouse = active, short silence = passive
(watching/reading), longer silence = away, locked session = locked.
The tracker rides the existing watcher tick (~3 s): three WinAPI calls and one
cached pid→name lookup per tick — no extra threads, no UIA.

Idle-zone thresholds default to the browser idle threshold so "away" and
"tab idle" (ForegroundTracker IDLE_THRESHOLD_SEC, default 300 s) start at the
same moment.
"""

from __future__ import annotations

import ctypes
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime
from typing import Any, Dict, List, Optional

from .foreground import get_idle_seconds

log = logging.getLogger("browser_probe.activity")


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


# Keep in sync with foreground.IDLE_THRESHOLD_SEC (ITINV_BROWSER_PROBE_IDLE_SEC):
# "отошёл" и "простой вкладки" начинаются одновременно.
PASSIVE_AFTER_SEC = _env_float("ITINV_ACTIVITY_PASSIVE_AFTER_SEC", 120)
AWAY_AFTER_SEC = _env_float("ITINV_ACTIVITY_AWAY_AFTER_SEC", 300)
BUCKET_SEC = 300
MAX_OBSERVED_GAP_SEC = 15.0
MAX_APPS_PER_BUCKET = 8
MAX_APP_NAME_LEN = 64
_PROC_CACHE_LIMIT = 256
_UNKNOWN_EXE = "unknown"

_UOI_NAME = 2
_DESKTOP_SWITCHDESKTOP = 0x0100

_proc_name_cache: "OrderedDict[int, str]" = OrderedDict()


def _session_locked() -> bool:
    """True when the interactive session is locked / has no input desktop."""
    try:
        hdesk = ctypes.windll.user32.OpenInputDesktop(0, False, _DESKTOP_SWITCHDESKTOP)
    except Exception:
        return True
    if not hdesk:
        return True
    try:
        buf = ctypes.create_unicode_buffer(256)
        needed = ctypes.c_ulong(0)
        ok = ctypes.windll.user32.GetUserObjectInformationW(
            hdesk, _UOI_NAME, buf, ctypes.sizeof(buf), ctypes.byref(needed)
        )
        if not ok:
            return True
        return str(buf.value or "") != "Default"
    except Exception:
        return True
    finally:
        try:
            ctypes.windll.user32.CloseDesktop(hdesk)
        except Exception:
            pass


def _process_exe_name(pid: int) -> str:
    pid = int(pid or 0)
    if not pid:
        return _UNKNOWN_EXE
    cached = _proc_name_cache.get(pid)
    if cached is not None:
        _proc_name_cache.move_to_end(pid)
        return cached
    try:
        import psutil

        name = str(psutil.Process(pid).name() or "").strip().lower() or _UNKNOWN_EXE
    except Exception:
        name = _UNKNOWN_EXE
    _proc_name_cache[pid] = name
    _proc_name_cache.move_to_end(pid)
    while len(_proc_name_cache) > _PROC_CACHE_LIMIT:
        _proc_name_cache.popitem(last=False)
    return name


def _foreground_exe() -> str:
    try:
        import win32gui
        import win32process

        hwnd = int(win32gui.GetForegroundWindow() or 0)
        if not hwnd:
            return _UNKNOWN_EXE
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        return _process_exe_name(int(pid or 0))
    except Exception:
        return _UNKNOWN_EXE


def _local_now() -> datetime:
    return datetime.now().astimezone()


def _bucket_key(dt: datetime) -> datetime:
    seconds = dt.hour * 3600 + dt.minute * 60 + dt.second
    floored = seconds - (seconds % BUCKET_SEC)
    return dt.replace(
        hour=floored // 3600,
        minute=(floored % 3600) // 60,
        second=0,
        microsecond=0,
    )


class ActivityTracker:
    """Accumulate activity seconds into local-time 5-minute buckets.

    poll() runs on every watcher tick; closed buckets are returned for
    enqueue. flush() on agent stop emits the still-open bucket too — the
    server upserts by (host, user, bucket_start), so re-sends overwrite.
    """

    def __init__(self, *, bucket_sec: int = BUCKET_SEC) -> None:
        self.bucket_sec = max(60, int(bucket_sec))
        self._prev_mono: Optional[float] = None
        self._bucket_start: Optional[datetime] = None
        self._acc: Dict[str, float] = {"active": 0.0, "passive": 0.0, "away": 0.0, "locked": 0.0}
        self._apps: Dict[str, float] = {}
        self._closed: List[Dict[str, Any]] = []

    def _close_bucket(self) -> None:
        if self._bucket_start is None:
            return
        if any(self._acc.values()):
            apps = sorted(self._apps.items(), key=lambda kv: kv[1], reverse=True)[
                :MAX_APPS_PER_BUCKET
            ]
            self._closed.append(
                {
                    "bucket_start": self._bucket_start.isoformat(),
                    "active_sec": round(self._acc["active"], 1),
                    "passive_sec": round(self._acc["passive"], 1),
                    "away_sec": round(self._acc["away"], 1),
                    "locked_sec": round(self._acc["locked"], 1),
                    "apps": {
                        str(name)[:MAX_APP_NAME_LEN]: round(sec, 1)
                        for name, sec in apps
                        if sec > 0
                    },
                }
            )
        self._bucket_start = None
        for key in self._acc:
            self._acc[key] = 0.0
        self._apps.clear()

    def _accrue(self, active: float, passive: float, away: float, locked: float, exe: str) -> None:
        # A tick spans ~3 s; attribute its delta to the bucket it ends in —
        # cheaper and stable enough at this granularity.
        key = _bucket_key(_local_now())
        if self._bucket_start is not None and key != self._bucket_start:
            self._close_bucket()
        if self._bucket_start is None:
            self._bucket_start = key
        self._acc["active"] += active
        self._acc["passive"] += passive
        self._acc["away"] += away
        self._acc["locked"] += locked
        app_sec = active + passive
        if app_sec > 0 and exe:
            self._apps[exe] = self._apps.get(exe, 0.0) + app_sec

    def poll(self) -> List[Dict[str, Any]]:
        """Consume one tick of activity; return newly closed buckets."""
        now_mono = time.monotonic()
        prev = self._prev_mono
        self._prev_mono = now_mono
        if prev is None:
            return []
        delta = now_mono - prev
        if delta <= 0:
            return []
        if delta > MAX_OBSERVED_GAP_SEC:
            # Blind gap (sleep, probe stall): no observation — credit nothing.
            return []
        if _session_locked():
            self._accrue(0.0, 0.0, 0.0, delta, "")
            return self._drain()

        idle = get_idle_seconds(on_error=None)
        if idle is None:
            # Sensor read failed: accrue nothing rather than fabricate active seconds.
            return self._drain()
        # On the "time since last input" axis this tick covers [idle-delta, idle].
        hi = idle
        lo = idle - delta
        active = 0.0
        if lo < 0:
            # Input happened inside the interval — that leading part is active.
            active += -lo
            lo = 0.0
        active += max(0.0, min(hi, PASSIVE_AFTER_SEC) - lo)
        passive = max(0.0, min(hi, AWAY_AFTER_SEC) - max(lo, PASSIVE_AFTER_SEC))
        away = max(0.0, hi - max(lo, AWAY_AFTER_SEC))
        exe = _foreground_exe() if (active + passive) > 0 else ""
        self._accrue(active, passive, away, 0.0, exe)
        return self._drain()

    def _drain(self) -> List[Dict[str, Any]]:
        out = self._closed
        self._closed = []
        return out

    def flush(self) -> List[Dict[str, Any]]:
        """Close the open bucket and return every queued bucket."""
        self._close_bucket()
        return self._drain()
