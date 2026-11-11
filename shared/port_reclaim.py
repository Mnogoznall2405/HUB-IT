"""Reclaim a listen port from a stale sibling process on Windows.

PM2 on Windows occasionally records a fork-mode child as exited while the
process keeps running and holding its port; every respawn then crashes on
bind (EADDRINUSE) until the restart budget is exhausted. Affected launchers
self-heal at startup: if the port is held by a process whose command line
references the same launcher (``marker``), terminate it and wait for the port
to free. Processes that do not match the marker keep the port and startup
fails on bind exactly as before — this never kills an unrelated service.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time


def _try_bind(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _listeners_on_port(port: int) -> set[int]:
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"],
            capture_output=True, text=True, timeout=30,
        )
    except Exception:
        return set()
    pids: set[int] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[3] != "LISTENING":
            continue
        if parts[1].rsplit(":", 1)[-1] != str(port):
            continue
        try:
            pid = int(parts[4])
        except ValueError:
            continue
        if pid > 0 and pid not in (os.getpid(), os.getppid()):
            pids.add(pid)
    return pids


def _process_command_line(pid: int) -> str:
    try:
        result = subprocess.run(
            [
                "powershell", "-NoProfile", "-Command",
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine",
            ],
            capture_output=True, text=True, timeout=20,
        )
    except Exception:
        return ""
    return result.stdout or ""


def reclaim_port_from_stale_sibling(host: str, port: int, marker: str) -> None:
    """Terminate a stale sibling holding ``host:port`` and wait for it to free.

    ``marker`` must uniquely identify this launcher's command line, e.g.
    ``"start_server.py"`` or ``"-m voice_server"``. No-op off Windows, when the
    port is already free, or when the holder's command line lacks the marker.
    """
    if sys.platform != "win32" or _try_bind(host, port):
        return
    killed = False
    for pid in sorted(_listeners_on_port(port)):
        if marker in _process_command_line(pid):
            print(f"Port {port} held by stale sibling pid={pid} ({marker}); terminating", flush=True)
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True, timeout=30,
            )
            killed = True
        else:
            print(f"Port {port} held by unrelated pid={pid}; leaving it", flush=True)
    if not killed:
        return
    deadline = time.monotonic() + 10
    while not _try_bind(host, port) and time.monotonic() < deadline:
        time.sleep(0.2)
