"""Recovery helpers for My Files storage v2 temporary/orphan artifacts."""
from __future__ import annotations

import logging
import time
from pathlib import Path

logger = logging.getLogger("backend.services.my_files_recovery")


def cleanup_tmp_blob_files(root: Path, *, max_age_sec: int = 3600) -> dict[str, int]:
    """Delete stale ``*.tmp-*`` files under a storage root.

    Safe to run repeatedly. Does not delete final blobs.
    """
    removed = 0
    errors = 0
    scanned = 0
    cutoff = time.time() - max(60, int(max_age_sec))
    if not root.exists():
        return {"scanned": 0, "removed": 0, "errors": 0}
    for path in root.rglob("*.tmp-*"):
        scanned += 1
        try:
            if not path.is_file():
                continue
            if path.stat().st_mtime > cutoff:
                continue
            path.unlink(missing_ok=True)
            removed += 1
        except OSError as exc:
            errors += 1
            logger.warning("failed to remove tmp blob path=%s error=%s", path, exc)
    return {"scanned": scanned, "removed": removed, "errors": errors}
