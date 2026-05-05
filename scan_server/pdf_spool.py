from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    tmp_path.write_bytes(data)
    tmp_path.replace(path)


class PdfSpoolStore:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self._stats_cache_ts = 0.0
        self._stats_cache: Dict[str, Any] = {}

    def path_for_job(self, job_id: str) -> Path:
        safe_job_id = str(job_id or "").strip().lower()
        return self.root_dir / f"{safe_job_id}.pdf"

    def write(self, *, job_id: str, pdf_bytes: bytes) -> Path:
        if not pdf_bytes:
            raise ValueError("pdf_bytes is required")
        path = self.path_for_job(job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write_bytes(path, bytes(pdf_bytes))
        return path

    def read(self, *, job_id: str) -> bytes:
        path = self.path_for_job(job_id)
        try:
            return path.read_bytes()
        except Exception:
            return b""

    def delete(self, *, job_id: str) -> bool:
        path = self.path_for_job(job_id)
        try:
            path.unlink(missing_ok=True)
            return True
        except Exception as exc:
            logger.warning("Failed to delete transient PDF payload for job %s: %s", job_id, exc)
            return False

    def list_pdf_paths(self) -> List[Path]:
        return list(self.root_dir.glob("*.pdf"))

    def delete_path(self, path: Path, *, description: str) -> bool:
        try:
            Path(path).unlink(missing_ok=True)
            return True
        except Exception as exc:
            logger.warning("Failed to delete %s transient PDF payload %s: %s", description, path, exc)
            return False

    def stats(self, *, cache_ttl_sec: float = 10.0) -> Dict[str, Any]:
        now = time.time()
        if (
            cache_ttl_sec > 0
            and self._stats_cache
            and (now - self._stats_cache_ts) <= cache_ttl_sec
        ):
            return dict(self._stats_cache)
        count = 0
        total_bytes = 0
        oldest_mtime = 0
        newest_mtime = 0
        for path in self.root_dir.glob("*.pdf"):
            try:
                stat = path.stat()
            except FileNotFoundError:
                continue
            except Exception as exc:
                logger.debug("Failed to stat transient PDF payload %s: %s", path, exc)
                continue
            count += 1
            total_bytes += int(stat.st_size or 0)
            mtime = int(stat.st_mtime or 0)
            if mtime and (oldest_mtime <= 0 or mtime < oldest_mtime):
                oldest_mtime = mtime
            if mtime and mtime > newest_mtime:
                newest_mtime = mtime
        stats = {
            "count": count,
            "bytes": total_bytes,
            "gb": round(total_bytes / (1024 ** 3), 3),
            "oldest_mtime": oldest_mtime,
            "newest_mtime": newest_mtime,
        }
        self._stats_cache = dict(stats)
        self._stats_cache_ts = now
        return stats
