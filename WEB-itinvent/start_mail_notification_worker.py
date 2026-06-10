"""Start the standalone mail notification poller."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import sys
from pathlib import Path

from sqlalchemy import text

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

from backend.chat.db import get_chat_engine, initialize_chat_schema
from backend.services.app_push_service import app_push_service
from backend.services.mail_notification_service import mail_notification_service


logger = logging.getLogger("backend.mail.notifications")


def _advisory_lock_key(scope: str) -> int:
    raw = hashlib.sha256(scope.encode("utf-8")).digest()[:8]
    return int.from_bytes(raw, byteorder="big", signed=False) & 0x7FFF_FFFF_FFFF_FFFF


def _acquire_worker_lock():
    engine = get_chat_engine()
    if engine.dialect.name != "postgresql":
        return None
    connection = engine.connect()
    acquired = connection.execute(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": _advisory_lock_key("mail-notifications:worker")},
    ).scalar()
    connection.commit()
    if not acquired:
        connection.close()
        raise RuntimeError("Another mail notification worker already owns the database lock")
    return connection


async def _main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    mail_enabled = str(os.getenv("MAIL_MODULE_ENABLED", "1") or "").strip().lower() in {"1", "true", "yes", "on"}
    if not mail_enabled:
        raise RuntimeError("Mail notification worker requires MAIL_MODULE_ENABLED=1")

    initialize_chat_schema()
    worker_lock = _acquire_worker_lock()
    push_config = app_push_service.get_public_config()
    logger.info(
        "Starting mail notification worker: poll_interval_sec=%s batch_size=%s max_concurrency=%s push_enabled=%s",
        mail_notification_service.poll_interval_sec,
        mail_notification_service.batch_size,
        mail_notification_service.max_concurrency,
        bool(push_config.get("enabled")),
    )

    await mail_notification_service.start()
    wait_forever = asyncio.Event()
    try:
        await wait_forever.wait()
    finally:
        await mail_notification_service.stop()
        if worker_lock is not None:
            worker_lock.close()


if __name__ == "__main__":
    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        logger.info("mail.notification.worker stopped by signal")
