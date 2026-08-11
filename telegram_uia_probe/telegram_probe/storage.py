"""Event persistence, deduplication helpers, output paths."""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .models import ProbeEvent

logger = logging.getLogger(__name__)


class OutputStore:
    def __init__(self, root: Path, *, fresh: bool = False) -> None:
        self.root = root
        self.events_path = root / "events.jsonl"
        self.report_path = root / "report.html"
        self.screenshots_dir = root / "screenshots"
        self.ui_trees_dir = root / "ui_trees"
        self.chats_dir = root / "chats"
        self.media_dir = root / "media"
        self.archive_dir = root / "archive"
        self.state_path = root / "state.json"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.ui_trees_dir.mkdir(parents=True, exist_ok=True)
        self.chats_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.root.mkdir(parents=True, exist_ok=True)
        if fresh:
            self.rotate_all()
        elif not self.events_path.exists():
            self.events_path.write_text("", encoding="utf-8")

        self._last_ui_hash: str | None = None
        self._last_screenshot_hash: str | None = None
        self._last_chat_key: str | None = None

    def rotate_all(self) -> Path | None:
        """Archive events/state/chats so a fresh long-run starts clean."""
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        batch = self.archive_dir / f"run_{stamp}"
        moved_anything = False

        def _move(src: Path, dest_name: str) -> None:
            nonlocal moved_anything
            if not src.exists():
                return
            if src.is_file() and src.stat().st_size == 0:
                src.unlink(missing_ok=True)
                return
            batch.mkdir(parents=True, exist_ok=True)
            dest = batch / dest_name
            shutil.move(str(src), str(dest))
            moved_anything = True

        _move(self.events_path, "events.jsonl")
        _move(self.state_path, "state.json")
        if self.chats_dir.exists() and any(self.chats_dir.glob("*.jsonl")):
            batch.mkdir(parents=True, exist_ok=True)
            shutil.move(str(self.chats_dir), str(batch / "chats"))
            moved_anything = True
        if self.media_dir.exists() and any(self.media_dir.iterdir()):
            batch.mkdir(parents=True, exist_ok=True)
            shutil.move(str(self.media_dir), str(batch / "media"))
            moved_anything = True
        if self.report_path.exists():
            batch.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(self.report_path, batch / "report.html")
            except Exception:  # noqa: BLE001
                pass

        self.chats_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.events_path.write_text("", encoding="utf-8")
        if moved_anything:
            logger.info("Previous run archived to %s", batch)
            return batch
        return None

    # Back-compat alias
    def rotate_events(self) -> Path | None:
        return self.rotate_all()

    @staticmethod
    def hash_text(parts: Iterable[str]) -> str:
        joined = "\n".join(parts)
        return hashlib.sha256(joined.encode("utf-8", errors="replace")).hexdigest()

    @staticmethod
    def hash_bytes(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def is_duplicate_ui(self, ui_hash: str | None) -> bool:
        if not ui_hash:
            return False
        return ui_hash == self._last_ui_hash

    def mark_ui(self, ui_hash: str | None) -> None:
        if ui_hash:
            self._last_ui_hash = ui_hash

    def is_duplicate_screenshot(self, shot_hash: str | None) -> bool:
        if not shot_hash:
            return False
        return shot_hash == self._last_screenshot_hash

    def mark_screenshot(self, shot_hash: str | None) -> None:
        if shot_hash:
            self._last_screenshot_hash = shot_hash

    def chat_changed(self, chat_key: str | None) -> bool:
        changed = chat_key != self._last_chat_key
        self._last_chat_key = chat_key
        return changed

    def reset_session_dedup(self) -> None:
        self._last_ui_hash = None
        self._last_screenshot_hash = None
        self._last_chat_key = None

    def append_event(self, event: ProbeEvent) -> None:
        line = json.dumps(event.to_dict(), ensure_ascii=False)
        with self.events_path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        logger.debug("event saved: %s", event.event_type)

    def load_events(self) -> list[dict[str, Any]]:
        if not self.events_path.exists():
            return []
        events: list[dict[str, Any]] = []
        with self.events_path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    logger.warning("skip broken jsonl line")
        return events

    def save_ui_tree(self, session_id: str, stamp: str, nodes: list[dict[str, Any]]) -> str:
        name = f"{session_id}_{stamp}.json"
        path = self.ui_trees_dir / name
        path.write_text(
            json.dumps(nodes, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return str(path.relative_to(self.root)).replace("\\", "/")
