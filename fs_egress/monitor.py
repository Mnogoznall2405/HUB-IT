from __future__ import annotations

import logging
import threading
import time
from collections import deque
from pathlib import Path
from typing import Deque, Dict, Tuple

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .events import build_file_left
from .roots import (
    classify_path,
    iter_remote_roots,
    iter_removable_roots,
    iter_user_profile_roots,
    should_ignore_path,
    unique_existing,
)
from .spool import EgressSpool

logger = logging.getLogger("fs_egress.monitor")


class _EgressHandler(FileSystemEventHandler):
    """USB / network: create+move = file left the PC."""

    def __init__(self, monitor: "FsEgressMonitor", channel: str) -> None:
        super().__init__()
        self.monitor = monitor
        self.channel = channel

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self.monitor.offer(str(event.src_path), channel=self.channel, kind="created")

    def on_moved(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        dest = getattr(event, "dest_path", None) or event.src_path
        src = str(event.src_path)
        self.monitor.offer(str(dest), channel=self.channel, kind="moved", src_path=src)


class _ProfileDeleteHandler(FileSystemEventHandler):
    """Profile roots: only deletions (secondary signal, not egress)."""

    def __init__(self, monitor: "FsEgressMonitor") -> None:
        super().__init__()
        self.monitor = monitor

    def on_deleted(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self.monitor.offer(str(event.src_path), channel="deleted", kind="deleted")

    def on_moved(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        dest = str(getattr(event, "dest_path", "") or "")
        # Recycle Bin moves look like deletes from the user POV.
        if "$recycle.bin" in dest.lower():
            self.monitor.offer(
                str(event.src_path),
                channel="deleted",
                kind="recycle",
                src_path=str(event.src_path),
            )


class FsEgressMonitor:
    def __init__(
        self,
        spool: EgressSpool,
        *,
        debounce_sec: float = 0.75,
        rate_limit_per_sec: int = 30,
        roots_refresh_sec: float = 30.0,
        watch_profile_deletes: bool = True,
    ) -> None:
        self.spool = spool
        self.debounce_sec = debounce_sec
        self.rate_limit_per_sec = rate_limit_per_sec
        self.roots_refresh_sec = roots_refresh_sec
        self.watch_profile_deletes = watch_profile_deletes
        self._observer = Observer()
        self._lock = threading.Lock()
        self._pending: Dict[str, Tuple[float, str, str]] = {}
        self._recent_ts: Deque[float] = deque()
        self._watched: Dict[str, object] = {}
        self._dropped = 0
        self._stop = threading.Event()

    @property
    def dropped(self) -> int:
        return self._dropped

    def start(self) -> None:
        self._refresh_roots(force=True)
        self._observer.start()
        logger.info("fs_egress observer started (watches=%d)", len(self._watched))

    def stop(self) -> None:
        self._stop.set()
        try:
            self._observer.stop()
            self._observer.join(timeout=5)
        except Exception:
            pass

    def offer(
        self,
        path: str,
        *,
        channel: str,
        kind: str,
        src_path: str = "",
    ) -> None:
        if should_ignore_path(path):
            return
        now = time.monotonic()
        with self._lock:
            while self._recent_ts and (now - self._recent_ts[0]) > 1.0:
                self._recent_ts.popleft()
            if len(self._recent_ts) >= self.rate_limit_per_sec:
                self._dropped += 1
                return
            self._recent_ts.append(now)
            key = f"{channel}|{path.lower()}"
            self._pending[key] = (now, channel, src_path)

    def flush_due(self) -> int:
        now = time.monotonic()
        due: list[tuple[str, str, str]] = []
        with self._lock:
            for key, (ts, channel, src_path) in list(self._pending.items()):
                if (now - ts) >= self.debounce_sec:
                    path = key.split("|", 1)[1]
                    due.append((path, channel, src_path))
                    del self._pending[key]
        count = 0
        for path, channel, src_path in due:
            resolved_channel = channel
            if channel not in {"usb", "network", "deleted", "telegram"}:
                resolved_channel = classify_path(path)
                if resolved_channel in {"local", "unknown"}:
                    continue
            event = build_file_left(
                channel=resolved_channel,
                dest_path=path if resolved_channel != "deleted" else path,
                src_path=src_path,
                compute_hash=resolved_channel in {"usb", "network"},
                details={"kind": "fs_watch"},
            )
            self.spool.enqueue(event.to_dict())
            count += 1
        return count

    def refresh_if_due(self, *, last_refresh: float) -> float:
        now = time.monotonic()
        if (now - last_refresh) < self.roots_refresh_sec:
            return last_refresh
        self._refresh_roots(force=False)
        return now

    def _refresh_roots(self, *, force: bool) -> None:
        desired: Dict[str, str] = {}
        for path in unique_existing(iter_removable_roots()):
            desired[str(path).lower()] = "usb"
        for path in unique_existing(iter_remote_roots()):
            desired[str(path).lower()] = "network"
        if self.watch_profile_deletes:
            for path in unique_existing(iter_user_profile_roots()):
                desired[str(path).lower()] = "profile_delete"

        current_keys = set(self._watched.keys())
        desired_keys = set(desired.keys())
        for key in current_keys - desired_keys:
            watch = self._watched.pop(key, None)
            if watch is not None:
                try:
                    self._observer.unschedule(watch)
                except Exception:
                    pass
                logger.info("fs_egress unwatch %s", key)
        for key in desired_keys - current_keys:
            channel = desired[key]
            path = Path(key)
            try:
                if channel == "profile_delete":
                    handler: FileSystemEventHandler = _ProfileDeleteHandler(self)
                else:
                    handler = _EgressHandler(self, channel=channel)
                watch = self._observer.schedule(handler, str(path), recursive=True)
                self._watched[key] = watch
                logger.info("fs_egress watch %s (%s)", path, channel)
            except Exception as exc:
                logger.warning("fs_egress failed to watch %s: %s", path, exc)
        if force and not desired:
            logger.info("fs_egress: no USB/network/profile roots yet")
