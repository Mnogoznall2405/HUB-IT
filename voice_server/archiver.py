"""Warm-storage archiver: ``python -m voice_server.archiver``.

Copies source media of finished jobs hot → warm (``VOICEVIDEO_ARCHIVE_DIR``),
verifies the copy, removes the hot file, and drops both copies once
``finished_at + VOICEVIDEO_SOURCE_TTL_DAYS`` has passed. Reports under
``output/`` are never touched.

Dry-run by default (``VOICE_ARCHIVE_DRY_RUN=1``): logs actions, changes nothing.
Single-run lock in ``data/voice_server/archiver.lock``.
"""
from __future__ import annotations

import logging
import os
import shutil
import signal
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from .config import config
from . import pipeline, store
from .worker_main import _acquire_singleton_lock

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("voice-archiver")

BATCH_SIZE = 5
BATCH_SLEEP_SEC = 2.0


def _parse_ts(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value or ""))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _hot_source(base: str) -> Optional[Path]:
    for directory in (pipeline.processed_dir(), pipeline.input_dir()):
        try:
            if not directory.exists():
                continue
        except OSError:
            continue
        for ext in pipeline.MEDIA_EXTENSIONS:
            candidate = directory / f"{base}{ext}"
            if candidate.is_file():
                return candidate
    return None


def _archive_one(
    job: Dict[str, Any], arch: Path, *, dry_run: bool, stats: Dict[str, int]
) -> str:
    base = str(job.get("base_filename") or "")
    job_id = str(job.get("id") or "")
    if not base or not job_id:
        return "skip"
    finished = _parse_ts(job.get("finished_at"))
    ttl_expired = bool(
        finished
        and finished + timedelta(days=config.source_ttl_days) <= datetime.now(timezone.utc)
    )
    hot = _hot_source(base)
    warm = arch / "processed" / hot.name if hot else None
    # If the hot file is gone, reconstruct the expected warm path from archive_path.
    if warm is None and job.get("archive_path"):
        cand = Path(str(job["archive_path"]))
        if cand.is_file():
            warm = cand

    if ttl_expired:
        if dry_run:
            logger.info("dry-run: TTL expired, would delete source of %s", base)
            return "expired"
        removed = 0
        for path in (hot, warm):
            if path is None:
                continue
            try:
                path.unlink(missing_ok=True)
                removed += 1
            except OSError as exc:
                stats["errors"] += 1
                logger.warning("archiver: cannot delete %s: %s", path, exc)
        if removed:
            stats["expired_deleted"] += removed
            logger.info("archiver: TTL expired, deleted %d source file(s) for %s", removed, base)
        return "expired"

    if hot is None:
        return "skip"  # nothing on hot tier; either archived earlier or missing

    warm_dir = arch / "processed"
    dest = warm_dir / hot.name
    already = (
        str(job.get("archive_path") or "") == str(dest)
        and dest.is_file()
        and dest.stat().st_size == hot.stat().st_size
    )
    if already:
        # Idempotent: archive recorded earlier, only the hot copy remains.
        if dry_run:
            logger.info("dry-run: would remove hot copy %s (already archived)", hot)
            return "already"
        hot.unlink(missing_ok=True)
        return "already"

    if dry_run:
        logger.info(
            "dry-run: would move %s -> %s (%d bytes)", hot, dest, hot.stat().st_size
        )
        stats["dry_run"] += 1
        return "dry"

    warm_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(hot, dest)
    if dest.stat().st_size != hot.stat().st_size:
        stats["errors"] += 1
        logger.error("archiver: size mismatch %s vs %s", hot, dest)
        return "error"
    hot.unlink()
    try:
        store.mark_archived(job_id, str(dest))
    except Exception as exc:
        stats["errors"] += 1
        logger.warning("archiver: mark_archived failed for %s: %s", job_id, exc)
    stats["copied"] += 1
    stats["bytes"] += dest.stat().st_size
    logger.info("archiver: moved %s -> %s", hot, dest)
    return "archived"


def archive_cycle() -> Dict[str, int]:
    stats = {"copied": 0, "bytes": 0, "expired_deleted": 0, "errors": 0, "dry_run": 0}
    if not config.archive_enabled:
        logger.info("archiver: disabled (VOICE_ARCHIVE_ENABLED=0)")
        return stats
    arch = pipeline.archive_dir()
    if arch is None:
        logger.warning("archiver: archive dir unavailable: %s", config.archive_dir)
        return stats
    dry_run = config.archive_dry_run
    started = time.monotonic()
    jobs = store.list_done_jobs(limit=BATCH_SIZE * 4)
    processed = 0
    for job in jobs:
        if processed >= BATCH_SIZE:
            break
        try:
            outcome = _archive_one(job, arch, dry_run=dry_run, stats=stats)
        except Exception:
            stats["errors"] += 1
            logger.exception("archiver: job %s failed", job.get("id"))
            continue
        if outcome in {"archived", "expired", "dry", "already"}:
            processed += 1
            if processed < BATCH_SIZE:
                time.sleep(BATCH_SLEEP_SEC)
    logger.info(
        "archiver cycle: copied=%d expired=%d errors=%d dry=%d mb=%.1f took=%.1fs",
        stats["copied"], stats["expired_deleted"], stats["errors"], stats["dry_run"],
        stats["bytes"] / 1048576, time.monotonic() - started,
    )
    return stats


def main() -> None:
    stop_event = threading.Event()

    def _request_stop(_signum: int, _frame: object) -> None:
        stop_event.set()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    lock = _acquire_singleton_lock(config.data_dir / "archiver.lock")
    if lock is None:
        logger.error("Another archiver already holds the lock; exiting")
        return
    try:
        interval = max(60, int(os.getenv("VOICE_ARCHIVE_INTERVAL_SEC", "3600")))
        logger.info(
            "Archiver ready: dir=%s enabled=%s dry_run=%s ttl=%dd interval=%ds",
            config.archive_dir, config.archive_enabled, config.archive_dry_run,
            config.source_ttl_days, interval,
        )
        while not stop_event.is_set():
            try:
                archive_cycle()
            except Exception:
                logger.exception("archiver cycle crashed")
            stop_event.wait(interval)
    finally:
        lock.close()


if __name__ == "__main__":
    main()
