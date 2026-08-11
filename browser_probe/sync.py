"""Upload browser probe batches to inventory/browser-probe."""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Set

import requests

logger = logging.getLogger("browser_probe.sync")


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
        self._cursor_path.write_text(
            json.dumps(self._cursor, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def enqueue(self, payload: Dict[str, Any]) -> None:
        """Merge a batch into pending_upload.json for the next POST."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        pending = self._read_pending()
        for key in ("visits", "focus_events", "screenshots"):
            items = payload.get(key) if isinstance(payload.get(key), list) else []
            pending.setdefault(key, []).extend(items)
        if payload.get("computer_name"):
            pending["computer_name"] = payload["computer_name"]
        if payload.get("windows_user"):
            pending["windows_user"] = payload["windows_user"]
        self._write_pending(pending)

    def _read_pending(self) -> Dict[str, Any]:
        if not self._pending_path.exists():
            return {"visits": [], "focus_events": [], "screenshots": []}
        try:
            data = json.loads(self._pending_path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {"visits": [], "focus_events": [], "screenshots": []}
            for key in ("visits", "focus_events", "screenshots"):
                if not isinstance(data.get(key), list):
                    data[key] = []
            return data
        except Exception:
            return {"visits": [], "focus_events": [], "screenshots": []}

    def _write_pending(self, data: Dict[str, Any]) -> None:
        # Cap queues to avoid unbounded growth offline.
        data["visits"] = list(data.get("visits") or [])[-2000:]
        data["focus_events"] = list(data.get("focus_events") or [])[-1000:]
        data["screenshots"] = list(data.get("screenshots") or [])[-200:]
        self._pending_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def maybe_sync(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_sync) < self.sync_interval_sec:
            return
        try:
            self.sync_once()
        except Exception as exc:
            logger.warning("browser probe sync failed: %s", exc)
        self._last_sync = time.monotonic()

    def _upload_url(self) -> str:
        base = self.server_url
        if not base:
            return ""
        if base.endswith("/inventory"):
            return f"{base}/browser-probe"
        if base.endswith("/browser-probe"):
            return base
        return f"{base.rstrip('/')}/browser-probe"

    def sync_once(self) -> Dict[str, Any]:
        pending = self._read_pending()
        visits = list(pending.get("visits") or [])
        focus_events = list(pending.get("focus_events") or [])
        screenshot_meta = list(pending.get("screenshots") or [])
        if not visits and not focus_events and not screenshot_meta:
            return {"visits": 0, "focus_events": 0, "media": 0}

        computer_name = str(
            pending.get("computer_name") or os.environ.get("COMPUTERNAME", "") or ""
        ).strip()
        windows_user = str(
            pending.get("windows_user") or os.environ.get("USERNAME", "") or ""
        ).strip()

        media_items: List[Dict[str, Any]] = []
        for shot in screenshot_meta:
            if not isinstance(shot, dict):
                continue
            rel = str(shot.get("file") or shot.get("path") or "").replace("\\", "/").strip()
            if not rel:
                continue
            name = rel.split("/")[-1]
            if name in self._uploaded_media:
                continue
            path = self.output_dir / rel.replace("/", os.sep)
            if not path.is_file():
                # also try basename under screenshots/
                alt = self.output_dir / "screenshots" / name
                path = alt if alt.is_file() else path
            if not path.is_file():
                continue
            try:
                raw = path.read_bytes()
            except OSError:
                continue
            if len(raw) > self.max_media_bytes:
                logger.debug("skip large screenshot %s (%s bytes)", name, len(raw))
                continue
            media_items.append(
                {
                    "name": name,
                    "content_type": "image/png",
                    "content_base64": base64.b64encode(raw).decode("ascii"),
                }
            )
            self._uploaded_media.add(name)

        url = self._upload_url()
        if not url or not self.api_key:
            logger.debug("browser sync skipped: no server_url/api_key")
            return {"visits": 0, "focus_events": 0, "media": 0, "skipped": True}

        body = {
            "computer_name": computer_name,
            "windows_user": windows_user,
            "visits": visits,
            "focus_events": focus_events,
            "media": media_items,
        }
        resp = self._session.post(
            url,
            json=body,
            headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
            timeout=60,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"browser-probe upload HTTP {resp.status_code}: {resp.text[:300]}")

        # Clear successfully uploaded queues (keep only leftover if partial — here full clear).
        self._write_pending(
            {
                "visits": [],
                "focus_events": [],
                "screenshots": [],
                "computer_name": computer_name,
                "windows_user": windows_user,
            }
        )
        self._save_cursor()
        stats = {
            "visits": len(visits),
            "focus_events": len(focus_events),
            "media": len(media_items),
        }
        logger.info(
            "browser sync visits=%s focus=%s media=%s",
            stats["visits"],
            stats["focus_events"],
            stats["media"],
        )
        return stats
