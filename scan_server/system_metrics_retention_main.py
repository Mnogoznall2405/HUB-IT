"""Standalone PM2 entry for scan system metrics retention (24h policy)."""
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

# Ensure project root imports
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

_env = _ROOT / ".env"
if _env.exists():
    try:
        from dotenv import load_dotenv

        load_dotenv(_env, override=False)
    except ImportError:
        pass

from scan_server.system_metrics_retention import (  # noqa: E402
    SystemMetricsRetentionConfig,
    SystemMetricsRetentionConfigError,
    system_metrics_retention_service,
)

logger = logging.getLogger("scan_server.system_metrics.retention.worker")


def _hub_scan_healthy() -> bool:
    """Lightweight local health probes; failures are soft-stop for retention only."""
    try:
        import urllib.request

        for url in ("http://127.0.0.1:8001/health", "http://127.0.0.1:8011/health"):
            try:
                with urllib.request.urlopen(url, timeout=3) as resp:
                    if int(getattr(resp, "status", 0) or 0) >= 500:
                        return False
            except Exception:
                # Scan API may flap during restart storm; do not hard-fail every tick.
                continue
        return True
    except Exception:
        return True


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scan system metrics retention worker")
    p.add_argument("--once", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--force", action="store_true", help="Allow execute even if ENABLED=false")
    return p.parse_args()


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = _parse_args()
    try:
        cfg = SystemMetricsRetentionConfig.from_env()
    except SystemMetricsRetentionConfigError as exc:
        logger.error("Invalid config (fail-closed): %s", exc)
        return 2

    dry_run = True if args.dry_run else (False if args.execute else cfg.dry_run)
    logger.info(
        "Starting system metrics retention: enabled=%s dry_run=%s window=%s hours=%s days=%s batch=%s pause_ms=%s",
        cfg.enabled,
        dry_run,
        cfg.retention_window_label,
        cfg.retention_hours,
        cfg.retention_days,
        cfg.batch_size,
        cfg.batch_pause_ms,
    )

    stop_event = threading.Event()

    def _stop(_s=None, _f=None):
        stop_event.set()

    try:
        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)
    except Exception:
        pass

    if not args.once and cfg.startup_delay_seconds > 0:
        stop_event.wait(cfg.startup_delay_seconds)

    while not stop_event.is_set():
        try:
            cfg = SystemMetricsRetentionConfig.from_env()
        except SystemMetricsRetentionConfigError as exc:
            logger.error("config_invalid error=%s", exc)
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

        if not args.once and not cfg.enabled and not args.dry_run and not args.execute:
            logger.info("idle enabled=false interval_s=%s", cfg.interval_seconds)
            stop_event.wait(cfg.interval_seconds)
            continue

        result = system_metrics_retention_service.run_once(
            config=cfg,
            dry_run=dry_run,
            acquire_lock=True,
            force_enabled=bool(args.force or args.execute),
            should_stop=stop_event.is_set,
            health_check=_hub_scan_healthy,
        )
        logger.info(
            "cycle run_id=%s stop=%s deleted=%s batches=%s elapsed_ms=%s",
            result.get("run_id"),
            result.get("stop_reason"),
            result.get("rows_deleted"),
            result.get("batches"),
            result.get("elapsed_ms"),
        )
        if args.once:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
            return 0 if result.get("stop_reason") != "error" else 2
        stop_event.wait(cfg.interval_seconds)

    logger.info("system metrics retention worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
