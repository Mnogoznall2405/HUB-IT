"""Start the standalone network monitoring collector (ICMP/SNMP probes outside the API process)."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    print(f"Using SelectorEventLoop (Python {sys.version})")

_project_root = Path(__file__).resolve().parent.parent
_env_path = _project_root / ".env"
if _env_path.exists():
    print(f"Loading environment from {_env_path}")
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_path, override=False)
    except ImportError:
        with open(_env_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from backend.services.network_monitor_service import background_enabled, network_monitor_service

logger = logging.getLogger("backend.monitoring.worker")


async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if not background_enabled():
        raise RuntimeError("Monitoring worker requires MONITORING_BACKGROUND_ENABLED=1")

    # The service takes the database advisory lease itself: a second worker stays idle instead of probing twice.
    logger.info("Starting monitoring worker")
    await network_monitor_service.start()
    try:
        await network_monitor_service.wait()
    finally:
        await network_monitor_service.stop()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        logger.info("monitoring.worker stopped by signal")
