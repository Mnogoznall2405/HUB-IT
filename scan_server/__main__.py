from __future__ import annotations

import asyncio
import sys

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

from .app import app
from .config import config


def main() -> None:
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        reload=False,
        loop="scan_server.uvicorn_loops:windows_selector_loop_factory",
    )


if __name__ == "__main__":
    main()
