from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from browser_probe.history import (
    BrowserProfile,
    bootstrap_cursors,
    discover_all_user_profiles,
    profile_cursor_key,
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
