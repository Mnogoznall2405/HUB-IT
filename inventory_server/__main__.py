from __future__ import annotations

import asyncio
import sys

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

from .config import config


def main() -> None:
    uvicorn.run(
        "inventory_server.app:app",
        host=config.host,
        port=config.port,
        reload=False,
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
