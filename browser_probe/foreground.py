"""Foreground browser window poll + dwell tracking."""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("browser_probe.foreground")

BROWSER_PROCESS_MAP = {
    "chrome.exe": "chrome",
    "msedge.exe": "edge",
    "browser.exe": "yandex",  # Yandex Browser
}

_TITLE_SUFFIXES = (
    " - Google Chrome",
    " — Google Chrome",
    " - Microsoft Edge",
    " — Microsoft Edge",
    " - Яндекс Браузер",
    " — Яндекс Браузер",
    " - Yandex",
    " — Yandex",
)

@dataclass
class ForegroundSnapshot:
    hwnd: int
    browser: str
    process_name: str
    title: str
    page_title: str
    pid: int
    url: str = ""


def _strip_browser_suffix(title: str) -> str:
    text = str(title or "").strip()
    for suf in _TITLE_SUFFIXES:
        if text.endswith(suf):
            return text[: -len(suf)].strip()
    # Fallback: split on last " - "
    if " - " in text:
        return text.rsplit(" - ", 1)[0].strip()
    if " — " in text:
        return text.rsplit(" — ", 1)[0].strip()
    return text


def _process_basename(pid: int) -> str:
    try:
        import psutil

        return str(psutil.Process(pid).name() or "").strip().lower()
    except Exception:
        return ""


def _looks_like_url(value: str) -> bool:
    text = str(value or "").strip()
    if not text or len(text) > 2000:
        return False
    low = text.lower()
    if low.startswith(("http://", "https://", "file://", "chrome://", "edge://", "browser://")):
        return True
    if " " in text.strip():
        return False
    if "." in text and "/" in text:
        return True
    if text.count(".") >= 1 and not text.startswith("."):
        # bare host like web.max.ru
        return True
    return False


def _normalize_url(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith(("http://", "https://", "file://", "chrome://", "edge://", "browser://")):
        return text
    # Omnibox often shows host without scheme.
    if text.startswith("//"):
        return "https:" + text
    return "https://" + text.lstrip("/")


# Web-content subtrees never contain the omnibox and can hold thousands of
# a11y nodes (the whole DOM once a screen-reader flag is on) — pruning them is
# what makes the address-bar read fast and reliable.
_DOCUMENT_CONTROL_TYPES = frozenset({"DocumentControl"})
_DOCUMENT_CLASS_NEEDLES = (
    "chrome_renderwidgethosthwnd",
    "webview",
    "intermediate d3d window",
)

_OMNIBOX_MAX_NODES = 1500
_OMNIBOX_MAX_DEPTH = 16
_OMNIBOX_MAX_ATTEMPTS = 2
_OMNIBOX_REFRESH_SEC = 30.0
_OMNIBOX_CACHE_LIMIT = 64

# (hwnd, window_title) -> (url, attempts, read_at_monotonic). One UIA read per
# foreground page, plus a bounded retry — the omnibox fills in slightly after
# the window title. This is a window+title cache with a bounded refresh, not
# an observation of the tab contents: a same-title SPA navigation becomes
# visible at most _OMNIBOX_REFRESH_SEC later.
_omnibox_cache: "OrderedDict[tuple[int, str], tuple[str, int, float]]" = OrderedDict()


def _is_document_subtree(control_type: str, class_name: str) -> bool:
    if control_type in _DOCUMENT_CONTROL_TYPES:
        return True
    cls = class_name.lower()
    return any(needle in cls for needle in _DOCUMENT_CLASS_NEEDLES)


def read_omnibox_url(hwnd: int) -> str:
    """Best-effort active tab URL from the address bar (UIA).

    BFS with web-content pruning: the omnibox lives in the toolbar, close to
    the window root, so the first URL-looking Edit value wins — no need to
    walk the page DOM.
    """
    if not hwnd:
        return ""
    try:
        import uiautomation as auto
    except ImportError:
        return ""
    try:
        root = auto.ControlFromHandle(int(hwnd))
    except Exception:
        return ""

    queue: deque[tuple[Any, int]] = deque([(root, 0)])
    visited = 0
    while queue and visited < _OMNIBOX_MAX_NODES:
        el, depth = queue.popleft()
        if depth > _OMNIBOX_MAX_DEPTH:
            continue
        visited += 1
        try:
            ct = str(el.ControlTypeName or "")
            class_name = str(el.ClassName or "")
            name = str(el.Name or "").lower()
            aid = str(el.AutomationId or "").lower()
        except Exception:
            ct, class_name, name, aid = "", "", "", ""
        if _is_document_subtree(ct, class_name):
            continue
        interesting = (
            "Edit" in ct
            or "combobox" in ct.lower()
            or "address" in name
            or "omnibox" in name
            or "omnibox" in aid
            or "url" in name
            or "адрес" in name
        )
        if interesting:
            val = ""
            try:
                pat = el.GetValuePattern()
                if pat and pat.Value:
                    val = str(pat.Value)
            except Exception:
                pass
            if _looks_like_url(val):
                return _normalize_url(val)
        try:
            for ch in el.GetChildren():
                queue.append((ch, depth + 1))
        except Exception:
            pass
    return ""


def _omnibox_url_cached(hwnd: int, title: str) -> str:
    key = (int(hwnd), str(title or ""))
    now = time.monotonic()
    cached = _omnibox_cache.get(key)
    if cached is not None:
        url, attempts, read_at = cached
        if now - read_at < _OMNIBOX_REFRESH_SEC:
            if url or attempts >= _OMNIBOX_MAX_ATTEMPTS:
                _omnibox_cache.move_to_end(key)
                return url
        else:
            attempts = 0
    else:
        attempts = 0
    url = read_omnibox_url(hwnd)
    _omnibox_cache[key] = (url, attempts + 1, now)
    _omnibox_cache.move_to_end(key)
    while len(_omnibox_cache) > _OMNIBOX_CACHE_LIMIT:
        _omnibox_cache.popitem(last=False)
    return url


def get_foreground_browser(*, read_url: bool = True) -> ForegroundSnapshot | None:
    try:
        import win32gui
        import win32process
    except ImportError:
        return None

    try:
        hwnd = int(win32gui.GetForegroundWindow() or 0)
    except Exception:
        return None
    if not hwnd:
        return None
    try:
        if not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
            return None
        title = win32gui.GetWindowText(hwnd) or ""
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        pid = int(pid or 0)
    except Exception as exc:
        log.debug("foreground query failed: %s", exc)
        return None

    proc = _process_basename(pid)
    browser = BROWSER_PROCESS_MAP.get(proc)
    if not browser:
        return None
    url = ""
    if read_url:
        try:
            # UIA read is cached per (hwnd, title): one walk per page, plus a
            # single retry for pages whose omnibox fills in late — instead of
            # a full tree walk on every poll tick.
            url = _omnibox_url_cached(hwnd, title)
        except Exception as exc:
            log.debug("omnibox read failed: %s", exc)
    return ForegroundSnapshot(
        hwnd=hwnd,
        browser=browser,
        process_name=proc,
        title=title,
        page_title=_strip_browser_suffix(title),
        pid=pid,
        url=url,
    )


# Poll gaps longer than this are treated as "unobserved": the loop stalled on a
# history read/upload, or the session slept/was locked. The blind interval must
# not be credited to the open focus event — otherwise one stall can inflate
# dwell by minutes (seen in production as bogus hour-long "focus" rows).
MAX_OBSERVED_GAP_SEC = 15.0


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


# Seconds without keyboard/mouse input after which a foreground tab stops
# accruing "active" dwell; the remainder is reported separately as idle.
# The first threshold seconds after the last input still count as active
# ("reading") on purpose — that is the agreed product semantics.
IDLE_THRESHOLD_SEC = _env_float("ITINV_BROWSER_PROBE_IDLE_SEC", 300)
# Max length of one focus segment before it is closed and re-opened with the
# same key: keeps uploads near-real-time, bounds loss on power-off, and lets
# the server bucket dwell per local day instead of piling it on the close day.
# Volume bound: every segment is also a row in the server-side dedup table
# (app.browser_probe_focus_events, ~92k rows/day and no retention), so the
# defaults are minutes, not seconds.
FLUSH_SEC = _env_float("ITINV_BROWSER_PROBE_FOCUS_FLUSH_SEC", 300)
# Longer flush interval for segments that are pure idle (no active seconds
# accrued): an unattended PC otherwise still produces a dedup row per flush —
# idle detail beyond 15 minutes adds nothing to the day totals.
IDLE_FLUSH_SEC = _env_float("ITINV_BROWSER_PROBE_IDLE_FLUSH_SEC", 900)
# Event payload version understood by the server ingest: schema 2 carries
# separate dwell/idle fields.
FOCUS_EVENT_SCHEMA = 2


def get_idle_seconds(*, on_error: float | None = 0.0) -> float | None:
    """Seconds since the last keyboard/mouse input (GetLastInputInfo).

    A failed native read returns ``on_error`` — pass ``None`` to distinguish
    a broken sensor from a user who just typed (idle 0.0).
    """
    try:
        import ctypes

        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_ulong)]

        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(info)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return on_error
        tick = int(ctypes.windll.kernel32.GetTickCount()) & 0xFFFFFFFF
        idle_ms = (tick - int(info.dwTime)) & 0xFFFFFFFF
        return idle_ms / 1000.0
    except Exception:
        return on_error


class ForegroundTracker:
    """Accumulate active/idle dwell seconds for the foreground browser tab.

    The open interval is a "segment": it closes on a key change (tab, window
    or browser), on a blind poll gap, on the periodic FLUSH_SEC rollover and
    on flush() when the agent stops. ``_session_active`` accumulates active
    dwell across the segments of one continuous focus session (same key,
    no blind gap) so the server can attribute the full session dwell to the
    matching History row.
    """

    def __init__(self) -> None:
        self._key: str | None = None
        self._started: float | None = None
        self._snapshot: ForegroundSnapshot | None = None
        self._last_poll: float | None = None
        self._active_acc = 0.0
        self._idle_acc = 0.0
        self._session_active = 0.0

    @staticmethod
    def _focus_key(snap: ForegroundSnapshot) -> str:
        # Prefer URL so SPA title flicker does not split one active tab.
        url = (snap.url or "").strip().lower()
        title = (snap.page_title or "").strip().lower()
        return f"{snap.browser}|{snap.hwnd}|{url or title}"

    def _accrue(self, delta: float, idle_sec: float) -> None:
        if delta <= 0:
            return
        idle_part = min(delta, max(0.0, idle_sec - IDLE_THRESHOLD_SEC))
        self._idle_acc += idle_part
        self._active_acc += delta - idle_part

    def _close_segment(self, end_mono: float, now: float) -> dict[str, Any] | None:
        """Emit the open segment; resets only the per-segment accumulators."""
        if not self._active_acc and not self._idle_acc:
            return None
        session_total = self._session_active + self._active_acc
        snap = self._snapshot
        closed = {
            "event_id": uuid.uuid4().hex,
            "browser": snap.browser,
            "title": snap.page_title,
            "window_title": snap.title,
            "url": snap.url or "",
            "hwnd": snap.hwnd,
            "dwell_sec": round(self._active_acc, 1),
            "idle_sec": round(self._idle_acc, 1),
            "session_dwell_sec": round(session_total, 1),
            "ended_at": time.time() - max(0.0, now - end_mono),
            "source": "focus",
            "schema": FOCUS_EVENT_SCHEMA,
        }
        self._session_active = session_total
        self._active_acc = 0.0
        self._idle_acc = 0.0
        return closed

    def _start_segment(self, key: str | None, now: float, snap: ForegroundSnapshot | None) -> None:
        self._key = key
        self._started = now if key else None
        self._snapshot = snap if key else None
        self._active_acc = 0.0
        self._idle_acc = 0.0
        self._session_active = 0.0

    def poll(self) -> tuple[ForegroundSnapshot | None, dict[str, Any] | None]:
        """
        Returns (current_snapshot, closed_focus_event_or_None).

        A focus event is emitted when a segment closes: on a foreground
        tab/browser change, when the browser leaves FG, on a blind poll gap
        (closed at the last real observation) and on the periodic flush.
        """
        now = time.monotonic()
        prev_poll = self._last_poll
        self._last_poll = now
        snap = get_foreground_browser(read_url=True)
        new_key = self._focus_key(snap) if snap is not None else None

        # Late omnibox fill: the same page (same hwnd/browser/title) got a URL
        # after the segment opened on a title-only key. Adopt the url-based
        # key and keep the segment — splitting it would emit a bogus second
        # event for one continuous visit.
        if (
            new_key is not None
            and self._key is not None
            and new_key != self._key
            and snap is not None
            and self._snapshot is not None
            and not (self._snapshot.url or "").strip()
            and (snap.url or "").strip()
            and self._snapshot.browser == snap.browser
            and self._snapshot.hwnd == snap.hwnd
            and self._snapshot.page_title == snap.page_title
        ):
            self._key = new_key
            self._snapshot = snap

        blind_gap = prev_poll is not None and (now - prev_poll) > MAX_OBSERVED_GAP_SEC
        idle = None
        if self._key is not None and prev_poll is not None and not blind_gap:
            idle = get_idle_seconds(on_error=None)
            if idle is None:
                blind_gap = True

        closed: dict[str, Any] | None = None
        if self._key is not None and self._started is not None and self._snapshot is not None:
            if blind_gap:
                # The interval since the last poll was never observed: close
                # at the last real observation and count nothing past it.
                closed = self._close_segment(prev_poll, now)
            else:
                if prev_poll is not None:
                    self._accrue(now - prev_poll, idle)
                if self._key != new_key:
                    closed = self._close_segment(now, now)
                else:
                    # Long-lived tab: close an intermediate segment and reopen
                    # with the same key — event_id and session keep continuity.
                    # Pure-idle segments flush slower: their exact 60 s split
                    # adds nothing but dedup-table rows.
                    flush_after = FLUSH_SEC if self._active_acc > 0 else IDLE_FLUSH_SEC
                    if (now - self._started) >= flush_after:
                        closed = self._close_segment(now, now)

        if new_key != self._key or blind_gap:
            self._start_segment(new_key, now, snap)
        elif self._key is not None and closed is not None:
            # Periodic flush closed the segment: reopen it for the same key.
            self._key = new_key
            self._started = now
            self._snapshot = snap
        elif snap is not None:
            # Refresh URL/title while same key (omnibox may fill in late).
            self._snapshot = snap

        return snap, closed

    def flush(self) -> dict[str, Any] | None:
        """Close the open segment at the last observation (agent stop)."""
        if self._key is None or self._started is None or self._snapshot is None:
            return None
        now = time.monotonic()
        end_mono = self._last_poll if self._last_poll is not None else now
        closed = self._close_segment(end_mono, now)
        self._start_segment(None, now, None)
        return closed
