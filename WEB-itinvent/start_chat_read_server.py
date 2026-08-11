"""Diagnostic Chat Read API (HTTP list/history/bootstrap only, no WebSocket/outbox).

Port default 8003. Used to prove/disprove Realtime vs Read process split.
"""
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    import asyncio

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

_web_root = Path(__file__).resolve().parent
_project_root = _web_root.parent
for _root in (_project_root, _web_root):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))
_env_path = _project_root / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_path, override=False)
    except ImportError:
        pass

os.environ.setdefault("HUBIT_RUNTIME_ROLE", "chat")
os.environ["CHAT_SURFACE"] = "read"
os.environ.setdefault("BACKEND_PORT", "8003")
os.environ.setdefault("CHAT_EVENT_OUTBOX_POLL_ENABLED", "0")
os.environ.setdefault("CHAT_UVICORN_ACCESS_LOG", "0")

# Reuse chat server bootstrap (port free + async logging + uvicorn).
from start_chat_server import _free_stale_port_on_windows  # noqa: E402
import uvicorn  # noqa: E402

if __name__ == "__main__":
    try:
        from backend.chat.async_logging import install_chat_async_logging

        install_chat_async_logging()
    except Exception as exc:
        print(f"[chat-read] async logging install failed: {exc}")
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8003"))
    _free_stale_port_on_windows(host, port)
    print(f"[chat-read] Starting Chat Read surface on {host}:{port}")
    uvicorn.run(
        "backend.chat_main:app",
        host=host,
        port=port,
        workers=1,
        ws_per_message_deflate=False,
        loop="backend.uvicorn_loops:windows_selector_loop_factory",
        reload=False,
        access_log=False,
    )
