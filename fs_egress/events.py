from __future__ import annotations

import hashlib
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class FileLeftEvent:
    event_id: str
    ts: int
    channel: str  # usb | network | telegram | deleted
    file_name: str
    dest_path: str
    src_path: str = ""
    size: Optional[int] = None
    sha256: str = ""
    windows_user: str = ""
    computer_name: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def new_event_id() -> str:
    return uuid.uuid4().hex


_SKIP_PROFILE_NAMES = {
    "public",
    "default",
    "default user",
    "all users",
    "defaultapppool",
}


def user_from_profile_path(path: str | Path) -> str:
    """Extract Windows profile name from C:\\Users\\<name\\>..."""
    try:
        parts = Path(path).parts
    except Exception:
        return ""
    lowered = [str(p).lower() for p in parts]
    if "users" not in lowered:
        return ""
    idx = lowered.index("users")
    if idx + 1 >= len(parts):
        return ""
    name = str(parts[idx + 1]).strip()
    if not name or name.lower() in _SKIP_PROFILE_NAMES:
        return ""
    return name


def _interactive_windows_user() -> str:
    """Best-effort active console/RDP user when agent runs as SYSTEM."""
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        wtsapi = ctypes.windll.wtsapi32
        session_id = int(user32.WTSGetActiveConsoleSessionId())
        if session_id in {0xFFFFFFFF, -1}:
            return ""
        name_ptr = wintypes.LPWSTR()
        bytes_returned = wintypes.DWORD(0)
        # WTSUserName = 5
        if not wtsapi.WTSQuerySessionInformationW(
            None, session_id, 5, ctypes.byref(name_ptr), ctypes.byref(bytes_returned)
        ):
            return ""
        try:
            return str(name_ptr.value or "").strip()
        finally:
            wtsapi.WTSFreeMemory(name_ptr)
    except Exception:
        return ""


def host_identity(*, path_hint: str = "") -> tuple[str, str]:
    user = str(os.environ.get("USERNAME") or os.environ.get("USER") or "").strip()
    host = str(os.environ.get("COMPUTERNAME") or os.environ.get("HOSTNAME") or "").strip()
    # Scheduled Task runs as SYSTEM → USERNAME is often COMPUTER$ / SYSTEM.
    if (not user) or user.endswith("$") or user.lower() in {"system", "local service", "network service"}:
        from_path = user_from_profile_path(path_hint)
        if from_path:
            user = from_path
        else:
            interactive = _interactive_windows_user()
            if interactive:
                user = interactive
    return user, host


def maybe_sha256(path: Path, *, max_bytes: int = 2 * 1024 * 1024) -> str:
    try:
        size = path.stat().st_size
    except OSError:
        return ""
    if size <= 0 or size > max_bytes:
        return ""
    digest = hashlib.sha256()
    try:
        with path.open("rb") as fh:
            while True:
                chunk = fh.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return ""


def build_file_left(
    *,
    channel: str,
    dest_path: str,
    file_name: str = "",
    src_path: str = "",
    size: Optional[int] = None,
    compute_hash: bool = False,
    details: Optional[dict[str, Any]] = None,
) -> FileLeftEvent:
    dest = str(dest_path or "").strip()
    src = str(src_path or "").strip()
    name = str(file_name or "").strip() or Path(dest).name
    user, host = host_identity(path_hint=dest or src)
    sha = ""
    resolved_size = size
    path = Path(dest) if dest else None
    if path is not None and path.is_file():
        try:
            if resolved_size is None:
                resolved_size = int(path.stat().st_size)
        except OSError:
            pass
        if compute_hash:
            sha = maybe_sha256(path)
    return FileLeftEvent(
        event_id=new_event_id(),
        ts=int(time.time()),
        channel=channel,
        file_name=name,
        dest_path=dest,
        src_path=src,
        size=resolved_size,
        sha256=sha,
        windows_user=user,
        computer_name=host,
        details=dict(details or {}),
    )
