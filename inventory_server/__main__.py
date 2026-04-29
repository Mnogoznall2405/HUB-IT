from __future__ import annotations

import argparse
import asyncio
import json
import sys

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

from .config import config
from .database import InventoryQueueStore


def main() -> None:
    parser = argparse.ArgumentParser(description="IT-Invent inventory ingest server")
    parser.add_argument("--cleanup-now", action="store_true", help="Delete old done/dead inventory queue rows and exit")
    parser.add_argument("--vacuum", action="store_true", help="Run SQLite VACUUM after cleanup and exit; use only during off-hours")
    args = parser.parse_args()
    if args.cleanup_now or args.vacuum:
        store = InventoryQueueStore(db_path=config.db_path)
        result = {}
        if args.cleanup_now:
            result["cleanup"] = store.cleanup_retention(
                done_retention_days=config.done_retention_days,
                dead_retention_days=config.dead_retention_days,
            )
        if args.vacuum:
            result["vacuum"] = store.vacuum()
        print(json.dumps(result, ensure_ascii=False))
        return

    uvicorn.run(
        "inventory_server.app:app",
        host=config.host,
        port=config.port,
        reload=False,
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
