"""Resumable (chunked) equipment photo uploads for flaky links.

A client opens an upload session, sends the file in small fixed-size chunks (any
order, any number of times) and finally asks to complete it. Chunks live on disk
under ``<data>/equipment_photo_uploads/<upload_id>/``; nothing touches the database
until ``complete`` hands the assembled bytes to the caller's ``commit`` callback.

The session id is derived from (user, database, item, client_id), so opening a
session twice with the same ``client_id`` returns the same session, and completing
a finished session returns the original result instead of inserting a duplicate.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from backend.database.equipment_photos import MAX_PHOTO_BYTES

logger = logging.getLogger(__name__)

CHUNK_SIZE_BYTES = 256 * 1024
UPLOAD_TTL_SECONDS = 48 * 3600
COMPLETE_LOCK_STALE_SECONDS = 120
CLEANUP_INTERVAL_SECONDS = 600
CLEANUP_BATCH_LIMIT = 200

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_MANIFEST = "manifest.json"
_RESULT = "result.json"
_LOCK = "complete.lock"

_cleanup_lock = threading.Lock()
_last_cleanup_at = 0.0


class UploadSessionError(Exception):
    status_code = 400


class UploadNotFoundError(UploadSessionError):
    status_code = 404


class UploadConflictError(UploadSessionError):
    status_code = 409


def _root() -> Path:
    explicit = str(os.getenv("EQUIPMENT_PHOTO_UPLOAD_DIR", "") or "").strip()
    if explicit:
        return Path(explicit)
    data_dir = str(os.getenv("HUB_DATA_DIR", "") or "").strip()
    base = Path(data_dir) if data_dir else Path(__file__).resolve().parents[3] / "data"
    return base / "equipment_photo_uploads"


def make_upload_id(*, user_id: int, db_id: Optional[str], item_id: int, client_id: str) -> str:
    raw = f"{int(user_id)}|{str(db_id or '').strip().lower()}|{int(item_id)}|{client_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _session_dir(upload_id: str) -> Path:
    if not _ID_RE.match(str(upload_id or "")):
        raise UploadNotFoundError("upload not found")
    return _root() / upload_id


def _write_json_atomic(path: Path, payload: dict) -> None:
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _total_chunks(size: int, chunk_size: int) -> int:
    return max(1, -(-int(size) // int(chunk_size)))


def _expected_chunk_len(manifest: dict, index: int) -> int:
    size, chunk = int(manifest["size"]), int(manifest["chunk_size"])
    if index < _total_chunks(size, chunk) - 1:
        return chunk
    return size - chunk * index


def _load_owned(upload_id: str, user_id: int) -> tuple[Path, dict]:
    directory = _session_dir(upload_id)
    manifest = _read_json(directory / _MANIFEST)
    # The same message for "missing" and "someone else's": no id probing.
    if manifest is None or int(manifest.get("user_id", -1)) != int(user_id):
        raise UploadNotFoundError("upload not found")
    return directory, manifest


def _received(directory: Path, manifest: dict) -> list[int]:
    chunks_dir = directory / "chunks"
    total = _total_chunks(manifest["size"], manifest["chunk_size"])
    received = []
    for index in range(total):
        try:
            if (chunks_dir / f"{index}.part").stat().st_size == _expected_chunk_len(manifest, index):
                received.append(index)
        except OSError:
            continue
    return received


def _state(directory: Path, manifest: dict) -> dict[str, Any]:
    result = _read_json(directory / _RESULT)
    total = _total_chunks(manifest["size"], manifest["chunk_size"])
    return {
        "upload_id": manifest["upload_id"],
        "status": "complete" if result else "uploading",
        "item_id": int(manifest["item_id"]),
        "size": int(manifest["size"]),
        "chunk_size": int(manifest["chunk_size"]),
        "total_chunks": total,
        "received": list(range(total)) if result else _received(directory, manifest),
        "file_no": int(result["file_no"]) if result else None,
    }


def create_session(
    *,
    user_id: int,
    db_id: Optional[str],
    item_id: int,
    client_id: str,
    file_name: str,
    size: int,
    mime_type: Optional[str] = None,
    description: str = "",
    sha256: Optional[str] = None,
) -> dict[str, Any]:
    client_id = str(client_id or "").strip()
    if not 8 <= len(client_id) <= 128:
        raise UploadSessionError("client_id must be 8-128 characters")
    size = int(size)
    if size <= 0:
        raise UploadSessionError("file is empty")
    if size > MAX_PHOTO_BYTES:
        raise UploadSessionError("file exceeds the size limit")
    digest = str(sha256 or "").strip().lower() or None
    if digest is not None and not re.match(r"^[0-9a-f]{64}$", digest):
        raise UploadSessionError("sha256 must be 64 hex characters")

    upload_id = make_upload_id(user_id=user_id, db_id=db_id, item_id=item_id, client_id=client_id)
    directory = _session_dir(upload_id)
    manifest = _read_json(directory / _MANIFEST)
    if manifest is not None:
        if int(manifest["size"]) != size:
            raise UploadConflictError("client_id is already used for a different file")
        return _state(directory, manifest)

    _maybe_cleanup()
    (directory / "chunks").mkdir(parents=True, exist_ok=True)
    manifest = {
        "upload_id": upload_id,
        "user_id": int(user_id),
        "db_id": str(db_id or "") or None,
        "item_id": int(item_id),
        "file_name": str(file_name or "").strip()[:255],
        "size": size,
        "chunk_size": CHUNK_SIZE_BYTES,
        "mime_type": str(mime_type or "").strip() or None,
        "description": str(description or "").strip()[:255],
        "sha256": digest,
        "created_at": time.time(),
    }
    _write_json_atomic(directory / _MANIFEST, manifest)
    return _state(directory, manifest)


def get_state(upload_id: str, user_id: int) -> dict[str, Any]:
    directory, manifest = _load_owned(upload_id, user_id)
    return _state(directory, manifest)


def get_manifest(upload_id: str, user_id: int) -> dict[str, Any]:
    return _load_owned(upload_id, user_id)[1]


def put_chunk(upload_id: str, user_id: int, index: int, payload: bytes) -> dict[str, Any]:
    directory, manifest = _load_owned(upload_id, user_id)
    if (directory / _RESULT).exists():
        return _state(directory, manifest)
    total = _total_chunks(manifest["size"], manifest["chunk_size"])
    if not 0 <= int(index) < total:
        raise UploadSessionError("chunk index out of range")
    data = bytes(payload or b"")
    if len(data) != _expected_chunk_len(manifest, int(index)):
        raise UploadSessionError("unexpected chunk size")
    chunks_dir = directory / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    final = chunks_dir / f"{int(index)}.part"
    tmp = chunks_dir / f"{int(index)}.{uuid.uuid4().hex}.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, final)
    try:
        os.utime(directory, None)
    except OSError:
        pass
    return _state(directory, manifest)


def _acquire_complete_lock(directory: Path) -> bool:
    lock = directory / _LOCK
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                age = time.time() - lock.stat().st_mtime
            except OSError:
                continue
            if age < COMPLETE_LOCK_STALE_SECONDS:
                return False
            try:
                lock.unlink()
            except OSError:
                return False
            continue
        os.close(fd)
        return True
    return False


def _release_complete_lock(directory: Path) -> None:
    try:
        (directory / _LOCK).unlink()
    except OSError:
        pass


def complete(
    upload_id: str,
    user_id: int,
    *,
    commit: Callable[[dict, bytes], dict],
) -> tuple[dict, bool]:
    """Assemble the file and ``commit(manifest, data)`` it once.

    Returns ``(result, created)``; ``created`` is False when the session had
    already been completed (the stored result is returned, nothing is inserted).
    """
    directory, manifest = _load_owned(upload_id, user_id)
    done = _read_json(directory / _RESULT)
    if done is not None:
        return done, False
    if not _acquire_complete_lock(directory):
        raise UploadConflictError("upload is being completed, retry shortly")
    try:
        done = _read_json(directory / _RESULT)
        if done is not None:
            return done, False
        missing = sorted(set(range(_total_chunks(manifest["size"], manifest["chunk_size"]))) - set(_received(directory, manifest)))
        if missing:
            raise UploadConflictError(f"missing chunks: {len(missing)}")
        data = b"".join(
            (directory / "chunks" / f"{index}.part").read_bytes()
            for index in range(_total_chunks(manifest["size"], manifest["chunk_size"]))
        )
        if len(data) != int(manifest["size"]):
            raise UploadSessionError("assembled size mismatch")
        expected = manifest.get("sha256")
        if expected and hashlib.sha256(data).hexdigest() != expected:
            raise UploadSessionError("checksum mismatch")
        result = dict(commit(manifest, data))
        _write_json_atomic(directory / _RESULT, result)
        shutil.rmtree(directory / "chunks", ignore_errors=True)
        return result, True
    finally:
        _release_complete_lock(directory)


def abort(upload_id: str, user_id: int) -> None:
    directory, _ = _load_owned(upload_id, user_id)
    if (directory / _RESULT).exists():
        return
    shutil.rmtree(directory, ignore_errors=True)


def _cleanup_enabled() -> bool:
    return str(os.getenv("EQUIPMENT_PHOTO_UPLOAD_CLEANUP_ENABLED", "false")).strip().lower() in {"1", "true", "yes", "on"}


def cleanup_expired(
    *,
    ttl_seconds: int = UPLOAD_TTL_SECONDS,
    dry_run: bool = True,
    batch_limit: int = CLEANUP_BATCH_LIMIT,
    now: Optional[float] = None,
) -> dict[str, int]:
    """Remove upload directories untouched for ``ttl_seconds``. Dry-run by default."""
    summary = {"scanned": 0, "expired": 0, "removed": 0}
    if not _cleanup_lock.acquire(blocking=False):
        return summary
    try:
        root = _root()
        if not root.is_dir():
            return summary
        cutoff = (time.time() if now is None else now) - int(ttl_seconds)
        for entry in root.iterdir():
            if summary["expired"] >= batch_limit:
                break
            if not entry.is_dir() or not _ID_RE.match(entry.name):
                continue
            summary["scanned"] += 1
            try:
                if entry.stat().st_mtime >= cutoff or (entry / _LOCK).exists():
                    continue
            except OSError:
                continue
            summary["expired"] += 1
            if not dry_run:
                shutil.rmtree(entry, ignore_errors=True)
                summary["removed"] += 1
        logger.info("equipment_photo_upload_cleanup dry_run=%s %s", dry_run, summary)
        return summary
    finally:
        _cleanup_lock.release()


def _maybe_cleanup() -> None:
    global _last_cleanup_at
    if not _cleanup_enabled() or time.time() - _last_cleanup_at < CLEANUP_INTERVAL_SECONDS:
        return
    _last_cleanup_at = time.time()
    try:
        cleanup_expired(dry_run=False)
    except Exception:
        logger.warning("equipment_photo_upload_cleanup failed", exc_info=True)
