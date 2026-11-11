"""Publishes scheduled feed entries exactly once and fans notifications out after commit."""
from __future__ import annotations

import asyncio
import logging
import os

from backend.services.hub_service import hub_service


logger = logging.getLogger(__name__)


def background_enabled() -> bool:
    return str(os.getenv("ANNOUNCEMENT_PUBLISH_BACKGROUND_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}


async def background_announcement_publish_loop() -> None:
    raw_interval = str(os.getenv("ANNOUNCEMENT_PUBLISH_INTERVAL_SECONDS", "30") or "30").strip()
    try:
        interval = max(10, int(raw_interval))
    except ValueError:
        interval = 30
    while True:
        try:
            published = await asyncio.to_thread(hub_service.publish_due_announcements)
            if published:
                logger.info("Scheduled feed publications released: count=%s", published)
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Scheduled feed publication loop cancelled")
            raise
        except Exception:
            logger.exception("Scheduled feed publication loop failed")
            await asyncio.sleep(interval)
