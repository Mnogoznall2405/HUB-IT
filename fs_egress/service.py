from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

from .monitor import FsEgressMonitor
from .spool import EgressSpool

logger = logging.getLogger("fs_egress")


def _env_bool(name: str, default: bool = True) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


def _resolve_server_url() -> str:
    explicit = str(os.getenv("ITINV_FS_EGRESS_SERVER_URL", "") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    base = str(os.getenv("ITINV_AGENT_SERVER_URL", "") or "").strip().rstrip("/")
    return base


def run_fs_egress_forever() -> None:
    if not _env_bool("ITINV_FS_EGRESS_ENABLED", True):
        logger.info("fs_egress disabled by ITINV_FS_EGRESS_ENABLED")
        return

    server_url = _resolve_server_url()
    api_key = str(os.getenv("ITINV_AGENT_API_KEY", "") or os.getenv("SCAN_AGENT_API_KEY", "") or "").strip()
    spool_root = Path(
        os.getenv(
            "ITINV_FS_EGRESS_SPOOL",
            str(Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "Agent" / "Spool" / "fs_egress"),
        )
    )
    spool = EgressSpool(
        spool_root,
        server_url=server_url,
        api_key=api_key,
        max_pending=_env_int("ITINV_FS_EGRESS_MAX_PENDING", 5000),
    )
    monitor = FsEgressMonitor(
        spool,
        debounce_sec=float(os.getenv("ITINV_FS_EGRESS_DEBOUNCE_SEC", "0.75") or 0.75),
        rate_limit_per_sec=_env_int("ITINV_FS_EGRESS_RATE_LIMIT", 30),
        roots_refresh_sec=float(os.getenv("ITINV_FS_EGRESS_ROOTS_REFRESH_SEC", "30") or 30),
        watch_profile_deletes=_env_bool("ITINV_FS_EGRESS_PROFILE_DELETES", True),
    )
    monitor.start()
    last_refresh = time.monotonic()
    drain_every = float(os.getenv("ITINV_FS_EGRESS_DRAIN_SEC", "3") or 3)
    last_drain = 0.0
    logger.info("fs_egress running spool=%s server=%s", spool_root, server_url or "(offline)")
    try:
        while True:
            monitor.flush_due()
            last_refresh = monitor.refresh_if_due(last_refresh=last_refresh)
            now = time.monotonic()
            if (now - last_drain) >= drain_every:
                stats = spool.drain(batch_size=_env_int("ITINV_FS_EGRESS_BATCH", 50))
                if stats.get("sent") or stats.get("failed") or monitor.dropped:
                    logger.info(
                        "fs_egress drain sent=%s failed=%s dropped=%s",
                        stats.get("sent"),
                        stats.get("failed"),
                        monitor.dropped,
                    )
                last_drain = now
            time.sleep(0.25)
    finally:
        monitor.stop()


def run_fs_egress_once_for_tests(spool: Optional[EgressSpool] = None) -> EgressSpool:
    """Helper for unit tests — no observer loop."""
    return spool or EgressSpool()
