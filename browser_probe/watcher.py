"""Main loop: History delta + foreground dwell + screenshots on title change."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sys
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import urlparse

from .activity import ActivityTracker
from .classify import classify_visit, is_noise_visit
from .foreground import BROWSER_PROCESS_MAP, ForegroundTracker, _strip_browser_suffix
from .history import (
    discover_profiles,
    profile_cursor_key,
    read_history_cycle,
    read_recent_title_urls,
)
from .screenshot import capture_window
from .sync import BrowserProbeSync

log = logging.getLogger("browser_probe.watcher")
_TITLE_CACHE_LIMIT = 2048
_SCREENSHOT_CACHE_LIMIT = 512
_TITLE_PREFIX_MATCH = 20
_SHOT_RETRY_MAX = 2

_TITLE_COUNTER_RE = re.compile(r"^[\(\[]\d+[\)\]]\s*")
_TITLE_BADGE_RE = re.compile(r"^[●•*·]\s*")
_TITLE_SPACES_RE = re.compile(r"\s+")


def _norm_title_key(title: str) -> str:
    """Title match key: window title and History title differ only in noise.

    Drops the browser suffix, the leading unread counter "(12) " and badge
    markers "● ", then folds case/whitespace — " (3) Почта — x" and
    "Почта — x" map to one key.
    """
    text = _strip_browser_suffix(str(title or ""))
    text = _TITLE_COUNTER_RE.sub("", text.strip())
    text = _TITLE_BADGE_RE.sub("", text)
    return _TITLE_SPACES_RE.sub(" ", text).strip().lower()


def _remember_recent(cache: OrderedDict[str, str], key: str, value: str, limit: int) -> None:
    cache[key] = value
    cache.move_to_end(key)
    if len(cache) > limit:
        cache.popitem(last=False)


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
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
        history_enabled: bool | None = None,
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
        # Delay between a page becoming foreground and capturing it: an instant
        # shot usually frames the still-loading (blank) page. A degenerate
        # capture (blank frame, tiny/minimizing window) re-arms the pending shot
        # a few times instead of storing garbage.
        self._shot_settle_sec = max(
            0.0,
            float(_env_float("ITINV_BROWSER_PROBE_SHOT_SETTLE_SEC", 8)),
        )
        self._shot_retry_sec = max(
            1.0,
            float(_env_float("ITINV_BROWSER_PROBE_SHOT_RETRY_SEC", 20)),
        )
        self.history_enabled = (
            _env_bool("ITINV_BROWSER_PROBE_HISTORY_ENABLED", True)
            if history_enabled is None
            else bool(history_enabled)
        )
        # Files opened/picked by browser processes → fs_egress inbox as
        # "browser" rows (send_state observed/selected — never claimed as sent).
        self._file_watch = None
        if _env_bool("ITINV_BROWSER_PROBE_FILE_WATCH_ENABLED", True):
            try:
                from types import SimpleNamespace

                probe_root = Path(__file__).resolve().parents[1] / "telegram_uia_probe"
                if str(probe_root) not in sys.path:
                    sys.path.insert(0, str(probe_root))
                from telegram_probe.disk_access import DiskAccessTracker

                self._file_watch = DiskAccessTracker(
                    SimpleNamespace(process_names=frozenset(BROWSER_PROCESS_MAP)),
                    min_poll_sec=3.0,
                )
            except Exception as exc:
                log.debug("browser file watch unavailable: %s", exc)
        self._egress_inbox = (
            Path(os.environ.get("ProgramData", r"C:\ProgramData"))
            / "HUB-IT"
            / "Agent"
            / "Spool"
            / "fs_egress"
            / "inbox"
        )
        self._stop = False
        self._tracker = ForegroundTracker()
        self._activity = ActivityTracker()
        self._last_history = 0.0
        self._last_shot_mono = 0.0
        self._last_shot_key = ""
        self._pending_shot_key: str | None = None
        self._pending_shot_due = 0.0
        self._pending_shot_retries = 0
        self._shots_by_key: OrderedDict[str, str] = OrderedDict()
        self._fg_key: str | None = None
        self._cursors: Dict[str, int] = {}
        # Recent History title→url for enriching focus when omnibox UIA is empty.
        self._title_url_cache: OrderedDict[str, str] = OrderedDict()
        self._liveness_path = self.output_dir / "liveness.ts"
        self._last_liveness_mono = 0.0
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

    def _remember_title_urls(self, browser: str, mapping: dict[str, str]) -> None:
        browser = browser.strip().lower()
        for title, url in reversed(mapping.items()):
            key = _norm_title_key(title)
            if key:
                _remember_recent(self._title_url_cache, f"{browser}|{key}", url, _TITLE_CACHE_LIMIT)

    def _warm_title_url_cache(self, profiles) -> None:
        for profile in profiles:
            mapping = read_recent_title_urls(
                profile,
                limit=1000,
                work_dir=self.output_dir / "hist_tmp",
            )
            self._remember_title_urls(profile.browser, mapping)

    def _poll_history(self) -> List[Dict[str, Any]]:
        if not self.history_enabled:
            return []
        profiles = discover_profiles()
        if not profiles:
            return []
        initialize = not self._cursors
        visits: List[Dict[str, Any]] = []
        delta_titles: list[tuple[str, str]] = []
        for profile in profiles:
            key = profile_cursor_key(profile)
            since = int(self._cursors.get(key, 0) or 0)
            rows, hints, cursor = read_history_cycle(
                profile,
                since_visit_id=None if initialize else since,
                work_dir=self.output_dir / "hist_tmp",
            )
            self._remember_title_urls(profile.browser, hints)
            if initialize or cursor > since:
                self._cursors[key] = cursor
            for row in rows:
                if row.get("_noise_cursor_only"):
                    continue
                row.pop("_cursor_visit_id", None)
                visits.append(row)
            for row in rows[-80:]:
                t = _norm_title_key(row.get("title") or "")
                u = str(row.get("url") or "").strip()
                b = str(row.get("browser") or profile.browser or "").strip().lower()
                if t and u and b:
                    delta_titles.append((f"{b}|{t}", u))
        for key, url in delta_titles:
            _remember_recent(self._title_url_cache, key, url, _TITLE_CACHE_LIMIT)
        if self._cursors:
            self._save_state()
        return visits

    def _enrich_focus_url(self, event: Dict[str, Any]) -> None:
        if str(event.get("url") or "").strip():
            return
        browser = str(event.get("browser") or "").strip().lower()
        title = _norm_title_key(str(event.get("title") or ""))
        if not browser or not title:
            return
        prefix = f"{browser}|"
        url = self._title_url_cache.get(f"{prefix}{title}", "")
        if not url and len(title) >= _TITLE_PREFIX_MATCH:
            # Same page under a slightly different title wording (SPA suffix,
            # notification counters mid-title): a 20-char shared prefix is a
            # safe-enough match for a URL hint.
            head = title[:_TITLE_PREFIX_MATCH]
            for key, candidate in self._title_url_cache.items():
                if key.startswith(prefix) and key[len(prefix):].startswith(head):
                    url = candidate
                    break
        if url:
            event["url"] = url

    @staticmethod
    def _shot_key(browser: str, title: str, url: str = "") -> str:
        # Prefer URL so SPA title flicker keeps the same screenshot slot.
        url_part = str(url or "").strip().lower()
        title_part = str(title or "").strip().lower()
        return f"{browser}|{url_part or title_part}"

    def _schedule_shot(self, fg_key: str | None, *, now: float) -> None:
        """Remember a just-foregrounded page for a settled capture."""
        if not fg_key or fg_key == self._last_shot_key:
            return
        if fg_key != self._pending_shot_key:
            self._pending_shot_retries = 0
        self._pending_shot_key = fg_key
        self._pending_shot_due = now + self._shot_settle_sec

    def _deferred_screenshot(
        self, snap, fg_key: str | None, *, now: float
    ) -> Dict[str, Any] | None:
        """Fire the pending capture once the page is settled and still foreground.

        A navigated-away pending key is dropped; a throttled one waits until the
        throttle window opens (a dwell is more valuable than the first tick).
        """
        key = self._pending_shot_key
        if key is None:
            return None
        if fg_key != key or snap is None:
            self._pending_shot_key = None
            return None
        if now < self._pending_shot_due:
            return None
        if (now - self._last_shot_mono) < self.screenshot_throttle_sec:
            return None
        self._pending_shot_key = None
        shot = self._capture_screenshot(snap, now=now)
        # Retryable failure (blank frame, tiny window, grab error): re-arm the
        # same key a bounded number of times — a page still loading at +8s may
        # be fine at +28s. The key is NOT marked shot on failure, so a later
        # revisit gets a fresh attempt.
        if shot is None and self._pending_shot_retries < _SHOT_RETRY_MAX:
            self._pending_shot_retries += 1
            self._pending_shot_key = key
            self._pending_shot_due = now + self._shot_retry_sec
        return shot

    def _capture_screenshot(self, snap, *, now: float) -> Dict[str, Any] | None:
        key = self._shot_key(snap.browser, snap.page_title, getattr(snap, "url", "") or "")
        prefix = f"{snap.browser}"
        rel, err = capture_window(snap.hwnd, self.screenshots_dir, prefix)
        self._last_shot_mono = now
        if not rel:
            log.debug("screenshot skipped: %s", err)
            return None
        self._last_shot_key = key
        name = rel.split("/")[-1]
        _remember_recent(self._shots_by_key, key, name, _SCREENSHOT_CACHE_LIMIT)
        return {
            "file": rel,
            "browser": snap.browser,
            "title": snap.page_title,
            "window_title": snap.title,
            "url": getattr(snap, "url", "") or "",
            "captured_at": _utcnow_iso(),
        }

    def _enqueue(self, *, visits=None, focus_events=None, screenshots=None, activity=None) -> None:
        if not self.syncer:
            return
        windows_user, computer_name = self._identity()
        payload = {
            "computer_name": computer_name,
            "windows_user": windows_user,
            "visits": visits or [],
            "focus_events": focus_events or [],
            "screenshots": screenshots or [],
            "activity": activity or [],
        }
        if any(payload[key] for key in ("visits", "focus_events", "screenshots", "activity")):
            self.syncer.enqueue(payload)

    def _poll_file_access(self, snap) -> None:
        """User files opened by a browser process → file_left 'browser' events.

        Direction cannot be proven from handles alone (upload attach vs
        download/PDF view), so these are evidence rows — 'selected' when the
        common file dialog picked the file, 'observed' otherwise.
        """
        preferred = int(getattr(snap, "pid", 0) or 0)
        for acc in self._file_watch.poll(preferred):
            name = str(getattr(acc, "file_name", "") or "")
            if not name or "." not in name:
                continue
            path = Path(str(getattr(acc, "path", "") or ""))
            if not path.is_file():
                continue
            try:
                size = int(path.stat().st_size)
            except OSError:
                size = None
            url = str(getattr(snap, "url", "") or "") if snap else ""
            domain = urlparse(url).netloc.lower()
            browser = str(getattr(snap, "browser", "") or "") if snap else ""
            windows_user, computer_name = self._identity()
            ts = int(time.time())
            dest = f"browser:{domain or browser or 'unknown'}"
            event_id = "browser-" + hashlib.sha1(
                f"{computer_name}|browser|{path}|{acc.source}|{dest}|{ts // 300}".encode(
                    "utf-8", errors="replace"
                )
            ).hexdigest()[:24]
            event = {
                "event_id": event_id,
                "ts": ts,
                "channel": "browser",
                "file_name": name,
                "dest_path": dest,
                "src_path": str(path),
                "size": size,
                "sha256": "",
                "windows_user": windows_user,
                "computer_name": computer_name,
                "details": {
                    "send_state": (
                        "selected"
                        if str(getattr(acc, "source", "") or "") == "file_dialog"
                        else "observed"
                    ),
                    "source": "disk_open",
                    "access_source": str(getattr(acc, "source", "") or ""),
                    "browser": browser or str(getattr(acc, "process_name", "") or ""),
                    "url": url[:300],
                    "page_title": (
                        str(getattr(snap, "page_title", "") or "")[:300] if snap else ""
                    ),
                },
            }
            try:
                self._egress_inbox.mkdir(parents=True, exist_ok=True)
                (self._egress_inbox / f"br_{event_id}.json").write_text(
                    json.dumps(event, ensure_ascii=False), encoding="utf-8"
                )
            except OSError as exc:
                log.debug("browser file_left drop failed: %s", exc)

    def _handle_closed_focus(self, closed: Dict[str, Any], focus_batch: List[Dict[str, Any]]) -> None:
        self._enrich_focus_url(closed)
        closed_title = str(closed.get("title") or "")
        closed_url = str(closed.get("url") or "")
        if is_noise_visit(closed_url, closed_title):
            return
        prev_key = self._fg_key
        if prev_key and not closed.get("screenshot_file"):
            closed["screenshot_file"] = self._shots_by_key.get(prev_key, "")
        domain, category = classify_visit(closed_url, closed_title)
        closed["domain"] = domain
        closed["category"] = category
        closed["source"] = "focus"
        focus_batch.append(closed)

    def _mark_liveness(self) -> None:
        """Cheap heartbeat for the agent watchdog: proves the tick loop runs.

        The agent's probe watchdog treats a running process whose liveness
        file is stale (e.g. a blocking WinAPI call wedged the loop) as hung
        and restarts the scheduled task.
        """
        now_mono = time.monotonic()
        if now_mono - self._last_liveness_mono < 15.0:
            return
        self._last_liveness_mono = now_mono
        try:
            self._liveness_path.write_text(f"{time.time():.3f}\n", encoding="ascii")
        except OSError as exc:
            log.debug("liveness mark failed: %s", exc)

    def run(self) -> None:
        log.info(
            "browser probe watcher start history=%ss poll=%ss "
            "shot_throttle=%ss settle=%ss retry=%ss",
            self.history_interval_sec,
            self.foreground_poll_sec,
            self.screenshot_throttle_sec,
            self._shot_settle_sec,
            self._shot_retry_sec,
        )
        while not self._stop:
            try:
                self._mark_liveness()
                snap, closed = self._tracker.poll()
                if self._file_watch is not None:
                    try:
                        self._poll_file_access(snap)
                    except Exception as exc:
                        log.debug("browser file access poll failed: %s", exc)
                # Activity is best-effort: a tracker fault must not blind focus.
                try:
                    activity_buckets = self._activity.poll()
                except Exception as exc:
                    log.exception("browser probe activity tick failed: %s", exc)
                    activity_buckets = []
                if activity_buckets:
                    self._enqueue(activity=activity_buckets)
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
                    self._handle_closed_focus(closed, focus_batch)
                # Skip screenshots of empty NTP / new tab.
                snap_title = str(snap.page_title if snap else "") or ""
                snap_url = str(getattr(snap, "url", "") or "") if snap else ""
                if snap is not None and is_noise_visit(snap_url, snap_title):
                    title_changed = False
                now_mono = time.monotonic()
                if title_changed:
                    self._schedule_shot(fg_key, now=now_mono)
                shot = self._deferred_screenshot(snap, fg_key, now=now_mono)
                if shot:
                    shot_batch.append(shot)
                self._fg_key = fg_key
                if focus_batch or shot_batch:
                    self._enqueue(focus_events=focus_batch, screenshots=shot_batch)

                now = time.monotonic()
                if (now - self._last_history) >= self.history_interval_sec:
                    self._last_history = now
                    if not self.history_enabled:
                        self._warm_title_url_cache(discover_profiles())
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

            except Exception as exc:
                log.exception("browser probe loop error: %s", exc)
            time.sleep(self.foreground_poll_sec)
        # Agent stopping: close the open segment at the last observation so
        # its dwell is queued instead of lost with the process. enqueue()
        # persists to disk; the caller's final forced sync uploads it.
        try:
            closed = self._tracker.flush()
        except Exception as exc:
            log.exception("browser probe final flush failed: %s", exc)
            closed = None
        try:
            activity_buckets = self._activity.flush()
        except Exception as exc:
            log.exception("browser probe activity flush failed: %s", exc)
            activity_buckets = []
        if closed or activity_buckets:
            focus_batch = []
            if closed:
                self._handle_closed_focus(closed, focus_batch)
            if focus_batch or activity_buckets:
                self._enqueue(focus_events=focus_batch, activity=activity_buckets)
