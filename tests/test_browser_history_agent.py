from __future__ import annotations

import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from browser_probe import history
from browser_probe.history import (
    BrowserProfile,
    bootstrap_cursors,
    discover_all_user_profiles,
    profile_cursor_key,
    read_visits_since,
)
from browser_probe.history_agent import BrowserHistoryCollector
from browser_probe.watcher import BrowserProbeWatcher


def _make_history_db(path: Path, visits: list[tuple[int, int, str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER)")
    conn.execute("CREATE TABLE visits (id INTEGER PRIMARY KEY, visit_time INTEGER, url INTEGER)")
    for vid, vtime, url, title in visits:
        cur = conn.execute("INSERT INTO urls (url, title, visit_count) VALUES (?, ?, 1)", (url, title))
        conn.execute("INSERT INTO visits (id, visit_time, url) VALUES (?, ?, ?)", (vid, vtime, cur.lastrowid))
    conn.commit()
    conn.close()


def _users_tree(root: Path, user: str) -> Path:
    return root / user / "AppData" / "Local" / "Google" / "Chrome" / "User Data" / "Default" / "History"


def test_profile_cursor_key_namespaces_user():
    p = BrowserProfile(browser="chrome", profile="Default", history_path=Path("x"), windows_user="")
    assert profile_cursor_key(p) == "chrome|Default"
    p2 = BrowserProfile(browser="chrome", profile="Default", history_path=Path("x"), windows_user="alice")
    assert profile_cursor_key(p2) == "alice|chrome|Default"


def test_discover_all_user_profiles_tags_user(tmp_path: Path):
    users = tmp_path / "Users"
    _make_history_db(_users_tree(users, "alice"), [])
    _make_history_db(_users_tree(users, "Public"), [])
    found = discover_all_user_profiles(users)
    assert len(found) == 1
    assert found[0].windows_user == "alice"
    assert found[0].browser == "chrome"


class _FakeSyncer:
    def __init__(self):
        self.payloads = []
        self.syncs = 0

    def enqueue(self, payload):
        self.payloads.append(payload)

    def maybe_sync(self, *, force=False):
        self.syncs += 1


def test_collect_once_enqueues_per_user_and_tracks_cursor(tmp_path: Path):
    users = tmp_path / "Users"
    chromium_us = 13300000000000000
    _make_history_db(
        _users_tree(users, "alice"),
        [(5, chromium_us, "https://example.com/a", "Example A")],
    )
    out = tmp_path / "out"
    syncer = _FakeSyncer()
    collector = BrowserHistoryCollector(out, syncer=syncer, users_root=users)
    assert collector.collect_once() == 0  # first run bootstraps cursors
    _make_history_db(
        _users_tree(users, "alice"),
        [(5, chromium_us, "https://example.com/a", "Example A"),
         (9, chromium_us + 1, "https://example.com/b", "Example B")],
    )
    assert collector.collect_once() == 1
    assert len(syncer.payloads) == 1
    payload = syncer.payloads[0]
    assert payload["windows_user"] == "alice"
    assert payload["visits"][0]["url"] == "https://example.com/b"
    assert payload["visits"][0]["profile"] == "alice@Default"
    assert collector.collect_once() == 0  # cursor advanced, nothing new


def test_watcher_history_disabled_skips_poll(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("ITINV_BROWSER_PROBE_HISTORY_ENABLED", "0")
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    assert watcher.history_enabled is False
    assert watcher._poll_history() == []


def test_watcher_reads_titles_and_visits_from_one_history_copy(tmp_path: Path, monkeypatch):
    local_app_data = tmp_path / "Local"
    monkeypatch.setenv("LOCALAPPDATA", str(local_app_data))
    history_db = local_app_data / "Google" / "Chrome" / "User Data" / "Default" / "History"
    chromium_us = 13300000000000000
    first = (5, chromium_us, "https://example.com/a", "Example A")
    _make_history_db(history_db, [first])
    copies = []
    copy_history_db = history._copy_history_db

    def count_copy(source, destination):
        copies.append(source)
        return copy_history_db(source, destination)

    monkeypatch.setattr(history, "_copy_history_db", count_copy)
    watcher = BrowserProbeWatcher(tmp_path / "bp", history_enabled=True)
    assert watcher._poll_history() == []
    assert copies == [history_db]

    copies.clear()
    _make_history_db(history_db, [first, (9, chromium_us + 1, "https://example.com/b", "Example B")])
    assert [visit["visit_id"] for visit in watcher._poll_history()] == [9]
    focus_event = {"browser": "chrome", "title": "Example B"}
    watcher._enrich_focus_url(focus_event)
    assert focus_event["url"] == "https://example.com/b"
    assert copies == [history_db]


def test_history_snapshot_prunes_stale_tmp_dirs(tmp_path: Path):
    """Leftover dirs from WinError 145 cleanup races must be swept instead of
    accumulating in hist_tmp; fresh dirs and reads are unaffected."""
    work = tmp_path / "work"
    root = work / "hub_it_browser_hist"
    stale = root / "tmpstale"
    fresh = root / "tmpfresh"
    stale.mkdir(parents=True)
    fresh.mkdir(parents=True)
    (stale / "History").write_bytes(b"junk")
    old = time.time() - 2 * 86400
    os.utime(stale, (old, old))

    db = tmp_path / "History"
    _make_history_db(db, [(1, 13300000000000000, "https://a/", "A")])
    profile = BrowserProfile(browser="chrome", profile="Default", history_path=db)
    rows = read_visits_since(profile, work_dir=work)

    assert [row["url"] for row in rows] == ["https://a/"]
    assert not stale.exists()
    assert fresh.exists()


def test_focus_url_enrich_normalizes_title_noise(tmp_path: Path):
    """Unread counters / badge marks in the window title must not break the
    History title→url lookup."""
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._title_url_cache[
        "edge|почта — входящие — ivanov@corp.ru — outlook"
    ] = "https://mail.example/owa"
    event = {
        "browser": "edge",
        "title": "(3) Почта — Входящие — Ivanov@corp.ru — Outlook",
        "url": "",
    }
    watcher._enrich_focus_url(event)
    assert event["url"] == "https://mail.example/owa"


def test_focus_url_enrich_prefix_match(tmp_path: Path):
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._title_url_cache[
        "chrome|проектная документация — google drive"
    ] = "https://drive.google.com/drive/x"
    # Same page, slightly different title wording: shared >=20 char prefix.
    event = {
        "browser": "chrome",
        "title": "Проектная документация — документы команды",
        "url": "",
    }
    watcher._enrich_focus_url(event)
    assert event["url"] == "https://drive.google.com/drive/x"
    # Below the prefix threshold there is no fuzzy guess.
    event2 = {"browser": "chrome", "title": "Короткий", "url": ""}
    watcher._enrich_focus_url(event2)
    assert event2["url"] == ""


def _snap(browser: str = "chrome", page_title: str = "Page", url: str = "https://example.com/x"):
    from types import SimpleNamespace

    return SimpleNamespace(
        hwnd=101,
        browser=browser,
        process_name="chrome.exe",
        title=f"{page_title} - Chrome",
        page_title=page_title,
        pid=42,
        url=url,
    )


def test_screenshot_waits_for_settle_then_fires_once(tmp_path: Path, monkeypatch):
    """A page that just opened must be framed after the settle delay, not at
    the first tick while it is still loading."""
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._shot_settle_sec = 8.0
    watcher.screenshot_throttle_sec = 5.0
    calls = []
    monkeypatch.setattr(
        "browser_probe.watcher.capture_window",
        lambda hwnd, out, prefix: (calls.append(hwnd) or "screenshots/a.jpg", None),
    )
    snap = _snap()
    key = watcher._shot_key("chrome", "Page", "https://example.com/x")
    watcher._schedule_shot(key, now=1000.0)
    assert watcher._deferred_screenshot(snap, key, now=1004.0) is None
    shot = watcher._deferred_screenshot(snap, key, now=1008.5)
    assert shot is not None and shot["file"] == "screenshots/a.jpg"
    assert calls == [101]
    assert watcher._deferred_screenshot(snap, key, now=1009.0) is None


def test_pending_shot_dropped_when_page_left_early(tmp_path: Path, monkeypatch):
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._shot_settle_sec = 8.0
    calls = []
    monkeypatch.setattr(
        "browser_probe.watcher.capture_window",
        lambda hwnd, out, prefix: (calls.append(hwnd) or "screenshots/a.jpg", None),
    )
    key_a = watcher._shot_key("chrome", "A", "https://a/")
    watcher._schedule_shot(key_a, now=1000.0)
    key_b = watcher._shot_key("chrome", "B", "https://b/")
    assert watcher._deferred_screenshot(_snap(page_title="B", url="https://b/"), key_b, now=1003.0) is None
    assert watcher._pending_shot_key is None
    assert calls == []


def test_pending_shot_survives_throttle_window(tmp_path: Path, monkeypatch):
    """A settled page whose due time lands inside the throttle window is not
    lost: it fires as soon as the throttle opens."""
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._shot_settle_sec = 8.0
    watcher.screenshot_throttle_sec = 30.0
    watcher._last_shot_mono = 990.0  # previous shot 10s ago
    calls = []
    monkeypatch.setattr(
        "browser_probe.watcher.capture_window",
        lambda hwnd, out, prefix: (calls.append(hwnd) or "screenshots/a.jpg", None),
    )
    snap = _snap()
    key = watcher._shot_key("chrome", "Page", "https://example.com/x")
    watcher._schedule_shot(key, now=1000.0)
    # Due at 1008, but throttle needs 1020 — still pending, no capture.
    assert watcher._deferred_screenshot(snap, key, now=1010.0) is None
    assert watcher._pending_shot_key == key
    assert calls == []
    shot = watcher._deferred_screenshot(snap, key, now=1020.5)
    assert shot is not None
    assert calls == [101]


def test_capture_rejects_degenerate_window_rect(tmp_path: Path, monkeypatch):
    """Minimizing/covered windows must not produce toolbar-strip screenshots."""
    from browser_probe import screenshot

    monkeypatch.setattr(screenshot, "_rect_from_handle", lambda hwnd: (0, 0, 400, 48))
    rel, err = screenshot.capture_window(1, tmp_path, "chrome")
    assert rel is None and err == "window_too_small"
    monkeypatch.setattr(screenshot, "_rect_from_handle", lambda hwnd: (0, 0, 190, 32))
    rel, err = screenshot.capture_window(1, tmp_path, "chrome")
    assert rel is None and err == "window_too_small"


def test_blank_capture_rearmed_then_succeeds(tmp_path: Path, monkeypatch):
    """A still-loading page yields a blank frame at +8s: the watcher re-arms
    the same key once and lands the real frame on retry."""
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._shot_settle_sec = 8.0
    watcher._shot_retry_sec = 20.0
    watcher.screenshot_throttle_sec = 5.0
    calls = []
    outcomes = iter([(None, "blank_frame"), ("screenshots/ok.jpg", None)])

    def fake(hwnd, out, prefix):
        calls.append(hwnd)
        return next(outcomes)

    monkeypatch.setattr("browser_probe.watcher.capture_window", fake)
    snap = _snap()
    key = watcher._shot_key("chrome", "Page", "https://example.com/x")
    watcher._schedule_shot(key, now=1000.0)
    assert watcher._deferred_screenshot(snap, key, now=1008.5) is None
    assert watcher._pending_shot_key == key and calls == [101]
    assert watcher._deferred_screenshot(snap, key, now=1020.0) is None
    shot = watcher._deferred_screenshot(snap, key, now=1028.5)
    assert shot is not None and calls == [101, 101]


def test_failed_capture_not_marked_shot_and_retry_bounded(tmp_path: Path, monkeypatch):
    """Failures do not consume the key: a later revisit reschedules a fresh
    attempt, and consecutive failures stop after the retry cap."""
    watcher = BrowserProbeWatcher(tmp_path / "bp")
    watcher._shot_settle_sec = 8.0
    watcher._shot_retry_sec = 20.0
    watcher.screenshot_throttle_sec = 5.0
    calls = []
    monkeypatch.setattr(
        "browser_probe.watcher.capture_window",
        lambda hwnd, out, prefix: (calls.append(hwnd) or (None, "window_too_small")),
    )
    snap = _snap()
    key = watcher._shot_key("chrome", "Page", "https://example.com/x")
    watcher._schedule_shot(key, now=1000.0)
    assert watcher._deferred_screenshot(snap, key, now=1008.5) is None
    assert watcher._deferred_screenshot(snap, key, now=1028.5) is None
    assert watcher._deferred_screenshot(snap, key, now=1048.5) is None
    assert calls == [101, 101, 101]  # 1 attempt + 2 retries, then give up
    assert watcher._pending_shot_key is None
    assert watcher._last_shot_key != key  # failure never marks the key shot
    # Revisit to the same key reschedules a brand-new attempt.
    watcher._schedule_shot(key, now=2000.0)
    assert watcher._pending_shot_key == key
    assert watcher._deferred_screenshot(snap, key, now=2008.5) is None
    assert calls == [101, 101, 101, 101]


def test_looks_blank_flags_uniform_frames(tmp_path: Path):
    from PIL import Image, ImageDraw
    from browser_probe import screenshot

    assert screenshot._looks_blank(Image.new("RGB", (800, 600), (255, 255, 255))) is True
    assert screenshot._looks_blank(Image.new("RGB", (800, 600), (0, 0, 0))) is True
    # A lone loading spinner on white is still "blank" for evidence purposes.
    spinner = Image.new("RGB", (1600, 900), (255, 255, 255))
    d = ImageDraw.Draw(spinner)
    d.ellipse([760, 410, 840, 490], outline=(80, 80, 80), width=10)
    assert screenshot._looks_blank(spinner) is True
    # A real page: header bar, sidebar and body text lines → far above blank.
    page = Image.new("RGB", (1600, 900), (245, 245, 245))
    d = ImageDraw.Draw(page)
    d.rectangle([0, 0, 1600, 64], fill=(25, 60, 120))
    d.rectangle([0, 64, 300, 900], fill=(230, 230, 235))
    for y in range(140, 880, 18):
        d.line([(340, y), (1500, y)], fill=(70, 70, 70), width=6)
    assert screenshot._looks_blank(page) is False
