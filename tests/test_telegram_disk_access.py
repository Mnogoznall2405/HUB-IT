"""DiskAccessTracker: messenger PID cache + poll throttle.

The full psutil.process_iter + open_files scan ran on every 0.5 s watcher tick
while the messenger was foreground — the heaviest recurring CPU item of the
probe. The PID set must be cached (rescan <= once per 10 s) and polls
throttled to 2 s; a dead process must drop out of the cache.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "telegram_uia_probe"))

import pytest  # noqa: E402

from telegram_probe import disk_access  # noqa: E402
from telegram_probe.profile import TELEGRAM  # noqa: E402


class _FakeProc:
    def __init__(self, pid: int, name: str):
        self.info = {"pid": pid, "name": name}


@pytest.fixture()
def env(monkeypatch):
    clock = {"t": 0.0}
    monkeypatch.setattr(disk_access.time, "monotonic", lambda: clock["t"])
    scans = {"n": 0}

    def process_iter(attrs=None):
        scans["n"] += 1
        return iter([_FakeProc(101, "telegram.exe"), _FakeProc(200, "svchost.exe")])

    monkeypatch.setattr(disk_access.psutil, "process_iter", process_iter)
    monkeypatch.setattr(
        disk_access.psutil,
        "Process",
        lambda pid: type("P", (), {"name": lambda s: "telegram.exe", "open_files": lambda s: []})(),
    )
    monkeypatch.setattr(disk_access, "_read_file_dialog_paths", lambda pid: [])
    monkeypatch.setattr(
        disk_access.DiskAccessTracker,
        "_recent_shortcut_targets",
        staticmethod(lambda max_age_sec: []),
    )
    return clock, scans


def test_poll_throttles_and_rescans_no_more_than_every_10s(env):
    clock, scans = env
    tracker = disk_access.DiskAccessTracker(TELEGRAM)

    tracker.poll()          # t=0: first scan
    assert scans["n"] == 1
    clock["t"] = 1.0
    tracker.poll()          # throttled by min_poll_sec=2
    assert scans["n"] == 1
    clock["t"] = 3.0
    tracker.poll()          # runs, but rescan interval (10 s) not reached
    assert scans["n"] == 1
    clock["t"] = 11.0
    tracker.poll()          # 10 s passed -> rescan
    assert scans["n"] == 2
    clock["t"] = 13.0
    tracker.poll()
    assert scans["n"] == 2


def test_dead_process_drops_out_of_pid_cache(env, monkeypatch):
    clock, scans = env
    tracker = disk_access.DiskAccessTracker(TELEGRAM)
    tracker.poll()
    assert 101 in tracker._target_cache

    def dead(pid):
        raise disk_access.psutil.NoSuchProcess(pid)

    clock["t"] = 3.0
    monkeypatch.setattr(disk_access.psutil, "Process", dead)
    tracker._open_files(101)
    assert 101 not in tracker._target_cache


def test_foreground_pid_joins_cache_between_scans(env):
    clock, scans = env
    tracker = disk_access.DiskAccessTracker(TELEGRAM)
    clock["t"] = 1.0
    # preferred_pid=777 is a telegram process not in the process table list;
    # with the cache empty the first call still does the one full scan.
    tracker.poll(preferred_pid=777)
    targets = dict(tracker._target_pids(777))
    assert 101 in targets
    assert 777 in targets
    assert scans["n"] == 1
    # Between rescans a new foreground pid joins the cache without process_iter.
    clock["t"] = 3.0
    targets = dict(tracker._target_pids(999))
    assert 999 in targets
    assert scans["n"] == 1
