"""One-shot operator tool: migrate existing DLP media bytea payloads to disk.

Usage:
    python start_dlp_media_backfill_worker.py            # dry-run report only
    python start_dlp_media_backfill_worker.py --execute  # migrate rows in batches

Requires DLP_MEDIA_STORAGE_DIR for --execute. Bounded by
DLP_MEDIA_BACKFILL_MAX_ROWS / DLP_MEDIA_BACKFILL_MAX_RUNTIME_SECONDS.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import threading
from pathlib import Path

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

from backend.appdb.db import initialize_app_schema, is_app_database_configured, ping_app_database
from backend.services.dlp_media_backfill_service import (
    BackfillConfig,
    get_dlp_media_backfill_service,
)

logger = logging.getLogger("backend.dlp.media.backfill.worker")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DLP media bytea->disk backfill")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run report")
    parser.add_argument("--execute", action="store_true", help="Migrate rows to disk storage")
    return parser.parse_args()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    if not is_app_database_configured():
        logger.warning("APP_DATABASE_URL not configured; backfill needs the app database")
        return 1
    initialize_app_schema()
    ping_app_database()

    cfg = BackfillConfig.from_env()
    dry_run = True if args.dry_run else (False if args.execute else cfg.dry_run)
    logger.info(
        "DLP media backfill: dry_run=%s storage_dir=%s batch_size=%s max_rows=%s max_runtime_s=%s",
        dry_run,
        os.getenv("DLP_MEDIA_STORAGE_DIR", ""),
        cfg.batch_size,
        cfg.max_rows,
        cfg.max_runtime_seconds,
    )

    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except Exception:
        pass

    result = get_dlp_media_backfill_service().run_once(
        config=cfg,
        dry_run=dry_run,
        should_stop=stop_event.is_set,
    )
    logger.info(
        "dlp.media.backfill.done stop_reason=%s migrated=%s failed=%s bytes=%s batches=%s elapsed_ms=%s",
        result.get("stop_reason"),
        result.get("rows_migrated"),
        result.get("rows_failed"),
        result.get("bytes_migrated"),
        result.get("batches"),
        result.get("elapsed_ms"),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0 if result.get("stop_reason") not in {"error"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
