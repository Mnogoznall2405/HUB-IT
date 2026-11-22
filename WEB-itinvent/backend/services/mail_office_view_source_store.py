"""Short-lived file store that serves prefetched attachment bytes to Document Server.

``/mail/office-source`` is fetched by Document Server without the user's web
session, so mailbox credentials (including ``primary_session`` auth) are
unavailable there. The authenticated ``office-view`` endpoint therefore
downloads the attachment once under the user's session and parks the bytes on
the shared spool disk, keyed by the digest of the signed source token: any
backend process can then serve the anonymous fetch — no user secrets involved.

Storage layout (inside the My Files spool root, a non-public directory):

    <root>/<key>.bin   — the attachment bytes
    <root>/<key>.json  — {"expires_at": epoch, "filename": ..., "content_type": ..., "size": n}

The meta file is published last (atomic os.replace), so a complete entry is
only visible once both parts landed. Expiry lives in the meta file, which
survives process restarts; stale entries are swept lazily on writes.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path


def _positive_int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 1 << 30) -> int:
    try:
        value = int(str(os.getenv(name, "") or "").strip() or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def max_source_entries() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_ENTRIES", 32)


def max_source_total_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES", 256 * 1024 * 1024, maximum=1 << 30)


def max_source_entry_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_ENTRY_BYTES", 64 * 1024 * 1024, maximum=1 << 30)


def _default_root() -> Path:
    from backend.services.my_files_storage_layout import configured_spool_dir

    return configured_spool_dir() / "mail-office-view"


def source_store_root() -> Path:
    configured = str(os.getenv("MAIL_OFFICE_VIEW_SOURCE_DIR", "") or "").strip()
    return Path(configured) if configured else _default_root()


@dataclass
class OfficeViewSourceEntry:
    filename: str
    content_type: str
    content: bytes


def _safe_key(key: str) -> str:
    clean = "".join(ch for ch in str(key or "") if ch.isalnum())
    return clean[:128]


class OfficeViewSourceStore:
    """Token-digest → attachment bytes on shared disk; every backend process sees it."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = Path(root) if root is not None else source_store_root()

    def _bin(self, key: str) -> Path:
        return self._root / f"{key}.bin"

    def _meta(self, key: str) -> Path:
        return self._root / f"{key}.json"

    @staticmethod
    def _write_atomic(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}-", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

    def _drop_expired(self, now: float) -> None:
        for meta_path in self._root.glob("*.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if float(meta.get("expires_at") or 0) > now:
                    continue
            except Exception:
                # Unreadable meta never gates a valid entry; remove its debris.
                pass
            self._remove(meta_path.stem)

    def _remove(self, key: str) -> None:
        for path in (self._bin(key), self._meta(key)):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass

    def _entries(self, now: float) -> list[tuple[str, float, int]]:
        """(key, expires_at, size) for all complete, unexpired entries."""
        rows = []
        for meta_path in self._root.glob("*.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                expires = float(meta.get("expires_at") or 0)
                size = int(meta.get("size") or 0)
                if expires > now and self._bin(meta_path.stem).is_file():
                    rows.append((meta_path.stem, expires, size))
            except Exception:
                continue
        return rows

    def put(
        self,
        key: str,
        *,
        filename: str,
        content_type: str,
        content: bytes,
        ttl_sec: int,
    ) -> bool:
        """Park bytes under ``key``; returns False when the entry exceeds the size cap."""
        key = _safe_key(key)
        size = len(content or b"")
        if not key or size > max_source_entry_bytes() or size > max_source_total_bytes():
            return False
        now = time.time()
        self._root.mkdir(parents=True, exist_ok=True)
        self._drop_expired(now)
        rows = self._entries(now)
        rows.sort(key=lambda row: row[1])  # soonest-expiring first
        total = sum(row[2] for row in rows) + size
        count = len(rows) + 1
        for evict_key, _expires, evict_size in rows:
            if count <= max_source_entries() and total <= max_source_total_bytes():
                break
            if evict_key != key:
                self._remove(evict_key)
                total -= evict_size
                count -= 1
        if count > max_source_entries() or total > max_source_total_bytes():
            return False
        meta = {
            "expires_at": now + max(1, int(ttl_sec)),
            "filename": str(filename or "attachment"),
            "content_type": str(content_type or "") or "application/octet-stream",
            "size": size,
        }
        self._write_atomic(self._bin(key), content or b"")
        # Meta last: its presence marks the entry complete for other processes.
        self._write_atomic(self._meta(key), json.dumps(meta, ensure_ascii=False).encode("utf-8"))
        return True

    def get(self, key: str) -> OfficeViewSourceEntry | None:
        """Return the parked entry; records stay readable until expiry (DS may retry)."""
        key = _safe_key(key)
        if not key:
            return None
        meta_path = self._meta(key)
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            if float(meta.get("expires_at") or 0) <= time.time():
                self._remove(key)
                return None
            content = self._bin(key).read_bytes()
        except (OSError, ValueError):
            return None
        return OfficeViewSourceEntry(
            filename=str(meta.get("filename") or "attachment"),
            content_type=str(meta.get("content_type") or "") or "application/octet-stream",
            content=content,
        )


office_view_source_store = OfficeViewSourceStore()
