"""Start the standalone chat push outbox worker."""
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

from backend.chat.push_outbox_service import chat_push_outbox_service
from backend.chat.push_service import chat_push_service
from backend.chat.service import chat_service


logger = logging.getLogger("backend.chat.push_outbox")


async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    chat_status = chat_service.initialize_runtime(force=True)
    push_status = chat_push_service.get_runtime_status()
    print(
        "Starting chat push worker:"
        f" chat_enabled={chat_status.enabled}"
        f" chat_configured={chat_status.configured}"
        f" chat_available={chat_status.available}"
        f" outbox_enabled={chat_push_outbox_service.enabled}"
        f" push_enabled={push_status['enabled']}"
        f" push_configured={push_status['configured']}",
        flush=True,
    )

    await chat_push_outbox_service.start()
    wait_forever = asyncio.Event()
    try:
        await wait_forever.wait()
    finally:
        await chat_push_outbox_service.stop()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        logger.info("chat.push_outbox.worker stopped by signal")
