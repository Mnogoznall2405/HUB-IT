"""
Start uvicorn for the backend on Windows using SelectorEventLoopPolicy.
"""
import os
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

if __name__ == "__main__":
    backend_host = os.getenv("BACKEND_HOST", "127.0.0.1")
    backend_port = int(os.getenv("BACKEND_PORT", "8001"))
    uvicorn.run(
        "backend.main:app",
        host=backend_host,
        port=backend_port,
        ws_per_message_deflate=False,
        loop="backend.uvicorn_loops:windows_selector_loop_factory",
        reload=False,
    )
