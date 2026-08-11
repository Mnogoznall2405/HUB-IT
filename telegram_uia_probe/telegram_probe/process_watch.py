"""Detect active messenger window via Win32 + psutil."""

from __future__ import annotations

import logging
import os
import socket
from dataclasses import dataclass

import psutil

from .profile import TELEGRAM, MessengerProfile

logger = logging.getLogger(__name__)

# Backward-compatible alias used by older imports/tests.
TELEGRAM_PROCESS_NAMES = TELEGRAM.process_names


@dataclass
class ActiveWindowInfo:
    hwnd: int
    title: str
    pid: int
    process_name: str
    exe_path: str | None
    is_target: bool

    @property
    def is_telegram(self) -> bool:
        """Legacy alias: True when the active window matches the Telegram profile."""
        return self.is_target and self.process_name in TELEGRAM.process_names


def get_windows_identity() -> tuple[str, str]:
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "unknown"
    try:
        computer = socket.gethostname() or os.environ.get("COMPUTERNAME") or "unknown"
    except Exception:  # noqa: BLE001
        computer = os.environ.get("COMPUTERNAME") or "unknown"
    return user, computer


def _process_name(pid: int) -> tuple[str, str | None]:
    try:
        proc = psutil.Process(pid)
        name = (proc.name() or "").lower()
        try:
            exe = proc.exe()
        except (psutil.AccessDenied, psutil.Error):
            exe = None
        return name, exe
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.Error) as exc:
        logger.debug("psutil process lookup failed pid=%s: %s", pid, exc)
        return "", None


def get_foreground_window(profile: MessengerProfile | None = None) -> ActiveWindowInfo | None:
    profile = profile or TELEGRAM
    try:
        import win32gui
        import win32process
    except ImportError:
        logger.error("pywin32 is required")
        return None

    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        title = win32gui.GetWindowText(hwnd) or ""
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        pid = int(pid)
        name, exe = _process_name(pid)
        is_target = name in profile.process_names
        return ActiveWindowInfo(
            hwnd=int(hwnd),
            title=title,
            pid=pid,
            process_name=name,
            exe_path=exe,
            is_target=is_target,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("get_foreground_window failed: %s", exc)
        return None


def _looks_main_messenger_window(title: str, class_name: str) -> bool:
    """True for real chat windows (visible or tray-hidden), not shadows/IME/trays."""
    title_l = (title or "").strip().lower()
    class_l = (class_name or "").strip().lower()
    if not title_l and "qwindowicon" not in class_l:
        return False
    if any(
        bad in class_l
        for bad in (
            "windowshadow",
            "trayicon",
            "ime",
            "msctfime",
            "gdi+",
            "themechange",
            "screenchange",
            "_q_titlebar",
        )
    ):
        return False
    if title_l in {"g", "default ime", "msctfime ui", "qtrayiconmessagewindow", "_q_titlebar"}:
        return False
    # TelegramDesktop / MAX / "Telegram (1234)" / peer titles.
    if "qwindowicon" in class_l or "mewindow" in class_l:
        return True
    if title_l.startswith("telegram") or title_l == "max" or "max messenger" in title_l:
        return True
    return bool(title_l)


def find_main_hwnd(
    profile: MessengerProfile | None = None,
    preferred_pid: int | None = None,
) -> int | None:
    """Find a top-level messenger window (visible preferred; tray-hidden fallback)."""
    profile = profile or TELEGRAM
    try:
        import win32gui
        import win32process
    except ImportError:
        return None

    found: list[tuple[int, int]] = []

    def enum_handler(hwnd: int, _lparam: object) -> bool:
        try:
            _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
            pid = int(pid)
            name, _exe = _process_name(pid)
            if name not in profile.process_names:
                return True
            title = win32gui.GetWindowText(hwnd) or ""
            try:
                class_name = win32gui.GetClassName(hwnd) or ""
            except Exception:
                class_name = ""
            if not _looks_main_messenger_window(title, class_name):
                return True
            visible = bool(win32gui.IsWindowVisible(hwnd))
            score = 0
            if visible:
                score += 10
            if title.strip():
                score += 3
            if preferred_pid and pid == preferred_pid:
                score += 5
            # Prefer non-empty peer titles over bare "TelegramDesktop"/"MAX".
            if title.strip() and title.strip().lower() not in {
                "telegram",
                "telegramdesktop",
                "telegram desktop",
                "max",
                "max messenger",
            }:
                score += 2
            found.append((score, int(hwnd)))
        except Exception:  # noqa: BLE001
            pass
        return True

    try:
        win32gui.EnumWindows(enum_handler, None)
    except Exception as exc:  # noqa: BLE001
        logger.debug("EnumWindows failed: %s", exc)
        return None

    if not found:
        return None
    found.sort(key=lambda x: x[0], reverse=True)
    return found[0][1]


def find_telegram_main_hwnd(preferred_pid: int | None = None) -> int | None:
    """Backward-compatible wrapper."""
    return find_main_hwnd(TELEGRAM, preferred_pid=preferred_pid)
