from __future__ import annotations

import logging
import sys
import threading
import time
from pathlib import Path
from typing import Optional

project_root = Path(__file__).resolve().parent.parent
web_root = project_root / "WEB-itinvent"
if web_root.exists() and str(web_root) not in sys.path:
    sys.path.insert(0, str(web_root))

from backend import inventory_runtime

from .config import InventoryServerConfig
from .database import InventoryQueueStore

logger = logging.getLogger("inventory-server")


class InventoryWorker(threading.Thread):
    def __init__(
        self,
        *,
        store: InventoryQueueStore,
        config: InventoryServerConfig,
        stop_event: threading.Event,
    ) -> None:
        super().__init__(name="inventory-worker", daemon=True)
        self.store = store
        self.config = config
        self.stop_event = stop_event
        self.last_successful_flush_at: Optional[int] = None

    def _next_backoff(self, attempt_count: int) -> int:
        return min(int(self.config.backoff_cap_sec), max(1, 2 ** max(0, attempt_count - 1)))

    def _handle_item(self, item: dict) -> None:
        queue_id = str(item.get("id") or "")
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        attempt_count = int(item.get("attempt_count") or 0) + 1
        try:
            inventory_runtime.process_inventory_payload(payload)
        except Exception as exc:
            error_text = str(exc or exc.__class__.__name__)[:4000]
            if attempt_count >= int(self.config.max_attempts):
                self.store.mark_dead(
                    queue_id,
                    error_text=error_text,
                    processed_at=int(time.time()),
                    attempt_count=attempt_count,
                )
                logger.error("Inventory queue item moved to dead-letter id=%s error=%s", queue_id, error_text)
                return

            next_attempt_at = int(time.time()) + self._next_backoff(attempt_count)
            self.store.mark_retry(
                queue_id,
                error_text=error_text,
                next_attempt_at=next_attempt_at,
                attempt_count=attempt_count,
            )
            logger.warning("Inventory queue item retry scheduled id=%s attempt=%s error=%s", queue_id, attempt_count, error_text)
            return

        self.store.mark_done(queue_id, processed_at=int(time.time()))
        self.last_successful_flush_at = int(time.time())

    def run(self) -> None:
        logger.info("Inventory worker started")
        while not self.stop_event.is_set():
            batch = self.store.claim_next_batch(limit=int(self.config.batch_size))
            if not batch:
                self.stop_event.wait(float(self.config.worker_interval_sec))
                continue
            for item in batch:
                if self.stop_event.is_set():
                    break
                self._handle_item(item)
        logger.info("Inventory worker stopped")
