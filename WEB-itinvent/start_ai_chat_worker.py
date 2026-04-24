from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
import sys

project_root = Path(__file__).resolve().parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from backend.ai_chat.service import ai_chat_service


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_chat_worker")


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = float(raw)
    except Exception:
        value = float(default)
    return max(minimum, min(maximum, value))


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = int(raw)
    except Exception:
        value = int(default)
    return max(minimum, min(maximum, value))


async def main() -> None:
    ai_chat_service.initialize_runtime()
    logger.info("AI chat worker started")
    idle_delay_sec = _env_float("AI_CHAT_WORKER_IDLE_DELAY_SEC", 0.5, 0.05, 30.0)
    busy_delay_sec = _env_float("AI_CHAT_WORKER_BUSY_DELAY_SEC", 0.1, 0.01, 10.0)
    batch_size = _env_int("AI_CHAT_WORKER_BATCH_SIZE", 4, 1, 32)
    while True:
        try:
            processed = await asyncio.to_thread(ai_chat_service.process_next_runs, limit=batch_size)
        except Exception:
            logger.exception("AI chat worker cycle failed")
            await asyncio.sleep(3.0)
            continue
        await asyncio.sleep(busy_delay_sec if int(processed or 0) > 0 else idle_delay_sec)


if __name__ == "__main__":
    asyncio.run(main())
