"""Filesystem-backed chat upload session manifests."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Callable, Optional

from backend.chat.utils import normalize_text as _normalize_text


def _parse_dt(value: object) -> Optional[datetime]:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _duration_seconds_or_none(value: object) -> int | None:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


class ChatUploadSessionStore:
    def __init__(
        self,
        *,
        upload_sessions_root: Callable[[], Path],
        chunk_size_bytes: Callable[[], int],
        ttl_sec: Callable[[], int],
        cleanup_interval_sec: Callable[[], int],
        normalize_transfer_encoding: Callable[[object], str],
        now: Callable[[], datetime],
    ) -> None:
        self._upload_sessions_root = upload_sessions_root
        self._chunk_size_bytes = chunk_size_bytes
        self._ttl_sec = ttl_sec
        self._cleanup_interval_sec = cleanup_interval_sec
        self._normalize_transfer_encoding = normalize_transfer_encoding
        self._now = now
        self._locks_lock = RLock()
        self._locks: dict[str, RLock] = {}
        self._last_cleanup_at: datetime | None = None

    @property
    def chunk_size_bytes(self) -> int:
        return int(self._chunk_size_bytes())

    @property
    def ttl_sec(self) -> int:
        return int(self._ttl_sec())

    @property
    def cleanup_interval_sec(self) -> int:
        return int(self._cleanup_interval_sec())

    def lock_for(self, session_id: str) -> RLock:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            raise ValueError("session_id is required")
        with self._locks_lock:
            lock = self._locks.get(normalized_session_id)
            if lock is None:
                lock = RLock()
                self._locks[normalized_session_id] = lock
            return lock

    def release_lock(self, session_id: str) -> None:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            return
        with self._locks_lock:
            self._locks.pop(normalized_session_id, None)

    def session_dir(self, session_id: str) -> Path:
        normalized_session_id = _normalize_text(session_id)
        if not normalized_session_id:
            raise ValueError("session_id is required")
        root = self._upload_sessions_root().resolve()
        session_dir = (root / normalized_session_id).resolve()
        try:
            session_dir.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid upload session path") from exc
        return session_dir

    def manifest_path(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "manifest.json"

    def part_path(self, session_id: str, file_id: str) -> Path:
        normalized_file_id = _normalize_text(file_id)
        if not normalized_file_id:
            raise ValueError("file_id is required")
        session_dir = self.session_dir(session_id)
        file_path = (session_dir / f"{Path(normalized_file_id).name}.part").resolve()
        try:
            file_path.relative_to(session_dir)
        except ValueError as exc:
            raise ValueError("Invalid upload session file path") from exc
        return file_path

    def load_manifest(self, session_id: str) -> dict[str, Any]:
        manifest_path = self.manifest_path(session_id)
        if not manifest_path.exists() or not manifest_path.is_file():
            raise LookupError("Upload session not found")
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise LookupError("Upload session not found") from exc
        if not isinstance(payload, dict):
            raise LookupError("Upload session not found")
        return payload

    def write_manifest(self, manifest: dict[str, Any]) -> None:
        session_id = _normalize_text(manifest.get("session_id"))
        if not session_id:
            raise ValueError("Upload session manifest is missing session_id")
        session_dir = self.session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = session_dir / "manifest.json"
        temp_path = session_dir / "manifest.json.tmp"
        temp_path.write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temp_path.replace(manifest_path)

    def delete_session_dir(self, session_id: str) -> None:
        session_dir = self.session_dir(session_id)
        shutil.rmtree(session_dir, ignore_errors=True)
        self.release_lock(session_id)

    def maybe_cleanup(self, *, force: bool = False) -> None:
        now = self._now()
        if not force and self._last_cleanup_at is not None:
            elapsed = (now - self._last_cleanup_at).total_seconds()
            if elapsed < self.cleanup_interval_sec:
                return
        self.cleanup_expired(force=True, now=now)

    def cleanup_expired(self, *, force: bool = False, now: datetime | None = None) -> dict[str, int]:
        current_now = now or self._now()
        deleted = 0
        if not force and self._last_cleanup_at is not None:
            elapsed = (current_now - self._last_cleanup_at).total_seconds()
            if elapsed < self.cleanup_interval_sec:
                return {"deleted": 0}
        root = self._upload_sessions_root()
        root.mkdir(parents=True, exist_ok=True)
        for session_dir in list(root.iterdir()):
            if not session_dir.is_dir():
                continue
            session_id = _normalize_text(session_dir.name)
            lock = self.lock_for(session_id)
            with lock:
                try:
                    manifest = self.load_manifest(session_id)
                except LookupError:
                    self.delete_session_dir(session_id)
                    deleted += 1
                    continue
                status = _normalize_text(manifest.get("status")).lower() or "pending"
                expires_at = _parse_dt(manifest.get("expires_at"))
                if status == "pending" and expires_at and expires_at <= current_now:
                    self.delete_session_dir(session_id)
                    deleted += 1
        self._last_cleanup_at = current_now
        return {"deleted": deleted}

    def ensure_active(self, manifest: dict[str, Any]) -> None:
        if _normalize_text(manifest.get("status")).lower() == "completed":
            return
        session_id = _normalize_text(manifest.get("session_id"))
        expires_at = _parse_dt(manifest.get("expires_at"))
        if expires_at is None or expires_at > self._now():
            return
        self.delete_session_dir(session_id)
        raise LookupError("Upload session not found")

    def serialize_file(self, file_payload: dict[str, Any]) -> dict[str, Any]:
        received_chunks = sorted({
            int(item)
            for item in list(file_payload.get("received_chunks") or [])
            if isinstance(item, int) or str(item).strip().isdigit()
        })
        return {
            "file_id": _normalize_text(file_payload.get("file_id")),
            "file_name": _normalize_text(file_payload.get("file_name")),
            "mime_type": _normalize_text(file_payload.get("mime_type")) or None,
            "media_kind": _normalize_text(file_payload.get("media_kind")) or None,
            "duration_seconds": _duration_seconds_or_none(file_payload.get("duration_seconds")),
            "size": int(file_payload.get("size", 0) or 0),
            "original_size": int(file_payload.get("original_size", 0) or 0),
            "transfer_encoding": self._normalize_transfer_encoding(file_payload.get("transfer_encoding")),
            "chunk_count": int(file_payload.get("chunk_count", 0) or 0),
            "received_bytes": int(file_payload.get("received_bytes", 0) or 0),
            "received_chunks": received_chunks,
        }

    def serialize_manifest(self, manifest: dict[str, Any]) -> dict[str, Any]:
        return {
            "session_id": _normalize_text(manifest.get("session_id")),
            "chunk_size_bytes": int(manifest.get("chunk_size_bytes", self.chunk_size_bytes) or self.chunk_size_bytes),
            "expires_at": _normalize_text(manifest.get("expires_at")),
            "status": "completed" if _normalize_text(manifest.get("status")).lower() == "completed" else "pending",
            "message_id": _normalize_text(manifest.get("message_id")) or None,
            "files": [
                self.serialize_file(item)
                for item in list(manifest.get("files") or [])
                if isinstance(item, dict)
            ],
        }

    @staticmethod
    def find_file(manifest: dict[str, Any], *, file_id: str) -> dict[str, Any]:
        normalized_file_id = _normalize_text(file_id)
        for item in list(manifest.get("files") or []):
            if _normalize_text(item.get("file_id")) == normalized_file_id:
                return item
        raise LookupError("Upload session file not found")
