"""Upload browser probe batches to inventory/browser-probe."""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Collection, Dict, List, Set

import requests

logger = logging.getLogger("browser_probe.sync")

MAX_BATCH_BYTES = 16 * 1024 * 1024
CONFIRMED_SCREENSHOT_MAX_AGE_SEC = 7 * 86400
CONFIRMED_SCREENSHOT_MAX_BYTES = 256 * 1024 * 1024
_QUEUE_FIELDS = (
    ("visits", b',"visits":['),
    ("focus_events", b',"focus_events":['),
    ("screenshots", b',"media":['),
)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _write_queue_file(path: Path, data: Dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(_json_bytes(data))
    temporary.replace(path)


class BrowserProbeSync:
    def __init__(
        self,
        output_dir: Path,
        *,
        server_url: str = "",
        api_key: str = "",
        sync_interval_sec: int = 120,
        max_media_mb: int = 8,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.server_url = str(server_url or "").rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.sync_interval_sec = max(30, int(sync_interval_sec))
        self.max_media_bytes = max_media_mb * 1024 * 1024
        self._last_sync = 0.0
        self._uploaded_media: Set[str] = set()
        self._cursor_path = self.output_dir / "sync_cursor.json"
        self._pending_path = self.output_dir / "pending_upload.json"
        self._inflight_path = self.output_dir / "inflight_upload.json"
        self._queue_lock = threading.Lock()
        self._sync_lock = threading.Lock()
        self._session = requests.Session()
        self._load_cursor()

    def _load_cursor(self) -> None:
        if not self._cursor_path.exists():
            self._cursor = {"uploaded_media": []}
            return
        try:
            data = json.loads(self._cursor_path.read_text(encoding="utf-8"))
            self._cursor = data if isinstance(data, dict) else {"uploaded_media": []}
            self._uploaded_media = set(self._cursor.get("uploaded_media") or [])
        except Exception:
            self._cursor = {"uploaded_media": []}

    def _save_cursor(self) -> None:
        self._cursor["uploaded_media"] = sorted(self._uploaded_media)[-5000:]
        self._uploaded_media = set(self._cursor["uploaded_media"])
        _write_queue_file(self._cursor_path, self._cursor)

    def enqueue(self, payload: Dict[str, Any]) -> None:
        """Merge a batch into pending_upload.json for the next POST."""
        with self._queue_lock:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            pending = self._read_queue(self._pending_path)
            for key, _ in _QUEUE_FIELDS:
                items = payload.get(key)
                if isinstance(items, list):
                    pending[key].extend(items)
            for key in ("computer_name", "windows_user"):
                if payload.get(key):
                    pending[key] = payload[key]
            # Keep the existing limits for data awaiting its first upload.
            pending["visits"] = pending["visits"][-2000:]
            pending["focus_events"] = pending["focus_events"][-1000:]
            pending["screenshots"] = pending["screenshots"][-200:]
            _write_queue_file(self._pending_path, pending)

    def _read_queue(self, path: Path) -> Dict[str, Any]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            data = {}
        if not isinstance(data, dict):
            raise ValueError(f"Invalid browser probe queue: {path.name}")
        for key, _ in _QUEUE_FIELDS:
            if not isinstance(data.get(key), list):
                data[key] = []
        return data

    def _claim_pending(self) -> bool:
        with self._queue_lock:
            if not self._inflight_path.exists():
                try:
                    self._pending_path.replace(self._inflight_path)
                except FileNotFoundError:
                    return False
            return True

    def maybe_sync(self, *, force: bool = False) -> None:
        if not self._sync_lock.acquire(blocking=force):
            return
        try:
            if not force and time.monotonic() - self._last_sync < self.sync_interval_sec:
                return
            try:
                self._sync_and_prune()
            except Exception as exc:
                logger.warning("browser probe sync failed: %s", exc)
            self._last_sync = time.monotonic()
        finally:
            self._sync_lock.release()

    def _upload_url(self) -> str:
        base = self.server_url
        if not base:
            return ""
        if base.endswith("/inventory"):
            return f"{base}/browser-probe"
        if base.endswith("/browser-probe"):
            return base
        return f"{base.rstrip('/')}/browser-probe"

    def _encode_screenshot(self, shot: Any, sent_names: Collection[str]) -> tuple[Path, bytes] | None:
        if not isinstance(shot, dict):
            return None
        rel = str(shot.get("file") or shot.get("path") or "").replace("\\", "/").strip()
        if not rel:
            return None
        name = rel.split("/")[-1]
        if name in self._uploaded_media or name in sent_names:
            return None
        path = self.output_dir / rel.replace("/", os.sep)
        if not path.is_file():
            path = self.output_dir / "screenshots" / name
        try:
            with path.open("rb") as file:
                raw = file.read(self.max_media_bytes + 1)
        except FileNotFoundError:
            return None
        if len(raw) > self.max_media_bytes:
            logger.debug("skip screenshot %s exceeding %s bytes", name, self.max_media_bytes)
            return None
        if not raw:
            return None
        metadata = _json_bytes({"name": name, "content_type": "image/png"})
        encoded = b"".join((metadata[:-1], b',"content_base64":"', base64.b64encode(raw), b'"}'))
        return path, encoded

    def _build_batch(self, pending: Dict[str, Any]) -> tuple[bytes, Dict[str, int], Dict[str, Path]]:
        identity = {
            "computer_name": str(pending.get("computer_name") or os.getenv("COMPUTERNAME", "")).strip(),
            "windows_user": str(pending.get("windows_user") or os.getenv("USERNAME", "")).strip(),
        }
        prefix = _json_bytes(identity)[:-1]
        # Reserve bytes for every JSON field and closing bracket before adding records.
        size = empty_size = len(prefix) + sum(len(field) + 1 for _, field in _QUEUE_FIELDS) + 1
        parts: List[bytes] = [prefix]
        consumed = {key: 0 for key, _ in _QUEUE_FIELDS}
        sent_files: Dict[str, Path] = {}
        full = False
        for key, field in _QUEUE_FIELDS:
            parts.append(field)
            separator = b""
            for record in pending[key]:
                if full:
                    break
                media_path = None
                if key == "screenshots":
                    media = self._encode_screenshot(record, sent_files)
                    if media is None:
                        consumed[key] += 1
                        continue
                    media_path, encoded = media
                else:
                    encoded = _json_bytes(record)
                record_size = len(encoded) + len(separator)
                if size + record_size > MAX_BATCH_BYTES:
                    if size == empty_size:
                        raise ValueError(f"Browser probe {key} record exceeds upload limit")
                    full = True
                    break
                parts.extend((separator, encoded))
                size += record_size
                separator = b","
                consumed[key] += 1
                if media_path is not None:
                    sent_files[media_path.name] = media_path
            parts.append(b"]")
        parts.append(b"}")
        return b"".join(parts) if size > empty_size else b"", consumed, sent_files

    def _post_batch(self, url: str, body: bytes, media_count: int) -> None:
        resp = self._session.post(
            url,
            data=body,
            headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
            timeout=60,
        )
        if not 200 <= resp.status_code < 300:
            raise RuntimeError(f"browser-probe upload HTTP {resp.status_code}")
        try:
            ack = resp.json()
        except ValueError as exc:
            raise RuntimeError("browser-probe upload returned an invalid acknowledgement") from exc
        if not isinstance(ack, dict) or ack.get("success") is not True:
            raise RuntimeError("browser-probe upload was not acknowledged")
        if media_count and ack.get("media") != media_count:
            raise RuntimeError("browser-probe acknowledgement media count does not match the batch")

    def _confirmed_screenshot_dir(self) -> Path:
        directory = self.output_dir.resolve() / "screenshots" / "confirmed"
        if directory.resolve() != directory:
            raise OSError("confirmed screenshot directory points outside its expected path")
        return directory

    def _archive_confirmed_screenshots(self, files: Collection[Path]) -> None:
        try:
            directory = self._confirmed_screenshot_dir()
            for path in files:
                if path.suffix.lower() != ".png" or path.is_symlink() or path.parent.resolve() != directory.parent:
                    continue
                directory.mkdir(exist_ok=True)
                destination = directory / path.name
                if not destination.exists():
                    path.rename(destination)
        except OSError as exc:
            logger.warning("Browser probe could not archive confirmed screenshots: %s", exc)

    def _prune_confirmed_screenshots(self) -> None:
        try:
            directory = self._confirmed_screenshot_dir()
            if not directory.is_dir():
                return
            entries = []
            for path in directory.glob("*.png"):
                if path.is_file() and not path.is_symlink():
                    stat = path.stat()
                    entries.append((stat.st_mtime, path, stat.st_size))
            total_bytes = sum(size for _, _, size in entries)
            expires_before = time.time() - CONFIRMED_SCREENSHOT_MAX_AGE_SEC
            removed = 0
            for modified, path, size in sorted(entries):
                if modified >= expires_before and total_bytes <= CONFIRMED_SCREENSHOT_MAX_BYTES:
                    break
                path.unlink(missing_ok=True)
                total_bytes -= size
                removed += 1
            if removed:
                logger.info("Browser probe pruned %s confirmed screenshots; retained bytes=%s", removed, total_bytes)
        except OSError as exc:
            logger.warning("Browser probe could not prune confirmed screenshots: %s", exc)

    def sync_once(self) -> Dict[str, Any]:
        with self._sync_lock:
            return self._sync_and_prune()

    def _sync_and_prune(self) -> Dict[str, Any]:
        try:
            return self._sync_pending()
        finally:
            self._prune_confirmed_screenshots()

    def _sync_pending(self) -> Dict[str, Any]:
        stats = {"visits": 0, "focus_events": 0, "media": 0}
        url = self._upload_url()
        if not url or not self.api_key:
            logger.debug("browser sync skipped: no server_url/api_key")
            return {**stats, "skipped": True}

        # Finish a recovered snapshot and pick up pending data once. New data can
        # be enqueued without rewriting the snapshot while HTTP is in flight.
        for _ in range(2):
            if not self._claim_pending():
                break
            pending = self._read_queue(self._inflight_path)
            while any(pending[key] for key, _ in _QUEUE_FIELDS):
                body, consumed, sent_files = self._build_batch(pending)
                if body:
                    self._post_batch(url, body, len(sent_files))
                if sent_files:
                    self._uploaded_media.update(sent_files)
                    self._save_cursor()
                for key, count in consumed.items():
                    del pending[key][:count]
                _write_queue_file(self._inflight_path, pending)
                if sent_files:
                    self._archive_confirmed_screenshots(sent_files.values())
                stats["visits"] += consumed["visits"]
                stats["focus_events"] += consumed["focus_events"]
                stats["media"] += len(sent_files)
                if body:
                    logger.info(
                        "browser batch acknowledged bytes=%s visits=%s focus=%s media=%s",
                        len(body), consumed["visits"], consumed["focus_events"], len(sent_files),
                    )
                del body
            self._inflight_path.unlink()
        return stats
