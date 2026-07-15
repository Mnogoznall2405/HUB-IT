from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
import sys

project_root = Path(__file__).resolve().parent
monorepo_root = project_root.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))
if str(monorepo_root) not in sys.path:
    sys.path.insert(0, str(monorepo_root))

_env_path = monorepo_root / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv

        # Let PM2/system environment override .env values.
        load_dotenv(_env_path, override=False)
    except ImportError:
        with open(_env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

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
    idle_delay_sec = _env_float("AI_CHAT_WORKER_IDLE_DELAY_SEC", 0.5, 0.05, 30.0)
    busy_delay_sec = _env_float("AI_CHAT_WORKER_BUSY_DELAY_SEC", 0.1, 0.01, 10.0)
    batch_size = _env_int("AI_CHAT_WORKER_BATCH_SIZE", 4, 1, 32)
    concurrency = _env_int("AI_CHAT_WORKER_CONCURRENCY", 2, 1, 16)
    logger.info("AI chat worker started: batch_size=%s concurrency=%s", batch_size, concurrency)
    while True:
        try:
            processed = 0
            remaining = batch_size
            while remaining > 0:
                wave_size = min(concurrency, remaining)
                results = await asyncio.gather(
                    *[
                        asyncio.to_thread(ai_chat_service.process_next_run)
                        for _ in range(wave_size)
                    ],
                    return_exceptions=True,
                )
                wave_processed = 0
                for result in results:
                    if isinstance(result, Exception):
                        logger.error("AI chat worker run failed", exc_info=(type(result), result, result.__traceback__))
                        continue
                    if bool(result):
                        wave_processed += 1
                processed += wave_processed
                remaining -= wave_size
                if wave_processed == 0:
                    break
        except Exception:
            logger.exception("AI chat worker cycle failed")
            await asyncio.sleep(3.0)
            continue
        await asyncio.sleep(busy_delay_sec if int(processed or 0) > 0 else idle_delay_sec)


if __name__ == "__main__":
    asyncio.run(main())
