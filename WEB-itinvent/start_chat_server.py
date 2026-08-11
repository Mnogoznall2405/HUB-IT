"""
Start uvicorn for the Chat API on Windows using SelectorEventLoopPolicy.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    import asyncio

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print(f"[chat] Using SelectorEventLoop (Python {sys.version})")

_project_root = Path(__file__).resolve().parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))
_env_path = _project_root / ".env"
if _env_path.exists():
    print(f"Loading environment from {_env_path}")
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_path, override=False)
    except ImportError:
        with open(_env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

# Force chat process role before importing the app.
os.environ.setdefault("HUBIT_RUNTIME_ROLE", "chat")
os.environ.setdefault("BACKEND_PORT", "8002")


_RUNTIME_ENV_PROTECTED_KEYS = frozenset(
    {
        "HUBIT_RUNTIME_ROLE",
        "CHAT_RUNTIME_ROLE",
        "BACKEND_HOST",
        "BACKEND_PORT",
        "CHAT_REALTIME_NODE_ID",
        "CHAT_REALTIME_TRANSPORT",
        "CHAT_REALTIME_REQUIRED",
        "CHAT_REDIS_REQUIRED",
        "CHAT_PROCESS_COUNT",
        "REDIS_URL",
        "REDIS_PASSWORD",
    }
)


def _apply_runtime_env_overlay(overlay: dict) -> tuple[list[str], list[str]]:
    """Apply profiling knobs without changing node identity or realtime safety."""
    applied: list[str] = []
    skipped: list[str] = []
    for key, value in overlay.items():
        normalized_key = str(key).strip()
        if not normalized_key or value is None:
            continue
        if normalized_key.upper() in _RUNTIME_ENV_PROTECTED_KEYS:
            skipped.append(normalized_key)
            continue
        os.environ[normalized_key] = str(value)
        applied.append(normalized_key)
    return applied, skipped


# Optional hot runtime env from profiling (tmp/chat-runtime-env.json).
_runtime_env = _project_root / "tmp" / "chat-runtime-env.json"
if _runtime_env.exists():
    try:
        import json as _json

        overlay = _json.loads(_runtime_env.read_text(encoding="utf-8"))
        if isinstance(overlay, dict):
            applied_keys, skipped_keys = _apply_runtime_env_overlay(overlay)
            print(f"[chat] Applied runtime env overlay from {_runtime_env}: {applied_keys}")
            if skipped_keys:
                print(f"[chat] Ignored protected runtime env keys: {skipped_keys}")
    except Exception as exc:
        print(f"[chat] runtime env overlay ignored: {exc}")

import uvicorn


def _listener_pids_on_port(port: int) -> set[int]:
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
    pattern = re.compile(rf":{port}\s+\S+\s+LISTENING\s+(\d+)$", re.I)
    for line in result.stdout.splitlines():
        if "127.0.0.1" not in line and "0.0.0.0" not in line:
            continue
        match = pattern.search(line.strip())
        if match:
            pid = int(match.group(1))
            if pid > 0:
                pids.add(pid)
    return pids


def _free_stale_port_on_windows(host: str, port: int) -> None:
    if sys.platform != "win32":
        return
    if host not in ("127.0.0.1", "0.0.0.0", "localhost", ""):
        return

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
    backend_port = int(os.getenv("BACKEND_PORT", "8002"))
    _free_stale_port_on_windows(backend_host, backend_port)
    # Install QueueHandler before uvicorn binds loggers (non-blocking MainThread I/O).
    try:
        from backend.chat.async_logging import install_chat_async_logging

        install_chat_async_logging()
    except Exception as exc:
        print(f"[chat] async logging install failed: {exc}")
    access_log = str(os.getenv("CHAT_UVICORN_ACCESS_LOG", "1") or "1").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    uvicorn.run(
        "backend.chat_main:app",
        host=backend_host,
        port=backend_port,
        workers=1,
        ws_per_message_deflate=False,
        loop="backend.uvicorn_loops:windows_selector_loop_factory",
        reload=False,
        access_log=access_log,
    )
