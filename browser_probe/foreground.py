"""Foreground browser window poll + dwell tracking."""

from __future__ import annotations

import logging
import time
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

_SCREEN_READER_ENABLED = False


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


def _ensure_screen_reader_hint() -> None:
    """Ask Windows to advertise a screen reader so Chromium expands UIA tree."""
    global _SCREEN_READER_ENABLED
    if _SCREEN_READER_ENABLED:
        return
    try:
        import ctypes

        # SPI_SETSCREENREADER = 0x0047
        ctypes.windll.user32.SystemParametersInfoW(0x0047, 1, 0, 0)
        _SCREEN_READER_ENABLED = True
    except Exception as exc:
        log.debug("SPI_SETSCREENREADER failed: %s", exc)


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


def read_omnibox_url(hwnd: int) -> str:
    """Best-effort active tab URL from address bar (UIA)."""
    if not hwnd:
        return ""
    _ensure_screen_reader_hint()
    try:
        import uiautomation as auto
    except ImportError:
        return ""
    try:
        root = auto.ControlFromHandle(int(hwnd))
    except Exception:
        return ""

    best = ""
    stack: list[tuple[Any, int]] = [(root, 0)]
    seen: set[int] = set()
    while stack and len(seen) < 5000:
        el, depth = stack.pop()
        if depth > 16:
            continue
        key = id(el)
        if key in seen:
            continue
        seen.add(key)
        try:
            ct = str(el.ControlTypeName or "")
            name = str(el.Name or "").lower()
            aid = str(el.AutomationId or "").lower()
        except Exception:
            ct, name, aid = "", "", ""
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
            if _looks_like_url(val) and len(val) >= len(best):
                best = val.strip()
        try:
            for ch in el.GetChildren():
                stack.append((ch, depth + 1))
        except Exception:
            pass
    return _normalize_url(best) if best else ""


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
            url = read_omnibox_url(hwnd)
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


class ForegroundTracker:
    """Accumulate dwell seconds while the same browser tab stays in foreground."""

    def __init__(self) -> None:
        self._key: str | None = None
        self._started: float | None = None
        self._snapshot: ForegroundSnapshot | None = None

    @staticmethod
    def _focus_key(snap: ForegroundSnapshot) -> str:
        # Prefer URL so SPA title flicker does not split one active tab.
        url = (snap.url or "").strip().lower()
        title = (snap.page_title or "").strip().lower()
        return f"{snap.browser}|{snap.hwnd}|{url or title}"

    def poll(self) -> tuple[ForegroundSnapshot | None, dict[str, Any] | None]:
        """
        Returns (current_snapshot, closed_focus_event_or_None).

        A focus event is emitted when the foreground tab/browser changes or browser leaves FG.
        """
        now = time.monotonic()
        snap = get_foreground_browser(read_url=True)
        new_key = self._focus_key(snap) if snap is not None else None

        closed: dict[str, Any] | None = None
        if self._key and self._key != new_key and self._started is not None and self._snapshot is not None:
            dwell = max(0.0, now - self._started)
            closed = {
                "browser": self._snapshot.browser,
                "title": self._snapshot.page_title,
                "window_title": self._snapshot.title,
                "url": self._snapshot.url or "",
                "hwnd": self._snapshot.hwnd,
                "dwell_sec": round(dwell, 1),
                "ended_at": time.time(),
                "source": "focus",
            }

        if new_key != self._key:
            self._key = new_key
            self._started = now if new_key else None
            self._snapshot = snap
        elif snap is not None:
            # Refresh URL/title while same key (omnibox may fill in late).
            if snap.url and not (self._snapshot.url if self._snapshot else ""):
                self._snapshot = snap
            else:
                self._snapshot = snap

        return snap, closed
