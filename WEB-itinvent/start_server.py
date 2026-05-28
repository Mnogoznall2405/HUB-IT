"""
Start uvicorn for the backend on Windows using SelectorEventLoopPolicy.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    import asyncio

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print(f"Using SelectorEventLoop (Python {sys.version})")

_project_root = Path(__file__).resolve().parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    print(f"Loading environment from {_env_path}")
    try:
        from dotenv import load_dotenv

        # Let PM2/system environment override .env values.
        load_dotenv(_env_path, override=False)
    except ImportError:
        with open(_env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

import uvicorn


def _listener_pids_on_port(port: int) -> set[int]:
    """Return PIDs listening on 127.0.0.1 or 0.0.0.0 for the given port."""
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except Exception:
        return set()

    pids: set[int] = set()
    # Match both 127.0.0.1:8001 and 0.0.0.0:8001 regardless of spacing.
    pattern = re.compile(
        rf":{port}\s+\S+\s+LISTENING\s+(\d+)$",
        re.I,
    )
    for line in result.stdout.splitlines():
        if "127.0.0.1" not in line and "0.0.0.0" not in line:
            continue
        match = pattern.search(line.strip())
        if match:
            pid = int(match.group(1))
            if pid > 0:
                pids.add(pid)
    return pids


def _kill_start_server_processes() -> None:
    """Terminate any python start_server.py (orphans after PM2 restart)."""
    if sys.platform != "win32":
        return
    try:
        result = subprocess.run(
            [
                "wmic",
                "process",
                "where",
                "name='python.exe'",
                "get",
                "ProcessId,CommandLine",
                "/format:csv",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except Exception:
        return

    current_pid = os.getpid()
    for line in result.stdout.splitlines():
        if "start_server.py" not in line:
            continue
        parts = line.rsplit(",", 1)
        if len(parts) != 2:
            continue
        pid_text = parts[1].strip().strip('"')
        if not pid_text.isdigit():
            continue
        pid = int(pid_text)
        if pid == current_pid:
            continue
        print(f"Killing orphan start_server.py (PID {pid})")
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            timeout=10,
            check=False,
        )


def _free_stale_port_on_windows(host: str, port: int) -> None:
    """Kill orphan listeners on our port before bind (PM2 restart leaves old python)."""
    if sys.platform != "win32":
        return
    if host not in ("127.0.0.1", "0.0.0.0", "localhost", ""):
        return

    _kill_start_server_processes()

    for attempt in range(3):
        stale_pids = _listener_pids_on_port(port) - {os.getpid()}
        if not stale_pids:
            break
        for pid in sorted(stale_pids):
            print(f"Freeing stale listener on port {port} (PID {pid}, attempt {attempt + 1})")
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=10,
                check=False,
            )
        if attempt < 2:
            import time

            time.sleep(1.5)


if __name__ == "__main__":
    backend_host = os.getenv("BACKEND_HOST", "127.0.0.1")
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    _free_stale_port_on_windows(backend_host, backend_port)
    uvicorn.run(
        "backend.main:app",
        host=backend_host,
        port=backend_port,
        workers=1,
        ws_per_message_deflate=False,
        loop="backend.uvicorn_loops:windows_selector_loop_factory",
        reload=False,
    )
