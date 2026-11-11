"""Background sync for AD groups access matrix snapshot."""
from __future__ import annotations

import asyncio
import logging
import os

from backend.services.ad_groups_access_service import sync_snapshot

logger = logging.getLogger("ad_groups_access_sync")

if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _sync_interval_seconds() -> int:
    raw = str(os.getenv("AD_GROUPS_ACCESS_SYNC_INTERVAL_SECONDS", "86400") or "").strip()
    try:
        return max(int(raw), 300)
    except (TypeError, ValueError):
        return 86400


async def background_ad_groups_access_sync_loop() -> None:
    """Refresh AD groups access snapshot once per day."""
    interval = _sync_interval_seconds()
    await asyncio.sleep(120)

    while True:
        try:
            logger.info("Starting scheduled AD groups access sync...")
            result = await asyncio.to_thread(sync_snapshot)
            status = str(result.get("status") or "")
            if status == "already_running":
                logger.info("Scheduled AD groups access sync skipped: already running")
            elif status == "disabled":
                logger.info("Scheduled AD groups access sync skipped: disabled")
            elif status == "error":
                logger.error("Scheduled AD groups access sync failed: %s", result.get("message"))
            else:
                logger.info(
                    "Scheduled AD groups access sync finished: groups=%s users=%s",
                    (result.get("summary") or {}).get("group_count"),
                    (result.get("summary") or {}).get("user_count"),
                )
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("AD groups access sync loop cancelled")
            break
        except Exception as exc:
            logger.error("Error in AD groups access sync loop: %s", exc)
            await asyncio.sleep(300)
