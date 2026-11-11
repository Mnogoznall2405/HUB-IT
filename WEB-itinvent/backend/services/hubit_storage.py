"""Shared HUB-IT network storage helper (SMB/UNC).

Credentials come only from HUBIT_STORAGE_* env vars. Passwords are never logged.
Designed for reuse by my_files now and chat/other attachments later.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path, PureWindowsPath
from typing import Any

logger = logging.getLogger("backend.services.hubit_storage")

_ERROR_SUCCESS = 0
_ERROR_ALREADY_ASSIGNED = 85
_ERROR_ACCESS_DENIED = 5
_ERROR_BAD_NET_NAME = 67
_ERROR_BAD_NETPATH = 53
_ERROR_LOGON_FAILURE = 1326
_ERROR_SESSION_CREDENTIAL_CONFLICT = 1219
_ERROR_NO_NET_OR_BAD_PATH = 1203
_ERROR_BAD_USERNAME = 2202
_ERROR_NOT_CONNECTED = 2250


class HubitStorageErrorCode(str, Enum):
    NOT_CONFIGURED = "not_configured"
    AUTH_FAILURE = "auth_failure"
    NETWORK_UNAVAILABLE = "network_unavailable"
    ACCESS_DENIED = "access_denied"
    SHARE_NOT_FOUND = "share_not_found"
    TEMPORARY_IO = "temporary_io"
    INSUFFICIENT_SPACE = "insufficient_space"
    UNKNOWN = "unknown"


class HubitStorageError(RuntimeError):
    def __init__(self, message: str, *, code: HubitStorageErrorCode = HubitStorageErrorCode.UNKNOWN) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class HubitStorageHealth:
    configured: bool
    connected: bool
    writable: bool
    latency_ms: float | None
    free_bytes: int | None
    total_bytes: int | None
    usage_pct: float | None
    last_error: str
    last_error_code: str


_LOCK = threading.RLock()
_CONNECTED_SHARES: set[str] = set()
_LAST_ERROR = ""
_LAST_ERROR_CODE = HubitStorageErrorCode.UNKNOWN.value
_LAST_LATENCY_MS: float | None = None


def _env(name: str) -> str:
    return str(os.getenv(name, "") or "").strip()


def storage_unc() -> str:
    return _env("HUBIT_STORAGE_UNC").rstrip("\\/")


def storage_username() -> str:
    return _env("HUBIT_STORAGE_USERNAME")


def storage_password() -> str:
    return _env("HUBIT_STORAGE_PASSWORD")


def is_configured() -> bool:
    return bool(storage_unc() and storage_username() and storage_password())


def _share_root_from_path(path: str | Path) -> str:
    text = str(path or "").replace("/", "\\")
    if not text.startswith("\\\\"):
        return ""
    pure = PureWindowsPath(text)
    drive = str(pure.drive).rstrip("\\")
    if drive.startswith("\\\\"):
        return drive
    parts = [part for part in text.split("\\") if part]
    if len(parts) >= 2:
        return f"\\\\{parts[0]}\\{parts[1]}"
    return ""


def _classify_win_error(code: int) -> HubitStorageErrorCode:
    if code in {_ERROR_LOGON_FAILURE, _ERROR_BAD_USERNAME}:
        return HubitStorageErrorCode.AUTH_FAILURE
    if code in {_ERROR_ACCESS_DENIED}:
        return HubitStorageErrorCode.ACCESS_DENIED
    if code in {_ERROR_BAD_NET_NAME, _ERROR_BAD_NETPATH}:
        return HubitStorageErrorCode.SHARE_NOT_FOUND
    if code in {_ERROR_NO_NET_OR_BAD_PATH, _ERROR_NOT_CONNECTED}:
        return HubitStorageErrorCode.NETWORK_UNAVAILABLE
    if code == _ERROR_SESSION_CREDENTIAL_CONFLICT:
        return HubitStorageErrorCode.AUTH_FAILURE
    return HubitStorageErrorCode.TEMPORARY_IO


def _record_error(message: str, code: HubitStorageErrorCode) -> None:
    global _LAST_ERROR, _LAST_ERROR_CODE
    _LAST_ERROR = str(message or "")[:500]
    _LAST_ERROR_CODE = code.value


def _server_unc_from_share(share: str) -> str:
    text = str(share or "").replace("/", "\\").rstrip("\\")
    parts = [part for part in text.split("\\") if part]
    if not parts:
        return ""
    return f"\\\\{parts[0]}"


def _disconnect_windows_share(share: str, *, force: bool = True) -> int:
    import ctypes
    from ctypes import wintypes

    mpr = ctypes.WinDLL("mpr", use_last_error=True)
    mpr.WNetCancelConnection2W.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.BOOL,
    )
    mpr.WNetCancelConnection2W.restype = wintypes.DWORD
    result = int(mpr.WNetCancelConnection2W(str(share), 0, bool(force)))
    if result not in {_ERROR_SUCCESS, _ERROR_NOT_CONNECTED}:
        logger.warning("hubit storage disconnect share=%s code=%s", share, result)
    return result


def _probe_share_writable(share: str) -> bool:
    root = Path(share)
    try:
        if not root.exists():
            return False
        probe = root / f".hubit_conn_probe_{os.getpid()}_{int(time.time())}.tmp"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def _connect_windows_share(*, share: str, username: str, password: str) -> None:
    import ctypes
    from ctypes import wintypes

    class NetResourceW(ctypes.Structure):
        _fields_ = (
            ("dwScope", wintypes.DWORD),
            ("dwType", wintypes.DWORD),
            ("dwDisplayType", wintypes.DWORD),
            ("dwUsage", wintypes.DWORD),
            ("lpLocalName", wintypes.LPWSTR),
            ("lpRemoteName", wintypes.LPWSTR),
            ("lpComment", wintypes.LPWSTR),
            ("lpProvider", wintypes.LPWSTR),
        )

    mpr = ctypes.WinDLL("mpr", use_last_error=True)
    mpr.WNetAddConnection2W.argtypes = (
        ctypes.POINTER(NetResourceW),
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
    )
    mpr.WNetAddConnection2W.restype = wintypes.DWORD

    def _add_connection() -> int:
        resource = NetResourceW()
        resource.dwType = 1
        resource.lpRemoteName = str(share)
        return int(mpr.WNetAddConnection2W(ctypes.byref(resource), password, username, 0))

    result = _add_connection()
    if result in {_ERROR_SUCCESS, _ERROR_ALREADY_ASSIGNED}:
        return
    if result == _ERROR_SESSION_CREDENTIAL_CONFLICT:
        logger.warning(
            "hubit storage credential conflict 1219; disconnect and retry share=%s",
            share,
        )
        _disconnect_windows_share(share, force=True)
        server = _server_unc_from_share(share)
        if server and server.casefold() != str(share).casefold():
            _disconnect_windows_share(server, force=True)
        result = _add_connection()
        if result in {_ERROR_SUCCESS, _ERROR_ALREADY_ASSIGNED}:
            return
        if result == _ERROR_SESSION_CREDENTIAL_CONFLICT and _probe_share_writable(share):
            # Conflict remains at OS level, but the share is writable for this process.
            logger.warning(
                "hubit storage 1219 unresolved after reconnect; share writable share=%s",
                share,
            )
            return
        raise HubitStorageError(
            "Конфликт учётных данных SMB (1219): уже есть другое подключение к серверу",
            code=HubitStorageErrorCode.AUTH_FAILURE,
        )
    raise HubitStorageError(
        f"Не удалось подключить сетевое хранилище HUB-IT (код {result})",
        code=_classify_win_error(result),
    )


def ensure_connected(path: str | Path | None = None) -> str:
    """Ensure SMB session for HUBIT_STORAGE_UNC (or share owning path). Returns share root."""
    global _LAST_LATENCY_MS
    if os.name != "nt":
        raise HubitStorageError(
            "Подключение к HUB-IT SMB поддерживается только на Windows",
            code=HubitStorageErrorCode.NETWORK_UNAVAILABLE,
        )
    if not is_configured():
        raise HubitStorageError(
            "HUBIT_STORAGE_* не настроены",
            code=HubitStorageErrorCode.NOT_CONFIGURED,
        )
    unc = storage_unc()
    share = _share_root_from_path(path) if path else _share_root_from_path(unc)
    if not share:
        share = _share_root_from_path(unc)
    if not share:
        raise HubitStorageError(
            "Не удалось определить SMB share из HUBIT_STORAGE_UNC",
            code=HubitStorageErrorCode.SHARE_NOT_FOUND,
        )
    share_key = share.casefold()
    with _LOCK:
        if share_key in _CONNECTED_SHARES:
            return share
        started = time.perf_counter()
        try:
            username = storage_username()
            if "\\" not in username and "@" not in username:
                server = share.lstrip("\\").split("\\", 1)[0]
                if server:
                    username = f"{server}\\{username}"
            _connect_windows_share(
                share=share,
                username=username,
                password=storage_password(),
            )
            _CONNECTED_SHARES.add(share_key)
            _LAST_LATENCY_MS = (time.perf_counter() - started) * 1000.0
            _record_error("", HubitStorageErrorCode.UNKNOWN)
            logger.info(
                "hubit storage connected share=%s latency_ms=%.1f",
                share,
                _LAST_LATENCY_MS or 0.0,
            )
            return share
        except HubitStorageError as exc:
            _record_error(str(exc), exc.code)
            raise
        except OSError as exc:
            win_code = int(getattr(exc, "winerror", getattr(exc, "errno", 0)) or 0)
            code = _classify_win_error(win_code) if win_code else HubitStorageErrorCode.TEMPORARY_IO
            err = HubitStorageError(
                "Ошибка подключения к сетевому хранилищу HUB-IT",
                code=code,
            )
            _record_error(str(err), code)
            raise err from None


def _space_via_get_disk_free_space_ex(path: str) -> tuple[int, int] | None:
    try:
        import ctypes

        free_bytes = ctypes.c_ulonglong(0)
        total_bytes = ctypes.c_ulonglong(0)
        total_free_bytes = ctypes.c_ulonglong(0)
        ok = ctypes.windll.kernel32.GetDiskFreeSpaceExW(
            ctypes.c_wchar_p(path),
            ctypes.byref(free_bytes),
            ctypes.byref(total_bytes),
            ctypes.byref(total_free_bytes),
        )
        if not ok:
            return None
        return int(free_bytes.value), int(total_bytes.value)
    except Exception:
        return None


def get_space(path: str | Path | None = None) -> tuple[int | None, int | None, float | None]:
    target = str(path or storage_unc() or "")
    if not target:
        return None, None, None
    try:
        ensure_connected(target)
    except HubitStorageError:
        return None, None, None
    measured = _space_via_get_disk_free_space_ex(target)
    if measured is None:
        return None, None, None
    free_bytes, total_bytes = measured
    usage = None
    if total_bytes > 0:
        usage = max(0.0, min(100.0, (1.0 - (free_bytes / total_bytes)) * 100.0))
    return free_bytes, total_bytes, usage


def ensure_free_space(required_bytes: int, *, path: str | Path | None = None) -> None:
    needed = max(0, int(required_bytes or 0))
    if needed <= 0:
        return
    free_bytes, _total, _usage = get_space(path)
    if free_bytes is None:
        logger.warning("hubit storage free-space check unavailable required_bytes=%s", needed)
        return
    cushion = max(8 * 1024 * 1024, needed // 20)
    if free_bytes < needed + cushion:
        raise HubitStorageError(
            "Недостаточно места на сетевом хранилище HUB-IT",
            code=HubitStorageErrorCode.INSUFFICIENT_SPACE,
        )


def probe_writable(path: str | Path | None = None) -> bool:
    root = Path(path or storage_unc())
    try:
        ensure_connected(root)
        root.mkdir(parents=True, exist_ok=True)
        probe = root / f".hubit_writable_probe_{os.getpid()}_{int(time.time())}.tmp"
        probe.write_bytes(b"ok")
        probe.unlink(missing_ok=True)
        return True
    except Exception as exc:
        code = HubitStorageErrorCode.TEMPORARY_IO
        if isinstance(exc, HubitStorageError):
            code = exc.code
        _record_error(str(exc), code)
        return False


def health(path: str | Path | None = None) -> HubitStorageHealth:
    configured = is_configured()
    free_bytes = total_bytes = usage_pct = None
    connected = False
    writable = False
    latency = _LAST_LATENCY_MS
    if configured:
        try:
            ensure_connected(path)
            connected = True
            free_bytes, total_bytes, usage_pct = get_space(path)
            writable = probe_writable(path)
        except HubitStorageError:
            connected = False
            writable = False
    return HubitStorageHealth(
        configured=configured,
        connected=connected,
        writable=writable,
        latency_ms=latency,
        free_bytes=free_bytes,
        total_bytes=total_bytes,
        usage_pct=usage_pct,
        last_error=_LAST_ERROR,
        last_error_code=_LAST_ERROR_CODE,
    )


def health_public_dict(path: str | Path | None = None) -> dict[str, Any]:
    item = health(path)
    return {
        "configured": item.configured,
        "connected": item.connected,
        "writable": item.writable,
        "latency_ms": item.latency_ms,
        "free_bytes": item.free_bytes,
        "total_bytes": item.total_bytes,
        "usage_pct": item.usage_pct,
        "last_error": item.last_error,
        "last_error_code": item.last_error_code,
    }


def reset_connection_state_for_tests() -> None:
    with _LOCK:
        _CONNECTED_SHARES.clear()
        _record_error("", HubitStorageErrorCode.UNKNOWN)
