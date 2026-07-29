"""Start the loopback-only singleton 1C Document Management gateway."""
from __future__ import annotations

import os
import sys
from pathlib import Path


if sys.platform == "win32":
    import asyncio

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    try:
        from dotenv import load_dotenv

        load_dotenv(env_path, override=False)
    except ImportError:
        pass

os.environ["DOCFLOW_GATEWAY_PROCESS"] = "1"

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "backend.internal_docflow_gateway:app",
        host=str(os.getenv("DOCFLOW_GATEWAY_HOST", "127.0.0.1") or "127.0.0.1"),
        port=int(os.getenv("DOCFLOW_GATEWAY_PORT", "8013") or 8013),
        workers=1,
        loop="backend.uvicorn_loops:windows_selector_loop_factory",
        reload=False,
    )
