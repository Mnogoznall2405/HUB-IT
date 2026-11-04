from __future__ import annotations

import json
import logging
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger("fs_egress.spool")

DEFAULT_SPOOL_ROOT = (
    Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "Agent" / "Spool" / "fs_egress"
)


class EgressSpool:
    def __init__(
        self,
        root: Optional[Path] = None,
        *,
        server_url: str = "",
        api_key: str = "",
        max_pending: int = 5000,
        max_age_days: int = 14,
    ) -> None:
        self.root = Path(root or DEFAULT_SPOOL_ROOT)
        self.pending = self.root / "pending"
        self.sent = self.root / "sent"
        self.dead = self.root / "dead_letter"
        self.inbox = self.root / "inbox"
        for folder in (self.pending, self.sent, self.dead, self.inbox):
            folder.mkdir(parents=True, exist_ok=True)
        self.server_url = str(server_url or "").rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.max_pending = max_pending
        self.max_age_days = max_age_days
        self._session = requests.Session()

    def enqueue(self, event: Dict[str, Any]) -> Path:
        self._prune()
        item_id = str(event.get("event_id") or uuid.uuid4().hex)
        payload = dict(event)
        payload["event_id"] = item_id
        path = self.pending / f"{int(time.time())}_{item_id}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return path

    def ingest_inbox(self) -> int:
        count = 0
        for path in sorted(self.inbox.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self.enqueue(data)
                    count += 1
                path.unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("Failed to ingest inbox %s: %s", path, exc)
        return count

    def drain(self, *, batch_size: int = 50) -> Dict[str, int]:
        self.ingest_inbox()
        stats = {"sent": 0, "failed": 0, "dead": 0}
        if not self.server_url or not self.api_key:
            return stats
        files = sorted(self.pending.glob("*.json"))[: max(1, batch_size)]
        if not files:
            return stats
        events: List[Dict[str, Any]] = []
        paths: List[Path] = []
        for path in files:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                if self._move(path, self.dead):
                    stats["dead"] += 1
                else:
                    stats["failed"] += 1
                continue
            if isinstance(payload, dict):
                events.append(payload)
                paths.append(path)
        if not events:
            return stats
        ok = self._post_batch(events)
        if ok:
            for path in paths:
                if not self._move(path, self.sent):
                    # The server already has the event; keeping it pending would only resend it.
                    path.unlink(missing_ok=True)
                stats["sent"] += 1
        else:
            stats["failed"] += len(paths)
        return stats

    def _post_batch(self, events: List[Dict[str, Any]]) -> bool:
        url = self.server_url
        if url.endswith("/inventory"):
            url = f"{url}/fs-egress"
        elif not url.endswith("/fs-egress"):
            url = f"{url.rstrip('/')}/fs-egress"
        try:
            response = self._session.post(
                url,
                json={"events": events},
                headers={"X-API-Key": self.api_key, "Content-Type": "application/json"},
                timeout=30,
            )
            if response.status_code >= 400:
                logger.warning("fs-egress POST %s → %s %s", url, response.status_code, response.text[:200])
                return False
            return True
        except Exception as exc:
            logger.warning("fs-egress POST failed: %s", exc)
            return False

    def _move(self, src: Path, dest_dir: Path) -> bool:
        """Hand ``src`` over to ``dest_dir``; the source is removed only after a verified move.

        On any failure the pending file stays where it is, so the event is retried instead of
        being lost together with its only durable copy.
        """
        try:
            dest_dir.mkdir(parents=True, exist_ok=True)
            target = dest_dir / src.name
            if target.exists():
                target.unlink()
            shutil.move(str(src), str(target))
            return target.exists() and not src.exists()
        except Exception as exc:
            logger.warning("fs-egress move %s -> %s failed, event kept: %s", src, dest_dir, exc)
            return False

    def _prune(self) -> None:
        pending = sorted(self.pending.glob("*.json"), key=lambda p: p.stat().st_mtime)
        while len(pending) > self.max_pending:
            oldest = pending.pop(0)
            self._move(oldest, self.dead)
        cutoff = time.time() - self.max_age_days * 86400
        for folder in (self.sent, self.dead):
            for path in folder.glob("*.json"):
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink(missing_ok=True)
                except OSError:
                    continue
