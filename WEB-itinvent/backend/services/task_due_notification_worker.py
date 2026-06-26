"""Background worker for task due/overdue in-app and email notifications."""
from __future__ import annotations

import asyncio
import logging
import os

from backend.services.hub_service import hub_service

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_SECONDS = 600
DEFAULT_STARTUP_DELAY_SECONDS = 60


def _env_positive_int(name: str, default: int, minimum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), int(minimum))
    except Exception:
        return max(int(default), int(minimum))


def background_enabled() -> bool:
    return str(os.getenv("TASK_DUE_NOTIFICATION_BACKGROUND_ENABLED", "1")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


async def background_task_due_notification_loop() -> None:
    interval = _env_positive_int("TASK_DUE_NOTIFICATION_INTERVAL_SECONDS", DEFAULT_INTERVAL_SECONDS, 60)
    startup_delay = _env_positive_int("TASK_DUE_NOTIFICATION_STARTUP_DELAY_SECONDS", DEFAULT_STARTUP_DELAY_SECONDS, 0)
    if startup_delay > 0:
        await asyncio.sleep(startup_delay)
    while True:
        try:
            processed = await asyncio.to_thread(hub_service.run_task_due_notification_cycle)
            logger.info("Task due notification cycle finished: users=%s", processed)
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Task due notification loop cancelled")
            break
        except Exception as exc:
            logger.error("Task due notification loop failed: %s", exc)
            await asyncio.sleep(300)
