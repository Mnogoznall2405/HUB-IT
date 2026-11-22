"""Short-lived shared store that serves prefetched attachment bytes to Document Server.

``/mail/office-source`` is fetched by Document Server without the user's web
session, so mailbox credentials (including ``primary_session`` auth) are
unavailable there. The authenticated ``office-view`` endpoint therefore
downloads the attachment once under the user's session and parks the bytes on
the shared spool disk, keyed by the digest of the signed source token: any
backend process can then serve the anonymous fetch — no user secrets involved.

Storage layout (inside the My Files spool root, a non-public directory):

    <root>/<key>.<payload_id>.bin — immutable attachment bytes (one per version)
    <root>/<key>.json             — {"payload", "expires_at", "filename", ...}
    <root>.mvsrc.lock             — inter-process byte-range lock file

Consistency & concurrency:

- Payload files are immutable and uniquely named; the meta file is published
  last via atomic tmp+``os.replace``, so a reader always sees either the whole
  previous entry or the whole new one — never a torn pair.
- Writers and the sweeper serialise on an OS-level byte-range lock
  (``msvcrt.locking`` on Windows, ``fcntl.flock`` on POSIX). The kernel
  releases it automatically if a process dies mid-write — no stale locks.
  Byte-range locks are supported by SMB redirectors; the bounded wait raises
  ``OfficeViewSourceLockTimeout`` instead of hanging forever.
- Capacity (count/bytes) is reserved *inside* the lock before the payload is
  written: a ``.tmp-*`` placeholder truncated to the entry size, so every
  other process counts it via ``st_size``. On-disk bytes can never exceed
  ``MAX_BYTES`` — published entries, orphans and in-flight writes included.
- Readers take the lock briefly: the meta is validated and the payload opened
  inside the lock, so an eviction cannot delete the file between meta-read and
  file-open. An open payload survives unlink on POSIX and cannot be deleted
  on Windows — the reader either gets a clean MISS or a complete stream.
- Sweep compares file ages against the *lock file* mtime, not the local
  wall clock: on shared storage the file-server clock is the common domain,
  so skewed hosts never sweep each other's active writes.

Cleanup (lazy, under the lock): expired entries, corrupt metas, orphaned
payloads and half-written ``.tmp-*`` files older than the grace period. Files
younger than the grace period are never touched, protecting in-flight writes
of other processes.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:  # pragma: no cover - exercised on POSIX CI only
    import fcntl


def _positive_int_env(name: str, default: int, *, minimum: int = 0, maximum: int = 1 << 30) -> int:
    try:
        value = int(str(os.getenv(name, "") or "").strip() or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def max_source_entries() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_ENTRIES", 32, minimum=1)


def max_source_total_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_MAX_BYTES", 256 * 1024 * 1024, minimum=1, maximum=1 << 30)


def max_source_entry_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_ENTRY_BYTES", 64 * 1024 * 1024, minimum=1, maximum=1 << 30)


def lock_timeout_sec() -> float:
    return float(_positive_int_env("MAIL_OFFICE_VIEW_SOURCE_LOCK_TIMEOUT_SEC", 10, minimum=1, maximum=300))


def sweep_grace_sec() -> int:
    """Files younger than this are never swept: protects in-flight writes."""
    return _positive_int_env("MAIL_OFFICE_VIEW_SOURCE_SWEEP_GRACE_SEC", 120, minimum=1)


def _default_root() -> Path:
    from backend.services.my_files_storage_layout import configured_spool_dir

    return configured_spool_dir() / "mail-office-view"


def source_store_root() -> Path:
    configured = str(os.getenv("MAIL_OFFICE_VIEW_SOURCE_DIR", "") or "").strip()
    return Path(configured) if configured else _default_root()


class OfficeViewSourceLockTimeout(RuntimeError):
    """The inter-process lock could not be acquired within the timeout."""


@dataclass
class OfficeViewSourceEntry:
    filename: str
    content_type: str
    payload_path: Path
    size: int = 0
    payload_handle: object | None = None

    @property
    def content(self) -> bytes:
        return self.payload_path.read_bytes()

    def close(self) -> None:
        handle, self.payload_handle = self.payload_handle, None
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass

    def __enter__(self) -> "OfficeViewSourceEntry":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class _InterProcessLock:
    """Byte-range lock on <root>/.mvsrc.lock; kernel-owned, crash-safe.

    ``msvcrt.locking``/``fcntl.flock`` marks are released by the OS when the
    process exits, so a crashed backend never leaves a stale lock behind.
    """

    def __init__(self, lock_path: Path, timeout_sec: float) -> None:
        self._path = lock_path
        self._timeout = timeout_sec
        self._fd: int | None = None

    def _try_lock(self) -> bool:
        try:
            if os.name == "nt":
                os.lseek(self._fd, 0, os.SEEK_SET)
                msvcrt.locking(self._fd, msvcrt.LK_NBLCK, 1)
            else:  # pragma: no cover
                fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    def _unlock(self) -> None:
        try:
            if os.name == "nt":
                os.lseek(self._fd, 0, os.SEEK_SET)
                msvcrt.locking(self._fd, msvcrt.LK_UNLCK, 1)
            else:  # pragma: no cover
                fcntl.flock(self._fd, fcntl.LOCK_UN)
        except OSError:
            pass

    def __enter__(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(str(self._path), os.O_RDWR | os.O_CREAT | os.O_BINARY, 0o666)
        deadline = time.monotonic() + self._timeout
        while True:
            if self._try_lock():
                return self
            if time.monotonic() >= deadline:
                os.close(self._fd)
                self._fd = None
                raise OfficeViewSourceLockTimeout(
                    f"office-view source store lock timeout after {self._timeout:.0f}s"
                )
            time.sleep(0.05)

    def __exit__(self, *exc) -> None:
        if self._fd is not None:
            self._unlock()
            os.close(self._fd)
            self._fd = None


def _safe_key(key: str) -> str:
    return "".join(ch for ch in str(key or "") if ch.isalnum())[:128]


class OfficeViewSourceStore:
    """Token-digest → attachment bytes on shared disk; every backend process sees it."""

    def __init__(self, root: Path | None = None) -> None:
        self._root = Path(root) if root is not None else source_store_root()

    @property
    def root(self) -> Path:
        return self._root

    def _lock(self) -> _InterProcessLock:
        return _InterProcessLock(self._root / ".mvsrc.lock", lock_timeout_sec())

    def _meta_path(self, key: str) -> Path:
        return self._root / f"{key}.json"

    @staticmethod
    def _write_atomic(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.tmp-", dir=str(path.parent))
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

    @staticmethod
    def _safe_unlink(path: Path) -> bool:
        try:
            path.unlink(missing_ok=True)
            return True
        except OSError:
            # File may be open by a reader (Windows) — leave it; the next sweep
            # removes it once its meta/grace conditions hold.
            return False

    def _read_meta(self, key: str) -> dict | None:
        try:
            return json.loads(self._meta_path(key).read_text(encoding="utf-8"))
        except Exception:
            return None

    def _remove_entry(self, key: str, meta: dict | None) -> int:
        """Delete meta+payload; returns the meta-declared size for accounting."""
        size = int((meta or {}).get("size") or 0)
        self._safe_unlink(self._meta_path(key))
        payload_name = str((meta or {}).get("payload") or "")
        if payload_name:
            self._safe_unlink(self._root / payload_name)
        return size

    def _fs_now_locked(self) -> float:
        """Filesystem-clock 'now': the lock file mtime.

        On shared (SMB) storage file ages must be compared against the file
        server's clock, not this host's wall clock — otherwise a skewed host
        could sweep another host's in-flight writes.
        """
        lock_path = self._root / ".mvsrc.lock"
        try:
            os.utime(lock_path)
            return lock_path.stat().st_mtime
        except OSError:
            return time.time()

    def _disk_bytes_locked(self) -> tuple[int, int]:
        """(total bytes, tmp bytes) of payload data on disk.

        Counts ``.bin`` payloads (published, orphan, in-flight) and ``.tmp-*``
        placeholders — the byte cap bounds attachment bytes; meta files are
        bounded separately by the entries cap.
        """
        total = 0
        tmp_bytes = 0
        try:
            for path in self._root.iterdir():
                name = path.name
                if not path.is_file() or not (name.endswith(".bin") or ".tmp-" in name):
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                total += size
                if ".tmp-" in name:
                    tmp_bytes += size
        except OSError:
            pass
        return total, tmp_bytes

    def _sweep_locked(self, now: float, fs_now: float | None = None) -> None:
        """Drop expired/corrupt entries plus orphan payloads/tmp files (grace-guarded)."""
        referenced: set[str] = set()
        for meta_path in self._root.glob("*.json"):
            key = meta_path.stem
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                expires = float(meta.get("expires_at") or 0)
            except Exception:
                self._remove_entry(key, None)  # corrupt meta → dead entry
                continue
            if expires <= now:
                self._remove_entry(key, meta)
                continue
            referenced.add(str(meta.get("payload") or ""))
        grace_before = (fs_now if fs_now is not None else now) - sweep_grace_sec()
        for path in self._root.iterdir():
            name = path.name
            if name in referenced or name in {".mvsrc.lock"}:
                continue
            if not (name.endswith(".bin") or ".tmp-" in name):
                continue
            try:
                if path.stat().st_mtime > grace_before:
                    continue  # in-flight write of another process
                self._safe_unlink(path)
            except OSError:
                continue

    def _entries_locked(self, now: float) -> list[tuple[str, float, int, dict]]:
        """(key, expires_at, size, meta) for complete unexpired entries."""
        rows = []
        for meta_path in self._root.glob("*.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                expires = float(meta.get("expires_at") or 0)
                size = int(meta.get("size") or 0)
                payload = self._root / str(meta.get("payload") or "")
                if expires > now and payload.is_file():
                    rows.append((meta_path.stem, expires, size, meta))
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
        payload_id = uuid.uuid4().hex[:16]
        payload_name = f"{key}.{payload_id}.bin"
        payload_tmp = None
        # Reserve capacity BEFORE any payload bytes hit the disk: a .tmp-*
        # placeholder truncated to the entry size is created inside the lock,
        # so other processes count it via st_size. Accounting covers every
        # file on disk (published, orphan, in-flight) — MAX_BYTES is a real
        # disk bound, not just a sum over published metas.
        with self._lock():
            now = time.time()
            self._sweep_locked(now, self._fs_now_locked())
            disk_bytes, _tmp_bytes = self._disk_bytes_locked()
            rows = self._entries_locked(now)
            rows.sort(key=lambda row: row[1])  # soonest-expiring evicted first
            count = len(rows) + 1
            need = disk_bytes + size
            for evict_key, _expires, evict_size, evict_meta in rows:
                if count <= max_source_entries() and need <= max_source_total_bytes():
                    break
                if evict_key != key:
                    need -= self._remove_entry(evict_key, evict_meta)
                    count -= 1
            if count > max_source_entries() or need > max_source_total_bytes():
                return False
            fd, payload_tmp = tempfile.mkstemp(prefix=f".{payload_name}.tmp-", dir=str(self._root))
            try:
                os.ftruncate(fd, size)
            except OSError:
                os.close(fd)
                self._safe_unlink(Path(payload_tmp))
                return False
        # Payload bytes are written outside the lock into the reserved
        # placeholder: parallel puts don't serialise on I/O, and an
        # unfinished placeholder is just a swept file, never a visible entry.
        try:
            with os.fdopen(fd, "r+b") as handle:
                handle.write(content or b"")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(payload_tmp, self._root / payload_name)
            payload_tmp = None
        except Exception:
            if payload_tmp is not None:
                self._safe_unlink(Path(payload_tmp))
            raise
        meta = {
            "payload": payload_name,
            "expires_at": time.time() + max(1, int(ttl_sec)),
            "filename": str(filename or "attachment"),
            "content_type": str(content_type or "") or "application/octet-stream",
            "size": size,
        }
        with self._lock():
            previous = self._read_meta(key)
            self._write_atomic(self._meta_path(key), json.dumps(meta, ensure_ascii=False).encode("utf-8"))
            # Meta published → the old payload is now an orphan.
            old_payload = str((previous or {}).get("payload") or "")
            if old_payload and old_payload != payload_name:
                self._safe_unlink(self._root / old_payload)
        return True

    def get(self, key: str) -> OfficeViewSourceEntry | None:
        """Return the parked entry; records stay readable until expiry (DS may retry).

        The lock is held while the meta is validated and the payload opened:
        eviction cannot remove the file between meta-read and open, an
        expired record is never served (a lock timeout is a clean MISS, not
        stale bytes), and the returned open handle pins the bytes — a later
        unlink cannot break the response mid-stream.
        """
        key = _safe_key(key)
        if not key:
            return None
        try:
            with self._lock():
                meta = self._read_meta(key)
                if not meta:
                    return None
                if float(meta.get("expires_at") or 0) <= time.time():
                    self._remove_entry(key, meta)
                    return None
                payload = self._root / str(meta.get("payload") or "")
                try:
                    handle = payload.open("rb")
                except OSError:
                    return None
                return OfficeViewSourceEntry(
                    filename=str(meta.get("filename") or "attachment"),
                    content_type=str(meta.get("content_type") or "") or "application/octet-stream",
                    payload_path=payload,
                    size=int(meta.get("size") or 0),
                    payload_handle=handle,
                )
        except OfficeViewSourceLockTimeout:
            return None


office_view_source_store = OfficeViewSourceStore()
