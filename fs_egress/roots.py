from __future__ import annotations

import ctypes
import logging
import os
import string
from pathlib import Path
from typing import Iterable, List, Set

logger = logging.getLogger("fs_egress.roots")

DRIVE_REMOVABLE = 2
DRIVE_FIXED = 3
DRIVE_REMOTE = 4

PROFILE_SUBDIRS = (
    "Desktop",
    "Documents",
    "Downloads",
    "Pictures",
    "Videos",
    "Music",
)

IGNORE_NAME_FRAGMENTS = (
    "\\appdata\\local\\temp\\",
    "\\appdata\\local\\microsoft\\windows\\inetcache\\",
    "\\node_modules\\",
    "\\.git\\",
    "\\$recycle.bin\\",
    "\\system volume information\\",
    "\\windows\\",
)


def _get_drive_type(root: str) -> int:
    try:
        return int(ctypes.windll.kernel32.GetDriveTypeW(str(root)))
    except Exception:
        return 0


def _logical_drives() -> List[str]:
    try:
        bitmask = int(ctypes.windll.kernel32.GetLogicalDrives())
    except Exception:
        return []
    drives: List[str] = []
    for index, letter in enumerate(string.ascii_uppercase):
        if bitmask & (1 << index):
            drives.append(f"{letter}:\\")
    return drives


def iter_user_profile_roots() -> List[Path]:
    roots: List[Path] = []
    users = Path(os.environ.get("SystemDrive", "C:") + "\\Users")
    if not users.is_dir():
        return roots
    skip = {"public", "default", "default user", "all users", "defaultapppool"}
    for profile in users.iterdir():
        if not profile.is_dir():
            continue
        if profile.name.lower() in skip:
            continue
        for sub in PROFILE_SUBDIRS:
            candidate = profile / sub
            if candidate.is_dir():
                roots.append(candidate)
        for child in profile.iterdir():
            if child.is_dir() and child.name.lower().startswith("onedrive"):
                roots.append(child)
    return roots


def iter_remote_roots(*, depth_fallback: bool = True) -> List[Path]:
    roots: List[Path] = []
    for drive in _logical_drives():
        if _get_drive_type(drive) != DRIVE_REMOTE:
            continue
        base = Path(drive)
        found_named = False
        for sub in PROFILE_SUBDIRS:
            candidate = base / sub
            if candidate.is_dir():
                roots.append(candidate)
                found_named = True
        if not found_named and depth_fallback and base.exists():
            roots.append(base)
    return roots


def iter_removable_roots() -> List[Path]:
    roots: List[Path] = []
    for drive in _logical_drives():
        if _get_drive_type(drive) == DRIVE_REMOVABLE:
            path = Path(drive)
            if path.exists():
                roots.append(path)
    return roots


def classify_path(path: str | Path) -> str:
    """Return usb | network | local | unknown."""
    text = str(path or "").strip()
    if not text:
        return "unknown"
    if text.startswith("\\\\"):
        return "network"
    try:
        drive = os.path.splitdrive(text)[0]
        if drive:
            root = drive + "\\"
            dtype = _get_drive_type(root)
            if dtype == DRIVE_REMOVABLE:
                return "usb"
            if dtype == DRIVE_REMOTE:
                return "network"
            if dtype == DRIVE_FIXED:
                return "local"
    except Exception:
        pass
    return "unknown"


def should_ignore_path(path: str | Path) -> bool:
    normalized = str(path or "").replace("/", "\\").lower()
    if not normalized:
        return True
    name = Path(normalized).name
    if name in {".", ".."}:
        return True
    if name.startswith("~$"):
        return True
    for fragment in IGNORE_NAME_FRAGMENTS:
        if fragment in normalized:
            return True
    if "\\system volume information" in normalized or normalized.endswith("\\$recycle.bin"):
        return True
    return False


def unique_existing(paths: Iterable[Path]) -> List[Path]:
    seen: Set[str] = set()
    out: List[Path] = []
    for path in paths:
        try:
            resolved = str(path.resolve()) if path.exists() else str(path)
        except OSError:
            resolved = str(path)
        key = resolved.lower()
        if key in seen:
            continue
        seen.add(key)
        if path.exists():
            out.append(path)
    return out
