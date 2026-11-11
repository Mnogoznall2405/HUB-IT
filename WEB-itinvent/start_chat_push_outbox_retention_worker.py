"""Standalone chat_push_outbox retention worker (batch cleanup, advisory-locked)."""
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

from backend.chat.db import ensure_chat_configured, initialize_chat_schema
from backend.chat.push_outbox_retention_service import (
    PushOutboxRetentionConfig,
    PushOutboxRetentionConfigError,
    chat_push_outbox_retention_service,
)


logger = logging.getLogger("backend.chat.push_outbox.retention.worker")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Chat push outbox retention worker")
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
        help="Allow execute even when CHAT_PUSH_OUTBOX_CLEANUP_ENABLED=false (ops only)",
    )
    return parser.parse_args()


def _requires_database_initialization(args: argparse.Namespace, config: PushOutboxRetentionConfig) -> bool:
    """Avoid schema work for a production-disabled maintenance worker."""
    return bool(args.once or args.dry_run or args.execute or config.enabled)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    try:
        cfg = PushOutboxRetentionConfig.from_env()
    except PushOutboxRetentionConfigError as exc:
        logger.error("Invalid retention configuration (fail-closed): %s", exc)
        return 2

    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _request_stop)
        signal.signal(signal.SIGINT, _request_stop)
    except Exception:
        pass

    if not _requires_database_initialization(args, cfg):
        logger.info(
            "Chat push outbox retention worker is disabled; skipping database initialization. interval_s=%s",
            cfg.interval_seconds,
        )
        while not stop_event.wait(cfg.interval_seconds):
            pass
        logger.info("chat push outbox retention worker stopped")
        return 0

    ensure_chat_configured()
    initialize_chat_schema()

    dry_run = True if args.dry_run else (False if args.execute else cfg.dry_run)
    logger.info(
        "Starting chat push outbox retention worker: enabled=%s dry_run=%s batch_size=%s "
        "max_batches=%s max_runtime_s=%s interval_s=%s "
        "days(no_sub/suppressed/sent/failed)=%s/%s/%s/%s failed_min_attempts=%s",
        cfg.enabled,
        dry_run,
        cfg.batch_size,
        cfg.max_batches,
        cfg.max_runtime_seconds,
        cfg.interval_seconds,
        cfg.no_subscriptions_days,
        cfg.suppressed_days,
        cfg.sent_days,
        cfg.failed_days,
        cfg.failed_min_attempts,
    )

    if not args.once and cfg.startup_delay_seconds > 0:
        logger.info(
            "chat.push_outbox.retention.startup_delay_s=%s",
            cfg.startup_delay_seconds,
        )
        stop_event.wait(cfg.startup_delay_seconds)

    # Advisory lock is owned exclusively inside run_once() on the same physical
    # connection used for all batch transactions (not a separate process-level conn).
    while not stop_event.is_set():
        try:
            cfg = PushOutboxRetentionConfig.from_env()
        except PushOutboxRetentionConfigError as exc:
            logger.error("chat.push_outbox.retention.config_invalid error=%s", exc)
            if args.once:
                return 2
            stop_event.wait(3600)
            continue

        if args.execute:
            dry_run = False
        elif args.dry_run:
            dry_run = True
        else:
            dry_run = cfg.dry_run

        # Continuous mode: idle while cleanup disabled (unless forced dry-run/execute flags).
        if not args.once and not cfg.enabled and not args.dry_run and not args.execute:
            logger.info(
                "chat.push_outbox.retention.idle enabled=false interval_s=%s",
                cfg.interval_seconds,
            )
            stop_event.wait(cfg.interval_seconds)
            continue

        result = chat_push_outbox_retention_service.run_once(
            config=cfg,
            dry_run=dry_run,
            acquire_lock=True,
            force_enabled=bool(args.force or args.execute),
            should_stop=stop_event.is_set,
        )
        logger.info(
            "chat.push_outbox.retention.cycle run_id=%s stop_reason=%s deleted=%s "
            "eligible=%s batches=%s elapsed_ms=%s lock_conn=%s",
            result.get("run_id"),
            result.get("stop_reason"),
            result.get("rows_deleted"),
            result.get("eligible_rows_exact"),
            result.get("batches"),
            result.get("elapsed_ms"),
            result.get("lock_connection_id"),
        )
        if args.once:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
            return 0 if result.get("stop_reason") != "error" else 2
        stop_event.wait(cfg.interval_seconds)

    logger.info("chat push outbox retention worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
