"""Background sync of Active Directory users into web application accounts."""
from __future__ import annotations

import asyncio
import logging
import os

from backend.services.ad_app_user_import_service import ad_app_user_import_service

logger = logging.getLogger("ad_app_user_sync")

if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _sync_interval_seconds() -> int:
    raw = str(os.getenv("LDAP_APP_USER_SYNC_INTERVAL_SECONDS", "86400") or "").strip()
    try:
        return max(int(raw), 300)
    except (TypeError, ValueError):
        return 86400


async def background_ad_app_user_sync_loop() -> None:
    """Run full AD → web-user sync periodically."""
    interval = _sync_interval_seconds()
    await asyncio.sleep(60)

    while True:
        try:
            logger.info("Starting scheduled AD app-user sync...")
            result = await asyncio.to_thread(ad_app_user_import_service.sync_all_from_ad)
            if result.get("status") == "already_running":
                logger.info("Scheduled AD app-user sync skipped: already running")
            elif result.get("status") == "error":
                logger.error("Scheduled AD app-user sync failed: %s", result.get("message"))
            elif result.get("status") == "warning":
                logger.warning("Scheduled AD app-user sync warning: %s", result.get("message"))
            else:
                logger.info(
                    "Scheduled AD app-user sync finished: created=%s updated=%s "
                    "deactivated=%s protected_admins=%s",
                    result.get("created"),
                    result.get("updated"),
                    result.get("deactivated"),
                    result.get("protected_admins"),
                )
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("AD app-user sync loop cancelled")
            break
        except Exception as exc:
            logger.error("Error in AD app-user sync loop: %s", exc)
            await asyncio.sleep(300)
