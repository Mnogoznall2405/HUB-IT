"""Standalone Hub notifications retention worker (batch cleanup, advisory-locked)."""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading
import time
from pathlib import Path

from sqlalchemy import text

if sys.platform == "win32":
    try:
        import asyncio

        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

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

from backend.appdb.db import get_app_engine, initialize_app_schema, is_app_database_configured, ping_app_database
from backend.services.hub_notifications_retention_service import (
    RetentionConfig,
    hub_notifications_retention_service,
)


logger = logging.getLogger("backend.hub.notifications.retention.worker")


def _acquire_worker_lock():
    if not is_app_database_configured():
        return None
    engine = get_app_engine()
    if engine.dialect.name != "postgresql":
        return None
    connection = engine.connect()
    acquired = connection.execute(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": hub_notifications_retention_service.advisory_lock_key()},
    ).scalar()
    connection.commit()
    if not acquired:
        connection.close()
        raise RuntimeError("Another hub notifications retention worker already owns the database lock")
    return connection


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hub notifications retention worker")
    parser.add_argument("--once", action="store_true", help="Run a single cycle and exit")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run (no deletes)")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Force execute deletes for this process (still requires CLEANUP_ENABLED unless --force)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow execute even when HUB_NOTIFICATIONS_CLEANUP_ENABLED=false (ops only)",
    )
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    if not is_app_database_configured():
        # SQLite/dev: allow --once dry-run against local hub sqlite via hub_service fallback.
        logger.warning("APP_DATABASE_URL not configured; retention worker limited to local hub store")
    else:
        initialize_app_schema()
        ping_app_database()

    cfg = RetentionConfig.from_env()
    dry_run = True if args.dry_run else (False if args.execute else cfg.dry_run)
    logger.info(
        "Starting hub notifications retention worker: enabled=%s dry_run=%s batch_size=%s "
        "max_batches=%s max_runtime_s=%s interval_s=%s chat_days=%s task_days=%s announcement_days=%s allow_unread=%s",
        cfg.enabled,
        dry_run,
        cfg.batch_size,
        cfg.max_batches,
        cfg.max_runtime_seconds,
        cfg.interval_seconds,
        cfg.chat_read_retention_days,
        cfg.task_read_retention_days,
        cfg.announcement_read_retention_days,
        cfg.allow_unread,
    )

    worker_lock = None
    if not dry_run:
        worker_lock = _acquire_worker_lock()

    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except Exception:
        pass

    if not args.once and cfg.startup_delay_seconds > 0:
        logger.info(
            "hub.notifications.retention.startup_delay_s=%s",
            cfg.startup_delay_seconds,
        )
        stop_event.wait(cfg.startup_delay_seconds)

    try:
        while not stop_event.is_set():
            cfg = RetentionConfig.from_env()
            if args.execute:
                dry_run = False
            elif args.dry_run:
                dry_run = True
            else:
                dry_run = cfg.dry_run

            # Continuous mode: do not burn COUNT/EXPLAIN cycles while cleanup is disabled.
            if not args.once and not cfg.enabled and not args.dry_run and not args.execute:
                logger.info(
                    "hub.notifications.retention.idle enabled=false interval_s=%s",
                    cfg.interval_seconds,
                )
                stop_event.wait(cfg.interval_seconds)
                continue

            result = hub_notifications_retention_service.run_once(
                config=cfg,
                dry_run=dry_run,
                acquire_lock=worker_lock is None,  # process lock already held
                force_enabled=bool(args.force or args.execute),
                should_stop=stop_event.is_set,
            )
            logger.info(
                "hub.notifications.retention.cycle stop_reason=%s deleted=%s batches=%s elapsed_ms=%s",
                result.get("stop_reason"),
                result.get("rows_deleted") or result.get("eligible_rows_exact"),
                result.get("batches"),
                result.get("elapsed_ms"),
            )
            if args.once:
                print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
                return 0
            stop_event.wait(cfg.interval_seconds)
    finally:
        if worker_lock is not None:
            try:
                worker_lock.execute(
                    text("SELECT pg_advisory_unlock(:lock_key)"),
                    {"lock_key": hub_notifications_retention_service.advisory_lock_key()},
                )
                worker_lock.commit()
            except Exception:
                logger.warning("Failed to release process advisory lock", exc_info=True)
            worker_lock.close()
        logger.info("hub notifications retention worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
