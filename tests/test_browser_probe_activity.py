"""ActivityTracker: PC activity state machine + 5-minute buckets."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from browser_probe import activity  # noqa: E402


@pytest.fixture()
def clock(monkeypatch):
    """Control monotonic + wall clock + session inputs for the tracker."""
    state = {"mono": 0.0, "idle": 0.0, "locked": False, "exe": "msedge.exe"}
    monkeypatch.setattr(activity.time, "monotonic", lambda: state["mono"])
    monkeypatch.setattr(activity, "get_idle_seconds", lambda **_: state["idle"])
    monkeypatch.setattr(activity, "_session_locked", lambda: state["locked"])
    monkeypatch.setattr(activity, "_foreground_exe", lambda: state["exe"])
    wall = datetime(2026, 11, 11, 14, 0, 0).astimezone()
    monkeypatch.setattr(activity, "_local_now", lambda: wall)
    return state, wall


def _sum(buckets, key):
    return sum(float(b.get(key) or 0) for b in buckets)


def _collect(tracker, state, seconds, tick=3.0, idle_step=3.0):
    out = []
    for _ in range(int(seconds // tick)):
        state["mono"] += tick
        state["idle"] += idle_step
        out.extend(tracker.poll())
    return out


def test_no_input_fifteen_minutes_split_into_zones(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()  # first tick only primes prev_mono
    buckets = _collect(tracker, state, 15 * 60)
    buckets.extend(tracker.flush())
    # 900 s without input: 120 s active (input just happened at t=0),
    # then passive till AWAY (300 s), then away — ± one 3 s tick.
    assert _sum(buckets, "active_sec") == pytest.approx(120.0, abs=3.0)
    assert _sum(buckets, "passive_sec") == pytest.approx(180.0, abs=3.0)
    assert _sum(buckets, "away_sec") == pytest.approx(600.0, abs=3.0)
    assert _sum(buckets, "locked_sec") == 0.0


def test_locked_session_counts_as_locked(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()
    state["locked"] = True
    buckets = _collect(tracker, state, 30)
    buckets.extend(tracker.flush())
    assert _sum(buckets, "locked_sec") == pytest.approx(30.0, abs=0.5)
    assert _sum(buckets, "active_sec") == 0.0
    # Locked seconds belong to no application.
    assert not any(b.get("apps") for b in buckets)


def test_blind_gap_credits_nothing(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()
    state["mono"] += 3
    state["idle"] += 3
    assert tracker.poll() == []
    state["mono"] += 4000  # sleep / stalled loop
    state["idle"] += 4000
    tracker.poll()
    buckets = tracker.flush()
    # Only the first 3 s observed tick is credited; the 4000 s gap is not.
    assert _sum(buckets, "passive_sec") + _sum(buckets, "active_sec") + _sum(buckets, "away_sec") == pytest.approx(3.0, abs=0.5)


def test_input_inside_tick_is_active_and_attributed_to_exe(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()
    state["mono"] += 3
    state["idle"] = 1.0  # input 1 s ago inside the 3 s tick
    state["exe"] = "excel.exe"
    assert tracker.poll() == []
    buckets = tracker.flush()
    # 2 s of the tick had input, 1 s of silence in the active zone.
    assert _sum(buckets, "active_sec") == pytest.approx(3.0, abs=0.01)
    assert buckets[0]["apps"].get("excel.exe") == pytest.approx(3.0, abs=0.01)


def test_bucket_boundary_closes_previous_bucket(clock, monkeypatch):
    state, wall = clock
    tracker = activity.ActivityTracker()
    tracker.poll()
    state["mono"] += 3
    state["idle"] += 3
    assert tracker.poll() == []  # still inside the 5-min bucket
    # Cross into the next 5-minute bucket: the previous one closes.
    monkeypatch.setattr(activity, "_local_now", lambda: wall + timedelta(minutes=5, seconds=3))
    state["mono"] += 3
    state["idle"] += 3
    closed = tracker.poll()
    assert len(closed) == 1
    assert closed[0]["bucket_start"].startswith("2026-11-11T14:00:00")
    remaining = tracker.flush()
    assert [b["bucket_start"] for b in remaining] and remaining[0]["bucket_start"].startswith("2026-11-11T14:05:00")


def test_idle_sensor_failure_does_not_count_as_work(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()  # primes prev_mono
    state["mono"] += 3.0
    state["idle"] = 0.0
    tracker.poll()  # 3 s with input -> active
    state["mono"] += 3.0
    state["idle"] = None  # GetLastInputInfo failed -> tick not credited
    tracker.poll()
    state["mono"] += 3.0
    state["idle"] = 0.0
    tracker.poll()
    buckets = tracker.flush()
    # Only the two observed ticks count; the sensor-failure tick adds nothing.
    assert _sum(buckets, "active_sec") == pytest.approx(6.0, abs=0.1)
    assert _sum(buckets, "passive_sec") == 0.0
    assert _sum(buckets, "away_sec") == 0.0


def test_away_and_locked_seconds_have_no_app(clock):
    state, _ = clock
    tracker = activity.ActivityTracker()
    tracker.poll()
    buckets = _collect(tracker, state, 400)
    buckets.extend(tracker.flush())
    total = buckets[0]
    # 400 s: ~120 active + ~180 passive to exe, ~100 away to nobody.
    apps_sum = sum(total["apps"].values())
    assert apps_sum == pytest.approx(300.0, abs=3.0)
    assert total["apps"].get("msedge.exe") == pytest.approx(300.0, abs=3.0)
