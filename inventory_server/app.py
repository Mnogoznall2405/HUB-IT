from __future__ import annotations

import asyncio
import logging
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

project_root = Path(__file__).resolve().parent.parent
web_root = project_root / "WEB-itinvent"
if web_root.exists() and str(web_root) not in sys.path:
    sys.path.insert(0, str(web_root))

from fastapi import FastAPI, Header, HTTPException, status

from backend import inventory_runtime

from .config import config
from .database import InventoryQueueStore
from .worker import InventoryWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("inventory-server")

store = InventoryQueueStore(db_path=config.db_path)
stop_event = threading.Event()
worker = InventoryWorker(store=store, config=config, stop_event=stop_event)


def _key_fingerprint(value: Optional[str]) -> str:
    return inventory_runtime._api_key_fingerprint(value)


def _check_agent_key(x_api_key: Optional[str]) -> None:
    token = str(x_api_key or "").strip()
    if not token or token not in set(config.api_keys):
        logger.warning("Inventory ingest rejected unknown key fingerprint=%s", _key_fingerprint(token))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not worker.is_alive():
        stop_event.clear()
        worker.start()
    try:
        yield
    finally:
        stop_event.set()
        if worker.is_alive():
            worker.join(timeout=5)


app = FastAPI(title="Inventory Ingest Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    stats = store.queue_stats()
    return {
        "status": "ok" if worker.is_alive() else "degraded",
        "queue_depth": stats["queue_depth"],
        "oldest_queued_age_sec": stats["oldest_queued_age_sec"],
        "dead_letter_count": stats["dead_letter_count"],
        "worker_alive": worker.is_alive(),
        "last_successful_flush_at": worker.last_successful_flush_at,
    }


@app.post("/api/v1/inventory")
def receive_inventory(
    payload: inventory_runtime.InventoryPayload,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    payload_dict = inventory_runtime._model_dump(payload)
    dedupe_key = inventory_runtime.build_inventory_dedupe_key(payload_dict)
    queued = store.enqueue(payload_dict, dedupe_key)
    duplicate = bool(queued.get("duplicate"))
    return {
        "success": True,
        "queued": True,
        "duplicate": duplicate,
        "message": "Inventory accepted" if not duplicate else "Inventory already queued",
        "retry_after_sec": 0,
        "queue_id": queued.get("id"),
    }
