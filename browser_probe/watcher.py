"""Main loop: History delta + foreground dwell + screenshots on title change."""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from .classify import classify_visit, is_noise_visit
from .foreground import ForegroundTracker
from .history import (
    bootstrap_cursors,
    discover_profiles,
    read_recent_title_urls,
    read_visits_since,
)
from .screenshot import capture_window
from .sync import BrowserProbeSync

log = logging.getLogger("browser_probe.watcher")


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class BrowserProbeWatcher:
    def __init__(
        self,
        output_dir: Path,
        *,
        syncer: BrowserProbeSync | None = None,
        history_interval_sec: float | None = None,
        foreground_poll_sec: float | None = None,
        screenshot_throttle_sec: float | None = None,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.screenshots_dir = self.output_dir / "screenshots"
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.output_dir / "state.json"
        self.syncer = syncer
        self.history_interval_sec = max(
            30.0,
            float(
                history_interval_sec
                if history_interval_sec is not None
                else _env_float("ITINV_BROWSER_PROBE_HISTORY_SEC", 180)
            ),
        )
        self.foreground_poll_sec = max(
            1.0,
            float(
                foreground_poll_sec
                if foreground_poll_sec is not None
                else _env_float("ITINV_BROWSER_PROBE_POLL_SEC", 3)
            ),
        )
        self.screenshot_throttle_sec = max(
            5.0,
            float(
                screenshot_throttle_sec
                if screenshot_throttle_sec is not None
                else _env_float("ITINV_BROWSER_PROBE_SHOT_THROTTLE_SEC", 30)
            ),
        )
        self._stop = False
        self._tracker = ForegroundTracker()
        self._last_history = 0.0
        self._last_shot_mono = 0.0
        self._last_shot_key = ""
        self._last_shot_file = ""
        self._shots_by_key: Dict[str, str] = {}
        self._fg_key: str | None = None
        self._cursors: Dict[str, int] = {}
        # Recent History title→url for enriching focus when omnibox UIA is empty.
        self._title_url_cache: Dict[str, str] = {}
        self._load_state()

    def request_stop(self) -> None:
        self._stop = True

    def _identity(self) -> tuple[str, str]:
        return (
            str(os.environ.get("USERNAME", "") or ""),
            str(os.environ.get("COMPUTERNAME", "") or ""),
        )

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            cursors = data.get("visit_cursors") if isinstance(data, dict) else None
            if isinstance(cursors, dict):
                self._cursors = {str(k): int(v or 0) for k, v in cursors.items()}
        except Exception:
            self._cursors = {}

    def _save_state(self) -> None:
        windows_user, computer_name = self._identity()
        payload = {
            "windows_user": windows_user,
            "computer_name": computer_name,
            "visit_cursors": self._cursors,
            "updated_at": _utcnow_iso(),
        }
        self.state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _ensure_cursors(self, profiles) -> None:
        if self._cursors:
            return
        boot = bootstrap_cursors(profiles, work_dir=self.output_dir / "hist_tmp")
        self._cursors.update(boot)
        self._save_state()
        log.info("browser probe cursors bootstrapped for %s profiles", len(boot))

    def _warm_title_url_cache(self, profiles) -> None:
        for profile in profiles:
            mapping = read_recent_title_urls(
                profile,
                limit=300,
                work_dir=self.output_dir / "hist_tmp",
            )
            browser = str(profile.browser or "").strip().lower()
            for title, url in mapping.items():
                self._title_url_cache[f"{browser}|{title}"] = url

    def _poll_history(self) -> List[Dict[str, Any]]:
        profiles = discover_profiles()
        if not profiles:
            return []
        self._ensure_cursors(profiles)
        self._warm_title_url_cache(profiles)
        visits: List[Dict[str, Any]] = []
        for profile in profiles:
            key = f"{profile.browser}|{profile.profile}"
            since = int(self._cursors.get(key, 0) or 0)
            rows = read_visits_since(
                profile,
                since_visit_id=since,
                limit=400,
                work_dir=self.output_dir / "hist_tmp",
            )
            if not rows:
                continue
            max_id = since
            for row in rows:
                cursor_id = int(row.get("_cursor_visit_id") or row.get("visit_id") or 0)
                if cursor_id > max_id:
                    max_id = cursor_id
                if row.get("_noise_cursor_only"):
                    continue
                row.pop("_cursor_visit_id", None)
                visits.append(row)
            if max_id > since:
                self._cursors[key] = max_id
            # Refresh title→url hints from the newest rows (even noise-filtered ones).
            for row in rows[-80:]:
                t = str(row.get("title") or "").strip().lower()
                u = str(row.get("url") or "").strip()
                b = str(row.get("browser") or profile.browser or "").strip().lower()
                if t and u and b:
                    self._title_url_cache[f"{b}|{t}"] = u
        if self._cursors:
            self._save_state()
        return visits

    def _enrich_focus_url(self, event: Dict[str, Any]) -> None:
        if str(event.get("url") or "").strip():
            return
        browser = str(event.get("browser") or "").strip().lower()
        title = str(event.get("title") or "").strip().lower()
        if not browser or not title:
            return
        url = self._title_url_cache.get(f"{browser}|{title}", "")
        if url:
            event["url"] = url

    @staticmethod
    def _shot_key(browser: str, title: str, url: str = "") -> str:
        # Prefer URL so SPA title flicker keeps the same screenshot slot.
        url_part = str(url or "").strip().lower()
        title_part = str(title or "").strip().lower()
        return f"{browser}|{url_part or title_part}"

    def _maybe_screenshot(self, snap, *, title_changed: bool) -> Dict[str, Any] | None:
        if snap is None or not title_changed:
            return None
        key = self._shot_key(snap.browser, snap.page_title, getattr(snap, "url", "") or "")
        now = time.monotonic()
        if key == self._last_shot_key:
            return None
        if (now - self._last_shot_mono) < self.screenshot_throttle_sec:
            return None
        prefix = f"{snap.browser}"
        rel, _png, err = capture_window(snap.hwnd, self.screenshots_dir, prefix)
        self._last_shot_mono = now
        self._last_shot_key = key
        if not rel:
            log.debug("screenshot skipped: %s", err)
            return None
        name = rel.split("/")[-1]
        self._last_shot_file = name
        self._shots_by_key[key] = name
        return {
            "file": rel,
            "browser": snap.browser,
            "title": snap.page_title,
            "window_title": snap.title,
            "url": getattr(snap, "url", "") or "",
            "captured_at": _utcnow_iso(),
        }

    def _enqueue(self, *, visits=None, focus_events=None, screenshots=None) -> None:
        if not self.syncer:
            return
        windows_user, computer_name = self._identity()
        payload = {
            "computer_name": computer_name,
            "windows_user": windows_user,
            "visits": visits or [],
            "focus_events": focus_events or [],
            "screenshots": screenshots or [],
        }
        if payload["visits"] or payload["focus_events"] or payload["screenshots"]:
            self.syncer.enqueue(payload)

    def run(self) -> None:
        log.info(
            "browser probe watcher start history=%ss poll=%ss shot_throttle=%ss",
            self.history_interval_sec,
            self.foreground_poll_sec,
            self.screenshot_throttle_sec,
        )
        while not self._stop:
            try:
                snap, closed = self._tracker.poll()
                focus_batch: List[Dict[str, Any]] = []
                shot_batch: List[Dict[str, Any]] = []
                fg_key = None
                if snap is not None:
                    fg_key = self._shot_key(
                        snap.browser,
                        snap.page_title,
                        getattr(snap, "url", "") or "",
                    )
                title_changed = bool(fg_key and fg_key != self._fg_key)
                if closed:
                    self._enrich_focus_url(closed)
                    closed_title = str(closed.get("title") or "")
                    closed_url = str(closed.get("url") or "")
                    if not is_noise_visit(closed_url, closed_title):
                        prev_key = self._fg_key
                        if prev_key and not closed.get("screenshot_file"):
                            closed["screenshot_file"] = self._shots_by_key.get(prev_key, "")
                        domain, category = classify_visit(closed_url, closed_title)
                        closed["domain"] = domain
                        closed["category"] = category
                        closed["source"] = "focus"
                        focus_batch.append(closed)
                # Skip screenshots of empty NTP / new tab.
                snap_title = str(snap.page_title if snap else "") or ""
                snap_url = str(getattr(snap, "url", "") or "") if snap else ""
                if snap is not None and is_noise_visit(snap_url, snap_title):
                    title_changed = False
                shot = self._maybe_screenshot(snap, title_changed=title_changed)
                if shot:
                    shot_batch.append(shot)
                self._fg_key = fg_key
                if focus_batch or shot_batch:
                    self._enqueue(focus_events=focus_batch, screenshots=shot_batch)

                now = time.monotonic()
                if (now - self._last_history) >= self.history_interval_sec:
                    self._last_history = now
                    visits = self._poll_history()
                    if visits:
                        for v in visits:
                            vt = str(v.get("title") or "").strip()
                            vu = str(v.get("url") or "").strip()
                            browser = str(v.get("browser") or "").strip()
                            if not browser or (not vt and not vu):
                                continue
                            shot_name = self._shots_by_key.get(
                                self._shot_key(browser, vt, vu), ""
                            )
                            if shot_name:
                                v["screenshot_file"] = shot_name
                        self._enqueue(visits=visits)

                if self.syncer:
                    self.syncer.maybe_sync(force=False)
            except Exception as exc:
                log.exception("browser probe loop error: %s", exc)
            time.sleep(self.foreground_poll_sec)
