from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scan_server.config import config
from scan_server.database import ScanStore


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan server SQLite retention maintenance")
    parser.add_argument("--execute", action="store_true", help="delete rows instead of dry-run counts")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--clean-days", type=int, default=config.clean_job_retention_days)
    parser.add_argument("--failed-days", type=int, default=config.failed_job_retention_days)
    parser.add_argument("--incident-days", type=int, default=config.incident_retention_days)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    store = ScanStore(
        db_path=config.db_path,
        archive_dir=config.archive_dir,
        task_ack_timeout_sec=config.task_ack_timeout_sec,
        agent_online_timeout_sec=config.agent_online_timeout_sec,
        resolve_agent_sql_context=config.resolve_agent_sql_context,
        job_processing_timeout_sec=config.job_processing_timeout_sec,
        sqlite_busy_timeout_ms=config.sqlite_busy_timeout_ms,
        sqlite_busy_retry_attempts=config.sqlite_busy_retry_attempts,
        sqlite_busy_retry_base_ms=config.sqlite_busy_retry_base_ms,
    )
    result = store.cleanup_retention(
        retention_days=config.retention_days,
        clean_job_retention_days=args.clean_days,
        failed_job_retention_days=args.failed_days,
        incident_retention_days=args.incident_days,
        batch_size=args.batch_size,
        dry_run=not args.execute,
    )
    print(json.dumps({"dry_run": not args.execute, **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
